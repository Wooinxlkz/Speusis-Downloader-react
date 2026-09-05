//! A small, explicit FTP client for ordinary downloads.
//!
//! This intentionally implements the same conservative feature set as the
//! original downloader: anonymous or URL-embedded credentials, binary mode,
//! SIZE, passive mode, RETR, progress, cancellation, and atomic `.part`
//! finalization. It does not pretend to support FTPS or active mode.
//!
//! BUG FIX (v0.4.0): The previous version declared `read_reply` as accepting
//! `BufReader<OwnedReadHalf>` while all callers passed `BufReader<TcpStream>`.
//! tokio::net::TcpStream already implements both AsyncRead AND AsyncWrite, so
//! there is no reason to split it. Using `BufReader<TcpStream>` consistently
//! eliminates the type mismatch and removes the unused OwnedReadHalf import.

use crate::downloader_trait::Downloader;
use crate::event_bus::EventBus;
use crate::file_manager::FileManager;
use crate::scheduler::TaskHandle;
use crate::types::{
    AppEvent, DownloadCompleted, DownloadFailed, DownloadProgress, DownloadStarted,
    DownloadStatus,
};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

struct FtpReply {
    code: u16,
    text: String,
}

pub struct FtpDownloader {
    event_bus: EventBus,
    files: Arc<FileManager>,
    controllers: StdMutex<HashMap<String, CancellationToken>>,
}

impl FtpDownloader {
    pub fn new(event_bus: EventBus, files: Arc<FileManager>) -> Self {
        Self { event_bus, files, controllers: StdMutex::new(HashMap::new()) }
    }

    /// Read a (possibly multi-line) FTP reply from a buffered TcpStream.
    /// TcpStream implements both AsyncRead and AsyncWrite so BufReader<TcpStream>
    /// works fine here without any stream splitting.
    async fn read_reply(reader: &mut BufReader<TcpStream>) -> anyhow::Result<FtpReply> {
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        if line.len() < 3 {
            anyhow::bail!("FTP server returned an invalid response: {:?}", line);
        }
        let code: u16 = line[..3].parse().map_err(|_| anyhow::anyhow!("FTP bad reply code in: {:?}", line))?;
        let first_text = line[4..].trim_end().to_string();
        // Multi-line reply: "NNN-..." until "NNN " terminates it.
        if line.as_bytes().get(3) == Some(&b'-') {
            loop {
                line.clear();
                reader.read_line(&mut line).await?;
                if line.len() >= 4
                    && line[..3].parse::<u16>().ok() == Some(code)
                    && line.as_bytes().get(3) == Some(&b' ')
                {
                    break;
                }
            }
        }
        Ok(FtpReply { code, text: first_text })
    }

    /// Send a single FTP command line (no CRLF needed - we add it) and
    /// immediately read the server reply. Uses the same BufReader<TcpStream>
    /// for both write (via get_mut()) and read, which is safe because reads
    /// and writes use different halves of the TCP socket.
    async fn command(
        reader: &mut BufReader<TcpStream>,
        command: &str,
    ) -> anyhow::Result<FtpReply> {
        reader.get_mut().write_all(command.as_bytes()).await?;
        reader.get_mut().write_all(b"\r\n").await?;
        Self::read_reply(reader).await
    }

    fn parse_pasv(reply: &str) -> anyhow::Result<(String, u16)> {
        let start = reply
            .find('(')
            .ok_or_else(|| anyhow::anyhow!("FTP PASV response has no '(': {:?}", reply))?;
        let end = reply[start..]
            .find(')')
            .map(|i| start + i)
            .ok_or_else(|| anyhow::anyhow!("FTP PASV response has no ')': {:?}", reply))?;
        let values: Vec<u16> = reply[start + 1..end]
            .split(',')
            .map(str::trim)
            .map(|s| s.parse::<u16>())
            .collect::<Result<_, _>>()
            .map_err(|_| anyhow::anyhow!("FTP PASV response is malformed: {:?}", reply))?;
        if values.len() != 6
            || values[0] > 255
            || values[1] > 255
            || values[2] > 255
            || values[3] > 255
        {
            anyhow::bail!("FTP PASV response is malformed: {:?}", reply);
        }
        let host = format!("{}.{}.{}.{}", values[0], values[1], values[2], values[3]);
        let port = values[4] * 256 + values[5];
        Ok((host, port))
    }

    async fn run(&self, task: &TaskHandle, token: &CancellationToken) -> anyhow::Result<()> {
        let url = task.lock().await.request.url.clone();
        let parsed = url::Url::parse(&url)?;
        let host = parsed.host_str().ok_or_else(|| anyhow::anyhow!("FTP URL has no host"))?.to_string();
        let port = parsed.port().unwrap_or(21);
        let username = if parsed.username().is_empty() {
            "anonymous".to_string()
        } else {
            percent_decode(parsed.username())?
        };
        let password = parsed
            .password()
            .map(percent_decode)
            .transpose()?
            .unwrap_or_else(|| "anonymous@".to_string());
        let remote_path = percent_decode(parsed.path())?;
        if remote_path.is_empty() || remote_path == "/" {
            anyhow::bail!("FTP URL must point to a file, not a directory");
        }

        let requested_filename = task.lock().await.request.filename.clone();
        let filename = FileManager::sanitize_filename(
            &requested_filename
                .filter(|name| !name.is_empty())
                .or_else(|| {
                    remote_path
                        .rsplit('/')
                        .find(|part| !part.is_empty())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "ftp-download".to_string()),
        );
        let target_dir = task.lock().await.request.target_dir.clone();
        FileManager::ensure_directory(&target_dir).await?;
        let part_path =
            FileManager::get_part_path(&target_dir, &filename).to_string_lossy().to_string();
        let final_path =
            FileManager::get_final_path(&target_dir, &filename).to_string_lossy().to_string();
        self.files.open_for_writing(&part_path, 0).await?;
        {
            let mut current = task.lock().await;
            current.output_path = Some(final_path.clone());
            current.part_path = Some(part_path.clone());
            current.started_at = Some(chrono::Utc::now().timestamp_millis());
        }

        // --- Control connection ---
        let stream = TcpStream::connect((host.as_str(), port)).await?;
        let mut control = BufReader::new(stream);

        let greeting = Self::read_reply(&mut control).await?;
        if greeting.code >= 400 {
            anyhow::bail!("FTP server refused connection ({}): {}", greeting.code, greeting.text);
        }

        let user_reply = Self::command(&mut control, &format!("USER {username}")).await?;
        let logged_in = if user_reply.code == 331 {
            Self::command(&mut control, &format!("PASS {password}")).await?
        } else {
            user_reply
        };
        if logged_in.code >= 400 {
            anyhow::bail!("FTP login failed ({}): {}", logged_in.code, logged_in.text);
        }

        let binary = Self::command(&mut control, "TYPE I").await?;
        if binary.code >= 400 {
            anyhow::bail!("FTP binary mode failed ({}): {}", binary.code, binary.text);
        }

        // Probe file size (optional - some servers don't support SIZE)
        let size_reply = Self::command(&mut control, &format!("SIZE {remote_path}")).await?;
        if size_reply.code == 213 {
            if let Ok(size) = size_reply.text.trim().parse::<u64>() {
                task.lock().await.size = Some(size);
            }
        }

        // --- Passive data connection ---
        let passive = Self::command(&mut control, "PASV").await?;
        if passive.code != 227 {
            anyhow::bail!("FTP passive mode failed ({}): {}", passive.code, passive.text);
        }
        let (data_host, data_port) = Self::parse_pasv(&passive.text)?;

        // Issue RETR before connecting data socket so the server is ready
        let transfer = Self::command(&mut control, &format!("RETR {remote_path}")).await?;
        if transfer.code != 125 && transfer.code != 150 {
            anyhow::bail!("FTP server rejected RETR ({}): {}", transfer.code, transfer.text);
        }

        let mut data = TcpStream::connect((data_host.as_str(), data_port)).await?;

        let id = task.lock().await.id.clone();
        let size = task.lock().await.size.unwrap_or(0);
        self.event_bus
            .emit(AppEvent::DownloadStarted(DownloadStarted { id: id.clone(), url, size }));

        let started = Instant::now();
        let mut offset = 0u64;
        let mut last_emit = Instant::now();
        let mut last_bytes = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];

        loop {
            let read = tokio::select! {
                _ = token.cancelled() => anyhow::bail!("Aborted"),
                result = data.read(&mut buffer) => result?,
            };
            if read == 0 {
                break;
            }
            self.files.write_chunk(&part_path, offset, &buffer[..read]).await?;
            offset += read as u64;
            task.lock().await.received_bytes = offset;

            if last_emit.elapsed().as_millis() >= 300 || (size > 0 && offset >= size) {
                let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
                let speed = (offset.saturating_sub(last_bytes) as f64 / elapsed).max(0.0);
                let remaining = size.saturating_sub(offset) as f64;
                self.event_bus.emit(AppEvent::DownloadProgress(DownloadProgress {
                    id: id.clone(),
                    bytes_received: offset,
                    speed,
                    eta: if speed > 0.0 { remaining / speed } else { 0.0 },
                    size: (size > 0).then_some(size),
                }));
                last_emit = Instant::now();
                last_bytes = offset;
            }
        }
        drop(data); // close data socket before reading transfer-complete reply

        let finished = Self::read_reply(&mut control).await?;
        if finished.code != 226 && finished.code != 250 {
            anyhow::bail!("FTP transfer error ({}): {}", finished.code, finished.text);
        }
        let _ = Self::command(&mut control, "QUIT").await; // best-effort

        self.files.finalize(&part_path, &final_path).await?;
        {
            let mut current = task.lock().await;
            current.status = DownloadStatus::Completed;
            current.completed_at = Some(chrono::Utc::now().timestamp_millis());
        }
        self.event_bus.emit(AppEvent::DownloadCompleted(DownloadCompleted {
            id,
            path: final_path,
            duration: started.elapsed().as_secs_f64() * 1000.0,
        }));
        Ok(())
    }
}

fn percent_decode(value: &str) -> anyhow::Result<String> {
    Ok(percent_encoding::percent_decode_str(value).decode_utf8()?.into_owned())
}

#[async_trait]
impl Downloader for FtpDownloader {
    async fn start(&self, task: TaskHandle) {
        let id = task.lock().await.id.clone();
        let token = CancellationToken::new();
        self.controllers.lock().unwrap().insert(id.clone(), token.clone());
        let result = self.run(&task, &token).await;
        self.controllers.lock().unwrap().remove(&id);
        if let Err(error) = result {
            let mut current = task.lock().await;
            if current.status != DownloadStatus::Paused {
                current.status =
                    if token.is_cancelled() { DownloadStatus::Cancelled } else { DownloadStatus::Failed };
                if current.status == DownloadStatus::Failed { current.last_error = Some(error.to_string()); }
                let retry_count = current.retry_count;
                let id = current.id.clone();
                drop(current);
                self.event_bus.emit(AppEvent::DownloadFailed(DownloadFailed {
                    id,
                    reason: error.to_string(),
                    retry_count,
                }));
            }
        }
    }

    fn cancel(&self, id: &str) {
        if let Some(token) = self.controllers.lock().unwrap().get(id) {
            token.cancel();
        }
    }
}

// ---------------------------------------------------------------------------
// ProtocolDownloader — routes HTTP/HTTPS → HttpDirectDownloader,
//                      FTP → FtpDownloader,
//                      magnet/torrent → TorrentDownloader.
// ---------------------------------------------------------------------------

pub struct ProtocolDownloader {
    http: Arc<dyn Downloader>,
    ftp: Arc<FtpDownloader>,
    torrent: Arc<dyn Downloader>,
}

impl ProtocolDownloader {
    pub fn new(
        http: Arc<dyn Downloader>,
        ftp: Arc<FtpDownloader>,
        torrent: Arc<dyn Downloader>,
    ) -> Self {
        Self { http, ftp, torrent }
    }
}

#[async_trait]
impl Downloader for ProtocolDownloader {
    async fn start(&self, task: TaskHandle) {
        use crate::types::DownloadKind;
        let (url, kind) = {
            let t = task.lock().await;
            (t.request.url.clone(), t.request.kind)
        };
        let scheme = url
            .split_once(':')
            .map(|(s, _)| s.trim().to_ascii_lowercase());
        match (scheme.as_deref(), kind) {
            (Some("ftp"), _) => self.ftp.start(task).await,
            (Some("magnet"), _) | (_, Some(DownloadKind::Torrent)) => {
                self.torrent.start(task).await
            }
            _ => self.http.start(task).await,
        }
    }

    fn cancel(&self, id: &str) {
        self.http.cancel(id);
        self.ftp.cancel(id);
        self.torrent.cancel(id);
    }
}
