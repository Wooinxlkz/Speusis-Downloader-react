//! Local HTTP listener for the browser extension - a scoped port of
//! src/browser-integration/listener.ts. The ORIGINAL Electron listener also
//! served a remote web UI (/ui) and video streaming (/stream/:id) - neither
//! of those is ever called by the actual extension (checked service-worker.js
//! and download-dialog.js directly), so this only implements what the
//! extension needs: POST /downloads (submit a link) and GET /health (used
//! by some browsers' extension UI to show a connected/disconnected dot).
//! If you want the remote web UI or streaming back later, port the rest of
//! listener.ts the same way this was done.
use crate::scheduler::Scheduler;
use crate::types::{
    AppEvent, DownloadCompleted, DownloadFailed, DownloadKind, DownloadProgress, DownloadRequest,
    DownloadStarted, DownloadStatus,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock as StdRwLock};
use tiny_http::{Header, Method, Response, Server};

#[derive(Debug, Deserialize)]
struct IncomingDownload {
    url: String,
    filename: Option<String>,
    start: Option<bool>,
    /// Optional save directory sent by the browser extension.
    /// When present it overrides the app's default download directory
    /// for this one download only — the setting itself is not changed.
    #[serde(rename = "saveDir")]
    save_dir: Option<String>,
    /// The page the extension captured this URL from. A lot of video/
    /// stream CDNs reject a request with no Referer or a mismatched one
    /// (hotlink protection) - forwarding this as the Referer header on
    /// every request for the download is what actually fixes those
    /// captures failing instantly with an unresolvable size. See
    /// DownloadRequest::referer for where this ends up.
    #[serde(rename = "pageUrl")]
    page_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct AcceptedResponse {
    id: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    app: &'static str,
    version: &'static str,
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"content-type, range, x-speusis-filename, x-speusis-savedir, x-speusis-total-size"[..]).unwrap(),
    ]
}

fn json_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
}

fn url_scheme(url: &str) -> Option<String> {
    url.split_once(':')
        .map(|(scheme, _)| scheme.trim().to_ascii_lowercase())
        .filter(|scheme| !scheme.is_empty())
}

fn is_extension_default_dir(path: &str) -> bool {
    path.trim_matches(|ch| ch == '\\' || ch == '/')
        .eq_ignore_ascii_case("downloads")
}

pub fn start(scheduler: Arc<Scheduler>, settings_snapshot: Arc<StdRwLock<crate::types::AppSettings>>, runtime_handle: tokio::runtime::Handle) {
    let (port, remote_access) = {
        let s = settings_snapshot.read().ok();
        s.map(|s| (s.listener_port, s.remote_access)).unwrap_or((9999, false))
    };
    let host = if remote_access { "0.0.0.0" } else { "127.0.0.1" };
    let addr = format!("{host}:{port}");

    let server = match Server::http(&addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[listener] Failed to bind {addr}: {e} - browser extension capture will not work until this is resolved (port already in use?).");
            return;
        }
    };

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let scheduler = Arc::clone(&scheduler);
            let settings_snapshot = Arc::clone(&settings_snapshot);
            let runtime_handle = runtime_handle.clone();
            // One OS thread per request. Previously every request (including
            // the new streamed-upload route, which can hold a connection
            // open for as long as a large video takes to transfer) was
            // handled one at a time on this single background thread - a
            // single in-progress stream would block health checks and every
            // other download request until it finished.
            std::thread::spawn(move || {
                handle_request(request, &scheduler, &settings_snapshot, &runtime_handle);
            });
        }
    });
}

fn handle_request(
    request: tiny_http::Request,
    scheduler: &Arc<Scheduler>,
    settings_snapshot: &Arc<StdRwLock<crate::types::AppSettings>>,
    runtime_handle: &tokio::runtime::Handle,
) {
    let method = request.method().clone();
    let url = request.url().to_string();

    if method == Method::Options {
        let response = Response::empty(204);
        let response = cors_headers().into_iter().fold(response, |r, h| r.with_header(h));
        let _ = request.respond(response);
        return;
    }

    if method == Method::Get && (url == "/health" || url == "/") {
        let body = serde_json::to_string(&HealthResponse { status: "ok", app: "Speusis Downloader", version: env!("CARGO_PKG_VERSION") }).unwrap_or_default();
        respond_json(request, 200, &body);
        return;
    }

    if method == Method::Post && url == "/downloads" {
        handle_add_download(request, scheduler, settings_snapshot, runtime_handle);
        return;
    }

    if method == Method::Post && url == "/downloads/stream" {
        handle_stream_download(request, scheduler, settings_snapshot, runtime_handle);
        return;
    }

    respond_json(request, 404, r#"{"error":"Not found"}"#);
}

fn handle_add_download(
    mut request: tiny_http::Request,
    scheduler: &Arc<Scheduler>,
    settings_snapshot: &Arc<StdRwLock<crate::types::AppSettings>>,
    runtime_handle: &tokio::runtime::Handle,
) {
    let mut body = String::new();
    if std::io::Read::read_to_string(request.as_reader(), &mut body).is_err() {
        respond_json(request, 400, r#"{"error":"Failed to read request body"}"#);
        return;
    }

    let incoming: IncomingDownload = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            let err = serde_json::to_string(&ErrorResponse { error: "Invalid JSON body".to_string() }).unwrap_or_default();
            respond_json(request, 400, &err);
            return;
        }
    };

    if incoming.url.trim().is_empty() {
        let err = serde_json::to_string(&ErrorResponse { error: "Missing URL".to_string() }).unwrap_or_default();
        respond_json(request, 400, &err);
        return;
    }

    // Keep the extension listener in sync with the in-app Add URL flow.
    // Magnet URIs use "magnet:" (not "magnet://"), so split_once("://")
    // would never recognize them.
    let scheme = url_scheme(&incoming.url);
    let (kind, segment_count, label) = match scheme.as_deref() {
        Some("http") | Some("https") => (DownloadKind::Http, Some(0u32), "Browser capture"),
        Some("ftp") => (DownloadKind::Ftp, Some(0u32), "Browser capture"),
        Some("magnet") => (DownloadKind::Torrent, None, "Browser capture (Torrent)"),
        _ => {
            let err = serde_json::to_string(&ErrorResponse {
                error: "Only http://, https://, ftp://, and magnet: links are supported.".to_string(),
            })
            .unwrap_or_default();
            respond_json(request, 400, &err);
            return;
        }
    };

    let (default_download_dir, segments) = {
        let s = settings_snapshot.read().ok();
        s.map(|s| (s.download_dir.clone(), s.default_segments)).unwrap_or_else(|| (String::new(), 8))
    };

    // The extension displays "Downloads\\" as a placeholder when the user has
    // not selected a real folder. Do not treat that relative placeholder as an
    // override, otherwise the app writes relative to its process directory
    // instead of the configured Downloads folder.
    let target_dir = incoming
        .save_dir
        .as_deref()
        .map(|d| d.trim())
        .filter(|d| !d.is_empty() && !is_extension_default_dir(d))
        .map(|d| d.to_string())
        .unwrap_or(default_download_dir);

    let scheduler = Arc::clone(scheduler);
    let start_flag = incoming.start.unwrap_or(true);
    let req = DownloadRequest {
        url: incoming.url,
        target_dir,
        filename: incoming.filename,
        segment_count: if segment_count == Some(0) { Some(segments) } else { segment_count },
        kind: Some(kind),
        label: Some(label.to_string()),
        speed_limit: None,
        sequential: None,
        referer: incoming.page_url,
    };

    let task = runtime_handle.block_on(async move { scheduler.add(req, start_flag).await });
    let body = serde_json::to_string(&AcceptedResponse { id: task.id, status: format!("{:?}", task.status).to_lowercase() }).unwrap_or_default();
    respond_json(request, 202, &body);
}

fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let response = Response::from_string(body).with_status_code(status).with_header(json_header());
    let response = cors_headers().into_iter().fold(response, |r, h| r.with_header(h));
    let _ = request.respond(response);
}

fn find_header(request: &tiny_http::Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.to_string().eq_ignore_ascii_case(name))
        .map(|h| h.value.to_string())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// `POST /downloads/stream` - the extension fetches the video itself (from
/// its own privileged context, using Chrome's real network stack) and
/// streams the response body straight through to us here, instead of
/// sending a URL for the app to fetch independently.
///
/// This exists because googlevideo.com (and CDNs like it) reject the app's
/// own HEAD/GET requests outright (403, on every header combination tried)
/// - almost certainly TLS/HTTP fingerprinting rather than anything at the
/// HTTP header level, which is why no amount of Referer/Origin/Sec-Fetch-*
/// tweaking on the Rust side ever fixed it. A real browser's fetch() to the
/// same URL succeeds, so the extension does the fetch and this endpoint
/// just receives the bytes and writes them to disk - same task lifecycle
/// (Queued -> Running -> Completed/Failed), same events, same file layout
/// (.part file, then finalize) as every other download in the app.
///
/// Expected request headers (all extension-supplied):
///   X-Speusis-Filename    (required, percent-encoded)
///   X-Speusis-SaveDir     (optional, percent-encoded - same semantics as
///                          IncomingDownload.save_dir above)
///   X-Speusis-Total-Size  (optional, bytes, from the extension's own fetch
///                          Content-Length - 0/absent means unknown)
/// Body: raw file bytes (chunked transfer is fine - tiny_http decodes it).
fn handle_stream_download(
    mut request: tiny_http::Request,
    scheduler: &Arc<Scheduler>,
    settings_snapshot: &Arc<StdRwLock<crate::types::AppSettings>>,
    runtime_handle: &tokio::runtime::Handle,
) {
    let filename_raw = find_header(&request, "X-Speusis-Filename");
    let save_dir_raw = find_header(&request, "X-Speusis-SaveDir");
    let total_size_raw = find_header(&request, "X-Speusis-Total-Size");

    let filename = match filename_raw.as_deref().map(|v| percent_decode(v.trim())) {
        Some(v) if !v.trim().is_empty() => v,
        _ => {
            respond_json(request, 400, r#"{"error":"Missing X-Speusis-Filename header"}"#);
            return;
        }
    };
    let total_size: u64 = total_size_raw.and_then(|v| v.trim().parse().ok()).unwrap_or(0);

    let (default_download_dir, _segments) = {
        let s = settings_snapshot.read().ok();
        s.map(|s| (s.download_dir.clone(), s.default_segments)).unwrap_or_else(|| (String::new(), 8))
    };
    let target_dir = save_dir_raw
        .as_deref()
        .map(|v| percent_decode(v.trim()))
        .filter(|d| !d.is_empty() && !is_extension_default_dir(d))
        .unwrap_or(default_download_dir);

    let synthetic_url = format!("browser-stream://{filename}");
    let req = DownloadRequest {
        url: synthetic_url.clone(),
        target_dir: target_dir.clone(),
        filename: Some(filename.clone()),
        segment_count: None,
        kind: Some(DownloadKind::Http),
        label: Some("Browser capture (streamed)".to_string()),
        speed_limit: None,
        sequential: None,
        referer: None,
    };

    // start:false - we drive this task's lifecycle ourselves below instead
    // of letting HttpDirectDownloader try (and fail) to fetch it.
    let scheduler_for_add = Arc::clone(scheduler);
    let snapshot = runtime_handle.block_on(async move { scheduler_for_add.add(req, false).await });
    let task_id = snapshot.id.clone();
    crate::debug_log::log(&format!(
        "handle_stream_download: id={task_id} accepted filename={filename} total_size={total_size} target_dir='{target_dir}'"
    ));

    let task_handle = match runtime_handle.block_on(async { scheduler.task_handle(&task_id).await }) {
        Some(h) => h,
        None => {
            respond_json(request, 500, r#"{"error":"internal: task not found right after creation"}"#);
            return;
        }
    };
    let event_bus = scheduler.event_bus();

    let files = crate::file_manager::FileManager::new();
    let part_path = crate::file_manager::FileManager::get_part_path(&target_dir, &filename).to_string_lossy().to_string();
    let final_path = crate::file_manager::FileManager::get_final_path(&target_dir, &filename).to_string_lossy().to_string();

    let setup: anyhow::Result<()> = runtime_handle.block_on(async {
        crate::file_manager::FileManager::ensure_directory(&target_dir).await?;
        files.open_for_writing(&part_path, total_size).await?;
        Ok(())
    });
    if let Err(e) = setup {
        let reason = format!("Could not prepare destination file: {e}");
        crate::debug_log::log(&format!("handle_stream_download: id={task_id} setup FAILED: {reason}"));
        runtime_handle.block_on(async {
            let mut t = task_handle.lock().await;
            t.status = DownloadStatus::Failed;
            t.last_error = Some(reason.clone());
        });
        event_bus.emit(AppEvent::DownloadFailed(DownloadFailed { id: task_id.clone(), reason: reason.clone(), retry_count: 0 }));
        let err = serde_json::to_string(&ErrorResponse { error: reason }).unwrap_or_default();
        respond_json(request, 500, &err);
        return;
    }

    runtime_handle.block_on(async {
        let mut t = task_handle.lock().await;
        t.status = DownloadStatus::Running;
        t.started_at = Some(chrono::Utc::now().timestamp_millis());
        t.part_path = Some(part_path.clone());
        if total_size > 0 {
            t.size = Some(total_size);
        }
    });
    event_bus.emit(AppEvent::DownloadStarted(DownloadStarted { id: task_id.clone(), url: synthetic_url, size: total_size }));
    crate::debug_log::log(&format!("handle_stream_download: id={task_id} started, writing to {part_path}"));

    let mut buf = [0u8; 65536];
    let mut offset: u64 = 0;
    let started = std::time::Instant::now();
    let mut last_progress_emit = std::time::Instant::now();
    let mut failure: Option<(String, bool)> = None; // (reason, is_cancel)

    loop {
        let cancelled_or_paused = runtime_handle.block_on(async {
            let t = task_handle.lock().await;
            t.status == DownloadStatus::Cancelled || t.status == DownloadStatus::Paused
        });
        if cancelled_or_paused {
            failure = Some(("Cancelled by user".to_string(), true));
            break;
        }

        let n = match std::io::Read::read(request.as_reader(), &mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                failure = Some((format!("Connection to browser extension lost: {e}"), false));
                break;
            }
        };
        let chunk = &buf[..n];
        let write_result = runtime_handle.block_on(async { files.write_chunk(&part_path, offset, chunk).await });
        if let Err(e) = write_result {
            failure = Some((format!("Disk write failed: {e}"), false));
            break;
        }
        offset += n as u64;

        if last_progress_emit.elapsed().as_millis() >= 400 {
            last_progress_emit = std::time::Instant::now();
            runtime_handle.block_on(async {
                task_handle.lock().await.received_bytes = offset;
            });
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let speed = offset as f64 / elapsed;
            let eta = if total_size > offset && speed > 0.0 { (total_size - offset) as f64 / speed } else { 0.0 };
            event_bus.emit(AppEvent::DownloadProgress(DownloadProgress {
                id: task_id.clone(),
                bytes_received: offset,
                speed,
                eta,
                size: if total_size > 0 { Some(total_size) } else { None },
            }));
        }
    }

    if let Some((reason, is_cancel)) = failure {
        runtime_handle.block_on(async { files.close_file(&part_path).await });
        runtime_handle.block_on(async {
            let mut t = task_handle.lock().await;
            t.status = if is_cancel { DownloadStatus::Cancelled } else { DownloadStatus::Failed };
            t.received_bytes = offset;
            if !is_cancel {
                t.last_error = Some(reason.clone());
            }
        });
        if !is_cancel {
            event_bus.emit(AppEvent::DownloadFailed(DownloadFailed { id: task_id.clone(), reason: reason.clone(), retry_count: 0 }));
        }
        crate::debug_log::log(&format!("handle_stream_download: id={task_id} ended: {reason} ({offset} bytes received)"));
        let err = serde_json::to_string(&ErrorResponse { error: reason }).unwrap_or_default();
        respond_json(request, if is_cancel { 499 } else { 502 }, &err);
        return;
    }

    let finalize_result = runtime_handle.block_on(async { files.finalize(&part_path, &final_path).await });
    if let Err(e) = finalize_result {
        let reason = format!("Could not finalize downloaded file: {e}");
        crate::debug_log::log(&format!("handle_stream_download: id={task_id} finalize FAILED: {reason}"));
        runtime_handle.block_on(async {
            let mut t = task_handle.lock().await;
            t.status = DownloadStatus::Failed;
            t.last_error = Some(reason.clone());
        });
        event_bus.emit(AppEvent::DownloadFailed(DownloadFailed { id: task_id.clone(), reason: reason.clone(), retry_count: 0 }));
        let err = serde_json::to_string(&ErrorResponse { error: reason }).unwrap_or_default();
        respond_json(request, 500, &err);
        return;
    }

    let duration = started.elapsed().as_secs_f64();
    runtime_handle.block_on(async {
        let mut t = task_handle.lock().await;
        t.status = DownloadStatus::Completed;
        t.completed_at = Some(chrono::Utc::now().timestamp_millis());
        t.output_path = Some(final_path.clone());
        t.received_bytes = offset;
        t.size = Some(offset);
        t.part_path = None;
    });
    event_bus.emit(AppEvent::DownloadCompleted(DownloadCompleted { id: task_id.clone(), path: final_path.clone(), duration }));
    crate::debug_log::log(&format!("handle_stream_download: id={task_id} COMPLETE, {offset} bytes -> {final_path}"));

    let body = serde_json::to_string(&AcceptedResponse { id: task_id, status: "completed".to_string() }).unwrap_or_default();
    respond_json(request, 200, &body);
}
