//! Ported 1:1 from src/core/download/httpDirectDownloader.ts.
//!
//! `AbortController`/`AbortSignal` map to `tokio_util::sync::CancellationToken`.
//! `task` being a shared JS object maps to the `TaskHandle` (`Arc<Mutex<DownloadTask>>`)
//! threaded through from scheduler.rs - see that file's doc comment.
use crate::downloader_trait::Downloader;
use crate::event_bus::EventBus;
use crate::file_manager::FileManager;
use crate::network_manager::{AuthCredential, NetworkManager};
use crate::scheduler::TaskHandle;
use crate::types::{
    AppEvent, DownloadCompleted, DownloadFailed, DownloadProgress, DownloadStarted, DownloadStatus,
    SiteCredential,
};
use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Segment {
    start: u64,
    end: u64,
    received: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResumeManifest {
    url: String,
    size: u64,
    #[serde(rename = "rangeSupported")]
    range_supported: bool,
    filename: String,
    segments: Vec<Segment>,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
}

struct Metadata {
    size: u64,
    range_supported: bool,
    filename: Option<String>,
}

struct ProgressSample {
    last_at: Instant,
    last_bytes: u64,
    speed: f64,
}

pub struct HttpDirectDownloader {
    event_bus: EventBus,
    network: Arc<NetworkManager>,
    files: Arc<FileManager>,
    get_download_limit_bps: Arc<dyn Fn() -> u64 + Send + Sync>,
    get_credentials: Arc<dyn Fn(&str) -> Option<SiteCredential> + Send + Sync>,
    get_max_retries: Arc<dyn Fn() -> u32 + Send + Sync>,
    get_temp_dir: Arc<dyn Fn() -> String + Send + Sync>,
    controllers: StdMutex<HashMap<String, CancellationToken>>,
    progress_samples: StdMutex<HashMap<String, ProgressSample>>,
}

impl HttpDirectDownloader {
    pub fn new(
        event_bus: EventBus,
        network: Arc<NetworkManager>,
        files: Arc<FileManager>,
        get_download_limit_bps: Arc<dyn Fn() -> u64 + Send + Sync>,
        get_credentials: Arc<dyn Fn(&str) -> Option<SiteCredential> + Send + Sync>,
        get_max_retries: Arc<dyn Fn() -> u32 + Send + Sync>,
        get_temp_dir: Arc<dyn Fn() -> String + Send + Sync>,
    ) -> Self {
        Self {
            event_bus,
            network,
            files,
            get_download_limit_bps,
            get_credentials,
            get_max_retries,
            get_temp_dir,
            controllers: StdMutex::new(HashMap::new()),
            progress_samples: StdMutex::new(HashMap::new()),
        }
    }

    fn resolve_auth(&self, url: &str) -> Option<AuthCredential> {
        let parsed = reqwest::Url::parse(url).ok()?;
        let domain = parsed.host_str()?;
        let cred = (self.get_credentials)(domain)?;
        Some(AuthCredential { username: cred.username, password: cred.password })
    }

    /// Builds the full set of headers a real browser sends on a
    /// cross-origin media request when hotlink protection is in play -
    /// not just Referer. Many CDNs (Google's video servers among them)
    /// also check `Origin` and the `Sec-Fetch-*` triad; a request with a
    /// correct Referer but missing these can still get rejected as
    /// non-browser traffic. Origin is derived from the referer's own
    /// scheme+host, same as a real browser would send it.
    fn hotlink_headers(referer: Option<&str>) -> HashMap<String, String> {
        let mut h = HashMap::new();
        let Some(r) = referer else { return h };
        h.insert("Referer".to_string(), r.to_string());
        if let Ok(parsed) = reqwest::Url::parse(r) {
            if let Some(host) = parsed.host_str() {
                let origin = match parsed.port() {
                    Some(p) => format!("{}://{}:{}", parsed.scheme(), host, p),
                    None => format!("{}://{}", parsed.scheme(), host),
                };
                h.insert("Origin".to_string(), origin);
            }
        }
        h.insert("Sec-Fetch-Site".to_string(), "cross-site".to_string());
        h.insert("Sec-Fetch-Mode".to_string(), "no-cors".to_string());
        h.insert("Sec-Fetch-Dest".to_string(), "video".to_string());
        h
    }

    /// Mirrors `resolveMetadata`: HEAD first, GET-with-Range(0-0) fallback,
    /// same as the original's two-step probe. `referer`, when the download
    /// came from the browser extension, gets sent on both requests -
    /// without it a lot of stream/video CDNs 403 hotlink-protected URLs
    /// on the very first request, which is what used to make every such
    /// capture fail instantly with no size ever resolved.
    async fn resolve_metadata(
        &self,
        url: &str,
        token: &CancellationToken,
        auth: Option<&AuthCredential>,
        referer: Option<&str>,
    ) -> anyhow::Result<Metadata> {
        let head_extra = Self::hotlink_headers(referer);
        crate::debug_log::log(&format!("resolve_metadata: HEAD {url}"));
        match self.network.head(url, &head_extra, auth).await {
            Ok(res) => {
                crate::debug_log::log(&format!("resolve_metadata: HEAD status={}", res.status()));
                if res.status().is_success() || res.status().as_u16() == 206 {
                    return Ok(Self::extract_metadata(&res));
                }
                if res.status().as_u16() == 401 {
                    anyhow::bail!("Authentication required (401) — add site credentials in Settings > Site Credentials");
                }
            }
            Err(e) => crate::debug_log::log(&format!("resolve_metadata: HEAD request itself FAILED (network/client error): {e}")),
        }

        if token.is_cancelled() {
            anyhow::bail!("Aborted");
        }

        let mut extra = Self::hotlink_headers(referer);
        extra.insert("Range".to_string(), "bytes=0-0".to_string());
        crate::debug_log::log(&format!("resolve_metadata: falling back to GET Range:bytes=0-0 {url}"));
        match self.network.get(url, extra, auth).await {
            Ok(res) => {
                crate::debug_log::log(&format!("resolve_metadata: GET-range status={}", res.status()));
                if res.status().as_u16() == 401 {
                    anyhow::bail!("Authentication required (401) — add site credentials in Settings > Site Credentials");
                }
                let status = res.status();
                if status.is_success() || status.as_u16() == 206 || status.as_u16() == 416 {
                    return Ok(Self::extract_metadata(&res));
                }
            }
            Err(e) => crate::debug_log::log(&format!("resolve_metadata: GET-range request itself FAILED (network/client error): {e}")),
        }

        if token.is_cancelled() {
            anyhow::bail!("Aborted");
        }
        // Do not continue with a zero-byte task after both metadata probes
        // failed. That used to turn a network/client failure into a later,
        // confusing file operation (and could make a failed request look
        // successful). The scheduler will surface this explicit error.
        anyhow::bail!("Unable to resolve download metadata: HEAD and ranged GET both failed");
    }

    fn extract_metadata(res: &reqwest::Response) -> Metadata {
        let headers = res.headers();
        let content_range = headers.get("content-range").and_then(|v| v.to_str().ok()).unwrap_or("");
        let content_length = headers.get("content-length").and_then(|v| v.to_str().ok()).unwrap_or("");
        let accept_ranges = headers.get("accept-ranges").and_then(|v| v.to_str().ok()).unwrap_or("");
        let disposition = headers.get("content-disposition").and_then(|v| v.to_str().ok()).unwrap_or("");
        let filename = regex::Regex::new(r#"(?i)filename="?([^";]+)"?"#)
            .unwrap()
            .captures(disposition)
            .map(|c| c[1].to_string());

        let (size, range_supported) = if res.status().as_u16() == 206 {
            let re = regex::Regex::new(r"/(\d+)$").unwrap();
            let size = re
                .captures(content_range)
                .and_then(|c| c[1].parse().ok())
                .unwrap_or_else(|| content_length.parse().unwrap_or(0));
            (size, true)
        } else {
            let size = content_length.parse().unwrap_or(0);
            (size, accept_ranges.eq_ignore_ascii_case("bytes"))
        };

        Metadata { size, range_supported, filename }
    }

    fn filename_from_url(url: &str) -> String {
        reqwest::Url::parse(url)
            .ok()
            .and_then(|u| u.path_segments().and_then(|s| s.filter(|s| !s.is_empty()).last().map(String::from)))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "download.bin".to_string())
    }

    async fn effective_limit(&self, task: &TaskHandle) -> u64 {
        let speed_limit = task.lock().await.request.speed_limit;
        match speed_limit {
            Some(l) if l > 0 => l,
            _ => (self.get_download_limit_bps)(),
        }
    }

    /// Mirrors `throttleIfNeeded`.
    async fn throttle_if_needed(&self, task: &TaskHandle, window_bytes: u64, window_start: Instant) {
        let limit_bps = self.effective_limit(task).await;
        if limit_bps == 0 {
            return;
        }
        let elapsed_sec = window_start.elapsed().as_secs_f64();
        let target_sec = window_bytes as f64 / limit_bps as f64;
        let delay = target_sec - elapsed_sec;
        if delay > 0.01 {
            tokio::time::sleep(Duration::from_secs_f64(delay.min(3.0))).await;
        }
    }

    /// Mirrors `withRetry`: exponential backoff, breaks immediately on pause
    /// or a 401, matches the original's retry-count bookkeeping on `task`.
    async fn with_retry<F, Fut, T>(&self, task: &TaskHandle, mut operation: F) -> anyhow::Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<T>>,
    {
        let max_attempts = (self.get_max_retries)();
        let mut last_error: Option<anyhow::Error> = None;

        for attempt in 0..=max_attempts {
            if task.lock().await.status == DownloadStatus::Paused {
                anyhow::bail!("Paused");
            }
            task.lock().await.retry_count = attempt;
            match operation().await {
                Ok(v) => return Ok(v),
                Err(e) => {
                    if task.lock().await.status == DownloadStatus::Paused {
                        return Err(e);
                    }
                    if e.to_string().contains("401") {
                        return Err(e);
                    }
                    last_error = Some(e);
                    if attempt >= max_attempts {
                        break;
                    }
                    let backoff_ms = (1000u64 * 2u64.pow(attempt)).min(30_000);
                    // Poll for pause during backoff instead of sleeping the whole
                    // interval blind, matching the TS version's setInterval check.
                    let deadline = Instant::now() + Duration::from_millis(backoff_ms);
                    loop {
                        if task.lock().await.status == DownloadStatus::Paused {
                            return Err(last_error.unwrap());
                        }
                        if Instant::now() >= deadline {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Unknown download error")))
    }

    /// Mirrors `emitProgress`: rolling-average speed with a 300ms sample gate.
    async fn emit_progress(&self, task: &TaskHandle, started: Instant) {
        let now = Instant::now();
        let (task_id, received_bytes, size) = {
            let t = task.lock().await;
            (t.id.clone(), t.received_bytes, t.size.unwrap_or(0))
        };

        let mut samples = self.progress_samples.lock().unwrap();
        let sample = samples.get(&task_id);
        let finished = size > 0 && received_bytes >= size;
        if let Some(s) = sample {
            if now.duration_since(s.last_at) < Duration::from_millis(300) && !finished {
                return;
            }
        }

        let last_at = sample.map(|s| s.last_at).unwrap_or(started);
        let last_bytes = sample.map(|s| s.last_bytes).unwrap_or(0);
        let elapsed_seconds = now.duration_since(last_at).as_secs_f64().max(0.001);
        let bytes_delta = received_bytes.saturating_sub(last_bytes) as f64;
        let instant_speed = bytes_delta / elapsed_seconds;
        let average_speed = received_bytes as f64 / now.duration_since(started).as_secs_f64().max(0.001);
        let speed = match sample {
            Some(s) => s.speed * 0.65 + instant_speed * 0.35,
            None => average_speed,
        };
        let safe_speed = if speed.is_finite() && speed > 0.0 { speed } else { average_speed };
        let remaining = (size.saturating_sub(received_bytes)) as f64;
        let eta = if safe_speed > 0.0 { remaining / safe_speed } else { 0.0 };

        samples.insert(task_id.clone(), ProgressSample { last_at: now, last_bytes: received_bytes, speed: safe_speed });
        drop(samples);

        self.event_bus.emit(AppEvent::DownloadProgress(DownloadProgress {
            id: task_id,
            bytes_received: received_bytes,
            speed: safe_speed,
            eta,
            size: if size > 0 { Some(size) } else { None },
        }));
    }

    fn create_segments(size: u64, count: u32) -> Vec<Segment> {
        let segment_size = size.div_ceil(count as u64);
        let mut segments = Vec::new();
        for i in 0..count as u64 {
            let start = i * segment_size;
            let end = (size.saturating_sub(1)).min(start + segment_size - 1);
            if start <= end {
                segments.push(Segment { start, end, received: 0 });
            }
        }
        segments
    }

    /// Mirrors `downloadSingle`.
    async fn download_single(
        &self,
        task: &TaskHandle,
        part_path: &str,
        token: &CancellationToken,
        auth: Option<&AuthCredential>,
    ) -> anyhow::Result<()> {
        let (url, referer) = {
            let t = task.lock().await;
            (t.request.url.clone(), t.request.referer.clone())
        };
        let response = self.with_retry(task, || {
            let extra = Self::hotlink_headers(referer.as_deref());
            self.network.get(&url, extra, auth)
        }).await?;

        if response.status().as_u16() == 401 {
            anyhow::bail!("Authentication required (401) — add site credentials in Settings > Site Credentials");
        }
        if !response.status().is_success() {
            anyhow::bail!("Download failed with HTTP {}", response.status());
        }

        let mut offset = 0u64;
        let start = Instant::now();
        let mut window_start = start;
        let mut window_bytes = 0u64;
        let mut stream = response.bytes_stream();

        loop {
            let chunk = tokio::select! {
                biased;
                _ = token.cancelled() => anyhow::bail!("Aborted"),
                next = stream.next() => next,
            };
            let Some(chunk) = chunk else { break };
            let chunk = chunk?;

            self.files.write_chunk(part_path, offset, &chunk).await?;
            offset += chunk.len() as u64;
            window_bytes += chunk.len() as u64;
            task.lock().await.received_bytes = offset;
            self.emit_progress(task, start).await;
            self.throttle_if_needed(task, window_bytes, window_start).await;
            if window_start.elapsed() >= Duration::from_secs(1) {
                window_start = Instant::now();
                window_bytes = 0;
            }
        }
        Ok(())
    }

    /// Mirrors `downloadSegment`.
    #[allow(clippy::too_many_arguments)]
    async fn download_segment(
        &self,
        task: &TaskHandle,
        part_path: &str,
        segment: Arc<Mutex<Segment>>,
        started: Instant,
        token: &CancellationToken,
        manifest: Arc<Mutex<ResumeManifest>>,
        resume_path: String,
        auth: Option<&AuthCredential>,
    ) -> anyhow::Result<()> {
        let (length, already_received, seg_start, seg_end) = {
            let s = segment.lock().await;
            (s.end - s.start + 1, s.received, s.start, s.end)
        };
        if already_received >= length {
            return Ok(());
        }

        let range_start = seg_start + already_received;
        let (url, referer) = {
            let t = task.lock().await;
            (t.request.url.clone(), t.request.referer.clone())
        };
        let range_header = format!("bytes={range_start}-{seg_end}");
        let response = self
            .with_retry(task, || {
                let mut extra = Self::hotlink_headers(referer.as_deref());
                extra.insert("Range".to_string(), range_header.clone());
                self.network.get(&url, extra, auth)
            })
            .await?;

        let status = response.status().as_u16();
        if status == 401 {
            anyhow::bail!("Authentication required (401) — add site credentials in Settings > Site Credentials");
        }
        if status == 416 {
            anyhow::bail!("Server rejected byte range request");
        }
        if !response.status().is_success() && status != 206 {
            anyhow::bail!("Segment failed with HTTP {status}");
        }

        let mut offset = range_start;
        let mut window_start = Instant::now();
        let mut window_bytes = 0u64;
        let mut stream = response.bytes_stream();
        let mut last_save = Instant::now() - Duration::from_secs(10);

        loop {
            let chunk = tokio::select! {
                biased;
                _ = token.cancelled() => anyhow::bail!("Aborted"),
                next = stream.next() => next,
            };
            let Some(chunk) = chunk else { break };
            let chunk = chunk?;

            self.files.write_chunk(part_path, offset, &chunk).await?;
            offset += chunk.len() as u64;
            {
                let mut s = segment.lock().await;
                s.received += chunk.len() as u64;
            }
            window_bytes += chunk.len() as u64;
            {
                let mut t = task.lock().await;
                t.received_bytes += chunk.len() as u64;
                t.partial_bytes = Some(t.received_bytes);
            }
            self.emit_progress(task, started).await;
            Self::save_manifest(&manifest, &resume_path, &self.files, &mut last_save, false).await;
            self.throttle_if_needed(task, window_bytes, window_start).await;
            if window_start.elapsed() >= Duration::from_secs(1) {
                window_start = Instant::now();
                window_bytes = 0;
            }
        }
        Self::save_manifest(&manifest, &resume_path, &self.files, &mut last_save, true).await;
        Ok(())
    }

    /// Mirrors the `save(force)` closure in `downloadSegmented`: throttled to
    /// once per 500ms unless forced.
    async fn save_manifest(
        manifest: &Arc<Mutex<ResumeManifest>>,
        resume_path: &str,
        _files: &FileManager,
        last_save: &mut Instant,
        force: bool,
    ) {
        let now = Instant::now();
        if !force && now.duration_since(*last_save) < Duration::from_millis(500) {
            return;
        }
        *last_save = now;
        let mut m = manifest.lock().await;
        m.updated_at = chrono::Utc::now().timestamp_millis();
        let _ = FileManager::write_json(resume_path, &*m).await;
    }

    /// Mirrors `downloadSegmented`.
    #[allow(clippy::too_many_arguments)]
    async fn download_segmented(
        &self,
        task: &TaskHandle,
        part_path: &str,
        resume_path: &str,
        filename: &str,
        size: u64,
        count: u32,
        token: &CancellationToken,
        auth: Option<&AuthCredential>,
    ) -> anyhow::Result<()> {
        let segment_count = count.max(1);
        let url = task.lock().await.request.url.clone();

        let saved = FileManager::read_json::<ResumeManifest>(resume_path).await;
        let segments: Vec<Segment> = match saved {
            Some(s) if s.url == url && s.size == size && s.segments.len() as u32 == segment_count => s
                .segments
                .into_iter()
                .map(|mut seg| {
                    seg.received = seg.received.min(seg.end - seg.start + 1);
                    seg
                })
                .collect(),
            _ => Self::create_segments(size, segment_count),
        };

        let received_total: u64 = segments.iter().map(|s| s.received).sum();
        {
            let mut t = task.lock().await;
            t.received_bytes = received_total;
            t.partial_bytes = Some(received_total);
        }

        let manifest = Arc::new(Mutex::new(ResumeManifest {
            url,
            size,
            range_supported: true,
            filename: filename.to_string(),
            segments: segments.clone(),
            updated_at: chrono::Utc::now().timestamp_millis(),
        }));

        let started = Instant::now();
        self.emit_progress(task, started).await;
        let mut last_save = Instant::now() - Duration::from_secs(10);
        Self::save_manifest(&manifest, resume_path, &self.files, &mut last_save, true).await;

        let segment_handles: Vec<Arc<Mutex<Segment>>> = segments.into_iter().map(|s| Arc::new(Mutex::new(s))).collect();

        let futures = segment_handles.iter().map(|seg| {
            self.download_segment(task, part_path, Arc::clone(seg), started, token, Arc::clone(&manifest), resume_path.to_string(), auth)
        });
        let results: Vec<anyhow::Result<()>> = futures::future::join_all(futures).await;

        // update manifest with final per-segment state before the last save
        {
            let mut m = manifest.lock().await;
            let mut updated_segments = Vec::with_capacity(segment_handles.len());
            for seg in &segment_handles {
                updated_segments.push(seg.lock().await.clone());
            }
            m.segments = updated_segments;
        }
        Self::save_manifest(&manifest, resume_path, &self.files, &mut last_save, true).await;

        for r in results {
            r?;
        }
        Ok(())
    }
}

impl HttpDirectDownloader {
    /// Mirrors the try body of `start(task)`: everything between setting up
    /// the AbortController and the final `return task` / catch block.
    async fn run(
        &self,
        task: &TaskHandle,
        token: &CancellationToken,
        part_path_out: &mut Option<String>,
        started: Instant,
    ) -> anyhow::Result<()> {
        let url = task.lock().await.request.url.clone();
        let requested_filename = task.lock().await.request.filename.clone();
        let target_dir = task.lock().await.request.target_dir.clone();
        let segment_count = task.lock().await.request.segment_count;
        crate::debug_log::log(&format!("run: url={url} target_dir='{target_dir}' filename={requested_filename:?} segments={segment_count:?}"));

        let auth = self.resolve_auth(&url);
        let referer = task.lock().await.request.referer.clone();
        crate::debug_log::log("run: calling resolve_metadata...");
        let metadata = self.resolve_metadata(&url, token, auth.as_ref(), referer.as_deref()).await?;
        crate::debug_log::log(&format!("run: resolve_metadata OK - size={} range_supported={} filename={:?}", metadata.size, metadata.range_supported, metadata.filename));
        let filename = FileManager::sanitize_filename(
            &requested_filename
                .filter(|f| !f.is_empty())
                .or_else(|| metadata.filename.clone())
                .unwrap_or_else(|| Self::filename_from_url(&url)),
        );
        crate::debug_log::log(&format!("run: resolved filename={filename}"));

        crate::debug_log::log(&format!("run: ensure_directory('{target_dir}')..."));
        FileManager::ensure_directory(&target_dir).await?;
        crate::debug_log::log("run: ensure_directory OK");

        let temp_dir_setting = (self.get_temp_dir)();
        let part_dir = if temp_dir_setting.trim().is_empty() { target_dir.clone() } else { temp_dir_setting };
        if part_dir != target_dir {
            FileManager::ensure_directory(&part_dir).await?;
        }
        let part_path = FileManager::get_part_path(&part_dir, &filename).to_string_lossy().to_string();
        let final_path = FileManager::get_final_path(&target_dir, &filename).to_string_lossy().to_string();
        crate::debug_log::log(&format!("run: part_path={part_path} final_path={final_path}"));
        *part_path_out = Some(part_path.clone());
        let size = metadata.size;

        let task_id = {
            let mut t = task.lock().await;
            t.size = Some(size);
            t.output_path = Some(final_path.clone());
            t.part_path = Some(part_path.clone());
            t.started_at = Some(chrono::Utc::now().timestamp_millis());
            t.id.clone()
        };

        self.event_bus.emit(AppEvent::DownloadStarted(DownloadStarted { id: task_id.clone(), url: url.clone(), size }));
        crate::debug_log::log(&format!("run: emitted DownloadStarted for id={task_id}"));

        let resume_path = FileManager::get_resume_path(&part_path);

        if !metadata.range_supported || size == 0 {
            crate::debug_log::log("run: taking SINGLE-STREAM path");
            FileManager::remove(&resume_path).await?;
            self.files.open_for_writing(&part_path, 0).await?;
            crate::debug_log::log("run: open_for_writing OK, starting download_single...");
            self.download_single(task, &part_path, token, auth.as_ref()).await?;
            crate::debug_log::log("run: download_single finished OK");
        } else {
            crate::debug_log::log(&format!("run: taking SEGMENTED path, size={size}"));
            self.files.open_for_writing(&part_path, size).await?;
            crate::debug_log::log("run: open_for_writing OK, starting download_segmented...");
            self.download_segmented(
                task,
                &part_path,
                &resume_path,
                &filename,
                size,
                segment_count.unwrap_or(8),
                token,
                auth.as_ref(),
            )
            .await?;
            crate::debug_log::log("run: download_segmented finished OK");
        }

        self.files.finalize(&part_path, &final_path).await?;
        FileManager::remove(&resume_path).await?;
        crate::debug_log::log(&format!("run: finalized, id={task_id} COMPLETE"));

        {
            let mut t = task.lock().await;
            t.status = DownloadStatus::Completed;
            t.completed_at = Some(chrono::Utc::now().timestamp_millis());
        }
        self.event_bus.emit(AppEvent::DownloadCompleted(DownloadCompleted {
            id: task_id,
            path: final_path,
            duration: started.elapsed().as_secs_f64() * 1000.0,
        }));
        Ok(())
    }
}

#[async_trait]
impl Downloader for HttpDirectDownloader {
    /// Mirrors `start(task)`.
    async fn start(&self, task: TaskHandle) {
        let started = Instant::now();
        let token = CancellationToken::new();
        let task_id = task.lock().await.id.clone();
        crate::debug_log::log(&format!("HttpDirectDownloader.start: entered for id={task_id}"));
        self.controllers.lock().unwrap().insert(task_id.clone(), token.clone());

        let mut part_path: Option<String> = None;
        let result = self.run(&task, &token, &mut part_path, started).await;
        crate::debug_log::log(&format!("HttpDirectDownloader.start: run() returned for id={task_id}, is_err={}", result.is_err()));

        self.controllers.lock().unwrap().remove(&task_id);
        self.progress_samples.lock().unwrap().remove(&task_id);

        if let Err(e) = result {
            crate::debug_log::log(&format!("HttpDirectDownloader.start: id={task_id} FAILED with error: {e}"));
            if let Some(pp) = &part_path {
                self.files.close_file(pp).await;
            }
            let mut t = task.lock().await;
            if t.status != DownloadStatus::Paused {
                t.status = if token.is_cancelled() { DownloadStatus::Cancelled } else { DownloadStatus::Failed };
                if t.status == DownloadStatus::Failed { t.last_error = Some(e.to_string()); }
                let retry_count = t.retry_count;
                let id = t.id.clone();
                drop(t);
                self.event_bus.emit(AppEvent::DownloadFailed(DownloadFailed { id, reason: e.to_string(), retry_count }));
            }
        }
    }

    /// Mirrors `cancel(id)`. controllers is a plain std::sync::Mutex (never
    /// held across an .await anywhere in this file) so this can stay a
    /// genuinely synchronous fn, matching the original's synchronous `cancel`.
    fn cancel(&self, id: &str) {
        if let Some(token) = self.controllers.lock().unwrap().get(id) {
            token.cancel();
        }
    }
}
