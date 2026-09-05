//! BitTorrent / magnet-link download support.
//!
//! Uses two crates:
//!   - `librqbit`    – full BitTorrent engine (DHT, tracker, peer-wire,
//!                     piece verification, seeding).
//!   - `lava_torrent` – pure-Rust .torrent parser/writer for `torrent_create`
//!                     and pre-download file listing.
//!
//! Design notes:
//!   - One librqbit `Session` is shared for the app's lifetime.
//!   - A DownloadTask's `url` is either a magnet: URI or an absolute path to
//!     a .torrent file. `kind` is always `DownloadKind::Torrent`.
//!   - Progress is polled every 400ms and forwarded to our `EventBus`.
//!   - Cancellation is driven by a per-task `oneshot::Sender` stored in a
//!     `StdMutex<HashMap>`.

use crate::downloader_trait::Downloader;
use crate::event_bus::EventBus;
use crate::scheduler::TaskHandle;
use crate::types::{
    AppEvent, DownloadCompleted, DownloadFailed, DownloadProgress, DownloadStarted,
    DownloadStatus, TorrentFileEntry, TorrentFileMeta, TorrentFilesReady,
};
use async_trait::async_trait;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, Session, SessionOptions};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

// ---------------------------------------------------------------------------
// Stand-alone helpers (no TorrentManager needed)
// ---------------------------------------------------------------------------

/// Parse raw .torrent bytes → TorrentFileEntry list (uses lava_torrent).
pub fn parse_torrent_file_entries(bytes: &[u8]) -> anyhow::Result<Vec<TorrentFileEntry>> {
    let t = lava_torrent::torrent::v1::Torrent::read_from_bytes(bytes)
        .map_err(|e| anyhow::anyhow!("Failed to parse .torrent: {e}"))?;
    let entries = match &t.files {
        Some(files) => files
            .iter()
            .enumerate()
            .map(|(i, f)| TorrentFileEntry {
                name: f.path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("file-{i}")),
                path: f.path.to_string_lossy().to_string(),
                length: f.length.max(0) as u64,
                selected: true,
                index: i as u32,
            })
            .collect(),
        None => vec![TorrentFileEntry {
            name: t.name.clone(),
            path: t.name.clone(),
            length: t.length.max(0) as u64,
            selected: true,
            index: 0,
        }],
    };
    Ok(entries)
}

/// Build a .torrent file from a local path and write it to `output_dir`.
/// Returns the path of the created file.
pub fn create_torrent_file(
    source_path: &str,
    output_dir: &str,
    name: Option<&str>,
    tracker: Option<&str>,
) -> anyhow::Result<String> {
    use lava_torrent::torrent::v1::TorrentBuilder;
    const PIECE_LEN: i64 = 262_144; // 256 KiB
    let source = std::path::Path::new(source_path);
    let torrent_name = name
        .map(str::to_string)
        .or_else(|| source.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "output".to_string());
    let mut builder = TorrentBuilder::new(source, PIECE_LEN).set_name(torrent_name.clone());
    if let Some(url) = tracker {
        builder = builder.set_announce(Some(url.to_string()));
    }
    let torrent = builder.build().map_err(|e| anyhow::anyhow!("TorrentBuilder: {e}"))?;
    let out = PathBuf::from(output_dir).join(format!("{torrent_name}.torrent"));
    torrent.write_into_file(&out).map_err(|e| anyhow::anyhow!("Write torrent: {e}"))?;
    Ok(out.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// TorrentManager
// ---------------------------------------------------------------------------

/// Per-task runtime state kept inside TorrentManager.
struct TaskEntry {
    handle: Arc<librqbit::ManagedTorrent>,
}

pub struct TorrentManager {
    session: Arc<Session>,
    event_bus: EventBus,
    /// live torrent handles keyed by our task-id
    tasks: AsyncMutex<HashMap<String, TaskEntry>>,
    /// cancel senders, keyed by task-id (std mutex so cancel() is sync)
    cancels: StdMutex<HashMap<String, oneshot::Sender<()>>>,
    /// per-file selected flags (true = download), keyed by task-id
    file_selections: StdMutex<HashMap<String, Vec<bool>>>,
}

impl TorrentManager {
    /// Create the shared librqbit session.
    /// `data_dir`     – where librqbit writes DHT state / session persistence.
    /// `download_dir` – default output folder (overridable per-task).
    pub async fn new(
        data_dir: PathBuf,
        download_dir: PathBuf,
        event_bus: EventBus,
    ) -> anyhow::Result<Arc<Self>> {
        tokio::fs::create_dir_all(&data_dir).await.ok();
        let opts = SessionOptions {
            disable_dht: false,
            disable_dht_persistence: false,
            listen_port_range: Some(6881..6890),
            enable_upnp_port_forwarding: false,
            ..Default::default()
        };
        let session = Session::new_with_opts(download_dir, opts)
            .await
            .map_err(|e| anyhow::anyhow!("librqbit session: {e}"))?;
        Ok(Arc::new(Self {
            session,
            event_bus,
            tasks: AsyncMutex::new(HashMap::new()),
            cancels: StdMutex::new(HashMap::new()),
            file_selections: StdMutex::new(HashMap::new()),
        }))
    }

    // -- File-selection API (called from commands.rs) -----------------------

    pub async fn get_file_entries(&self, task_id: &str) -> Option<Vec<TorrentFileEntry>> {
        let tasks = self.tasks.lock().await;
        let entry = tasks.get(task_id)?;
        let sels_guard = self.file_selections.lock().ok()?;
        let sel_clone: Option<Vec<bool>> = sels_guard.get(task_id).cloned();

        let entries: Vec<TorrentFileEntry> = entry.handle.with_metadata(|m| {
            let info = &m.info;
            match info.files.as_ref() {
                Some(files) => files
                    .iter()
                    .enumerate()
                    .map(|(i, f)| {
                        let is_sel = sel_clone.as_ref()
                            .and_then(|s| s.get(i).copied())
                            .unwrap_or(true);
                        let name = f.path.last()
                            .and_then(|p| std::str::from_utf8(p.as_ref()).ok())
                            .map(|s| if s.is_empty() { format!("file-{i}") } else { s.to_string() })
                            .unwrap_or_else(|| format!("file-{i}"));
                        let path = f.path.iter()
                            .filter_map(|p| std::str::from_utf8(p.as_ref()).ok())
                            .collect::<Vec<_>>()
                            .join("/");
                        TorrentFileEntry {
                            name,
                            path,
                            length: f.length,
                            selected: is_sel,
                            index: i as u32,
                        }
                    })
                    .collect(),
                None => {
                    let is_sel = sel_clone.as_ref()
                        .and_then(|s| s.first().copied())
                        .unwrap_or(true);
                    let nm = info.name.as_ref()
                        .and_then(|n| std::str::from_utf8(n.as_ref()).ok())
                        .unwrap_or("download")
                        .to_string();
                    vec![TorrentFileEntry {
                        name: nm.clone(),
                        path: nm,
                        length: info.length.unwrap_or(0),
                        selected: is_sel,
                        index: 0,
                    }]
                }
            }
        }).ok()?;
        Some(entries)
    }

    pub async fn update_file_selection(
        &self,
        task_id: &str,
        file_index: u32,
        selected: bool,
    ) -> anyhow::Result<()> {
        // Update bookkeeping
        {
            let mut sels = self.file_selections.lock().unwrap();
            let flags = sels.entry(task_id.to_string()).or_default();
            let idx = file_index as usize;
            if flags.len() <= idx {
                flags.resize(idx + 1, true);
            }
            flags[idx] = selected;
        }
        // Push to librqbit if the handle exists
        let tasks = self.tasks.lock().await;
        if let Some(entry) = tasks.get(task_id) {
            let only: Vec<usize> = {
                let sels = self.file_selections.lock().unwrap();
                sels.get(task_id)
                    .map(|flags| {
                        flags
                            .iter()
                            .enumerate()
                            .filter_map(|(i, &on)| if on { Some(i) } else { None })
                            .collect()
                    })
                    .unwrap_or_default()
            };
            // update_only_files is internal in librqbit v8; selection is applied
        // on the next add_torrent call via AddTorrentOptions::only_files.
        let _opt = if only.is_empty() { None } else { Some(only) };
        }
        Ok(())
    }

    // -- Internal download runner ------------------------------------------

    async fn run_inner(
        &self,
        task: &TaskHandle,
        cancel_rx: oneshot::Receiver<()>,
    ) -> anyhow::Result<()> {
        let (id, url, target_dir) = {
            let t = task.lock().await;
            (t.id.clone(), t.request.url.clone(), t.request.target_dir.clone())
        };
        crate::debug_log::log(&format!("torrent.run: id={id} url={url}"));

        // Build AddTorrent value
        let add_torrent = if url.starts_with("magnet:") {
            AddTorrent::from_url(&url)
        } else {
            let raw = tokio::fs::read(&url)
                .await
                .map_err(|e| anyhow::anyhow!("read .torrent '{}': {e}", url))?;
            AddTorrent::from_bytes(bytes::Bytes::from(raw))
        };

        // Build only_files from current selection bookkeeping
        let only_files: Option<Vec<usize>> = {
            let sels = self.file_selections.lock().unwrap();
            sels.get(&id).map(|flags| {
                flags
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &on)| if on { Some(i) } else { None })
                    .collect()
            })
        };

        let add_opts = AddTorrentOptions {
            overwrite: true,
            only_files,
            output_folder: Some(target_dir.clone()),
            ..Default::default()
        };

        let response = self
            .session
            .add_torrent(add_torrent, Some(add_opts))
            .await
            .map_err(|e| anyhow::anyhow!("add_torrent: {e}"))?;

        let handle: Arc<librqbit::ManagedTorrent> = match response {
            AddTorrentResponse::Added(_, h) | AddTorrentResponse::AlreadyManaged(_, h) => h,
            AddTorrentResponse::ListOnly(_) => {
                anyhow::bail!("Torrent metadata not yet available (list-only)");
            }
        };

        // Emit file list and record handle
        {
            let file_metas: Vec<TorrentFileMeta> = handle.with_metadata(|m| {
                let info = &m.info;
                match info.files.as_ref() {
                    Some(files) => files
                        .iter()
                        .enumerate()
                        .map(|(i, f)| TorrentFileMeta {
                            name: f.path.last()
                                .and_then(|p| std::str::from_utf8(p.as_ref()).ok())
                                .map(|s| if s.is_empty() { format!("file-{i}") } else { s.to_string() })
                                .unwrap_or_else(|| format!("file-{i}")),
                            length: f.length,
                            index: i as u32,
                        })
                        .collect(),
                    None => {
                        let nm = info.name.as_ref()
                            .and_then(|n| std::str::from_utf8(n.as_ref()).ok())
                            .unwrap_or("download")
                            .to_string();
                        vec![TorrentFileMeta {
                            name: nm,
                            length: info.length.unwrap_or(0),
                            index: 0,
                        }]
                    }
                }
            }).unwrap_or_default();

            // Populate task.torrent_files so the UI can show them immediately
            let torrent_entries: Vec<TorrentFileEntry> = file_metas
                .iter()
                .map(|f| TorrentFileEntry {
                    name: f.name.clone(),
                    path: f.name.clone(),
                    length: f.length,
                    selected: true,
                    index: f.index,
                })
                .collect();
            {
                let mut t = task.lock().await;
                t.torrent_files = Some(torrent_entries);
                t.started_at = Some(chrono::Utc::now().timestamp_millis());
            }

            let total_size = handle.stats().total_bytes;
            self.event_bus.emit(AppEvent::TorrentFilesReady(TorrentFilesReady {
                torrent_id: id.clone(),
                files: file_metas,
            }));
            self.event_bus.emit(AppEvent::DownloadStarted(DownloadStarted {
                id: id.clone(),
                url: url.clone(),
                size: total_size,
            }));
        }

        // Register handle so external calls (get_file_entries, update_file_selection) work
        self.tasks.lock().await.insert(id.clone(), TaskEntry { handle: Arc::clone(&handle) });

        // --- Progress polling loop ---
        let started = Instant::now();
        let mut last_have: u64 = 0;
        let mut last_tick = Instant::now();
        let mut cancelled = false;

        // We can't move cancel_rx into a separate task easily, so use select! inline.
        let mut cancel_rx = cancel_rx;
        loop {
            tokio::select! {
                biased;
                _ = &mut cancel_rx => {
                    cancelled = true;
                    break;
                }
                _ = tokio::time::sleep(Duration::from_millis(400)) => {}
            }

            let status = task.lock().await.status;
            if matches!(
                status,
                DownloadStatus::Cancelled | DownloadStatus::Paused | DownloadStatus::Completed | DownloadStatus::Failed
            ) {
                break;
            }

            let stats = handle.stats();
            let total = stats.total_bytes;
            let have = stats.progress_bytes;
            let tick_elapsed = last_tick.elapsed().as_secs_f64().max(0.001);
            let speed = have.saturating_sub(last_have) as f64 / tick_elapsed;
            last_have = have;
            last_tick = Instant::now();
            let eta = if speed > 0.0 { (total.saturating_sub(have)) as f64 / speed } else { 0.0 };

            {
                let mut t = task.lock().await;
                t.received_bytes = have;
                t.size = Some(total);
                t.peers = Some(stats.live.as_ref()
                    .map(|l| l.snapshot.peer_stats.live as u32)
                    .unwrap_or(0));
                if stats.finished {
                    t.is_seeding = Some(true);
                    t.uploaded_bytes = Some(stats.uploaded_bytes);
                    t.seed_ratio = Some(if total > 0 {
                        stats.uploaded_bytes as f64 / total as f64
                    } else {
                        0.0
                    });
                }
            }

            self.event_bus.emit(AppEvent::DownloadProgress(DownloadProgress {
                id: id.clone(),
                bytes_received: have,
                speed,
                eta,
                size: Some(total),
            }));

            if have >= total && total > 0 {
                break; // done
            }
            let _ = started;
        }

        // Remove the handle reference now that the poll loop is done
        self.tasks.lock().await.remove(&id);

        if cancelled {
            return Err(anyhow::anyhow!("Cancelled"));
        }

        // Check completion
        let stats = handle.stats();
        if stats.progress_bytes >= stats.total_bytes && stats.total_bytes > 0 {
            let torrent_name = handle.with_metadata(|m| {
                m.info.name.as_ref()
                    .and_then(|n| std::str::from_utf8(n.as_ref()).ok())
                    .unwrap_or("download")
                    .to_string()
            }).unwrap_or_else(|_| "download".to_string());
            let guessed_path = PathBuf::from(&target_dir).join(&torrent_name);

            // The guessed path (target_dir/torrent_name straight from the
            // .torrent's metadata) doesn't always match what librqbit
            // actually wrote to disk - Windows-illegal characters get
            // sanitized, name collisions get a "(1)" suffix, etc. That
            // mismatch was making the security scan report "file not found"
            // right after a real, successful download, and (combined with
            // librqbit returning AlreadyManaged for a torrent it still has
            // cached from an earlier run) was letting a redownload report
            // Completed instantly without the data actually being on disk.
            // Verify before trusting either the exact guess or the cached
            // stats: fall back to target_dir itself if the guess is wrong,
            // and if genuinely nothing exists on disk at all, report a real
            // failure instead of a false Completed.
            let output_path = if tokio::fs::metadata(&guessed_path).await.is_ok() {
                guessed_path.to_string_lossy().to_string()
            } else if tokio::fs::metadata(&target_dir).await.is_ok() {
                target_dir.clone()
            } else {
                let mut t = task.lock().await;
                t.status = DownloadStatus::Failed;
                t.last_error = Some("Torrent engine reported completion, but no output files were found on disk. Remove this download and try again.".to_string());
                let retry = t.retry_count;
                drop(t);
                self.event_bus.emit(AppEvent::DownloadFailed(DownloadFailed {
                    id,
                    reason: "Torrent engine reported completion, but no output files were found on disk. Remove this download and try again.".to_string(),
                    retry_count: retry,
                }));
                return Ok(());
            };

            {
                let mut t = task.lock().await;
                t.status = DownloadStatus::Completed;
                t.completed_at = Some(chrono::Utc::now().timestamp_millis());
                t.output_path = Some(output_path.clone());
            }
            self.event_bus.emit(AppEvent::DownloadCompleted(DownloadCompleted {
                id,
                path: output_path,
                duration: 0.0,
            }));
        }
        Ok(())
    }
}

#[async_trait]
impl Downloader for TorrentManager {
    async fn start(&self, task: TaskHandle) {
        let id = task.lock().await.id.clone();
        let (tx, rx) = oneshot::channel::<()>();
        self.cancels.lock().unwrap().insert(id.clone(), tx);

        let result = self.run_inner(&task, rx).await;

        // Clean up cancel entry (may already be gone if cancel() fired)
        self.cancels.lock().unwrap().remove(&id);
        self.tasks.lock().await.remove(&id);

        if let Err(e) = result {
            let mut t = task.lock().await;
            let is_cancel = e.to_string().contains("Cancelled");
            if !matches!(t.status, DownloadStatus::Paused | DownloadStatus::Completed) {
                t.status = if is_cancel {
                    DownloadStatus::Cancelled
                } else {
                    DownloadStatus::Failed
                };
                if !is_cancel {
                    t.last_error = Some(e.to_string());
                    let retry = t.retry_count;
                    let eid = t.id.clone();
                    drop(t);
                    self.event_bus.emit(AppEvent::DownloadFailed(DownloadFailed {
                        id: eid,
                        reason: e.to_string(),
                        retry_count: retry,
                    }));
                }
            }
        }
    }

    fn cancel(&self, id: &str) {
        if let Some(tx) = self.cancels.lock().unwrap().remove(id) {
            let _ = tx.send(());
        }
    }
}
