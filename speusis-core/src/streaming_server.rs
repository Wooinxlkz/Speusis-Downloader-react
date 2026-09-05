//! Local HTTP file-streaming server.
//!
//! Binds on 127.0.0.1:47811 (the hard-coded port returned by
//! `download_streaming_url`).  The frontend points a `<video>` or `<audio>`
//! element (or an `<img>`) at `http://127.0.0.1:47811/stream/{task_id}` and
//! this server resolves the task to its on-disk file and serves it, including
//! RFC 7233 byte-range (`206 Partial Content`) support so browsers can seek.
//!
//! Runs in a dedicated OS thread (same pattern as listener.rs) so it never
//! contends with Tokio's scheduler.

use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;
use tiny_http::{Header, Response, Server};

pub const STREAMING_PORT: u16 = 47811;

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, OPTIONS"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"range"[..]).unwrap(),
        Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
    ]
}

/// Start the streaming server on a background thread.
///
/// `resolve_path` is called with a task-id and returns the on-disk file path
/// for that task (or `None` if the task isn't found / has no output yet).
pub fn start(
    resolve_path: Arc<dyn Fn(&str) -> Option<String> + Send + Sync + 'static>,
) {
    let addr = format!("127.0.0.1:{STREAMING_PORT}");
    let server = match Server::http(&addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[streaming] bind {addr} failed: {e} - in-app preview won't work");
            return;
        }
    };
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_request(request, &resolve_path);
        }
    });
}

fn handle_request(
    request: tiny_http::Request,
    resolve_path: &Arc<dyn Fn(&str) -> Option<String> + Send + Sync>,
) {
    use tiny_http::Method;

    let method = request.method().clone();
    let url = request.url().to_string();

    // Pre-flight
    if method == Method::Options {
        let r = cors_headers().into_iter().fold(Response::empty(204), |r, h| r.with_header(h));
        let _ = request.respond(r);
        return;
    }

    // Only GET /stream/{id}
    if method != Method::Get {
        let _ = request.respond(Response::empty(405));
        return;
    }

    let task_id = match url.strip_prefix("/stream/") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };

    let file_path = match resolve_path(&task_id) {
        Some(p) => p,
        None => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };

    let mut file = match std::fs::File::open(&file_path) {
        Ok(f) => f,
        Err(_) => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };

    let file_len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => {
            let _ = request.respond(Response::empty(500));
            return;
        }
    };

    // Detect MIME type from extension
    let mime = mime_for_path(&file_path);
    let content_type =
        Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap();

    // Parse Range header if present
    let range_header = request.headers().iter().find(|h| {
        h.field.equiv("Range")
    }).map(|h| h.value.as_str().to_string());

    if let Some(range_str) = range_header {
        // Parse "bytes=start-end" or "bytes=start-"
        if let Some((start, end)) = parse_range(&range_str, file_len) {
            let length = end - start + 1;
            if file.seek(SeekFrom::Start(start)).is_err() {
                let _ = request.respond(Response::empty(500));
                return;
            }
            let mut buf = vec![0u8; length as usize];
            let read = match file.read(&mut buf) {
                Ok(n) => n,
                Err(_) => {
                    let _ = request.respond(Response::empty(500));
                    return;
                }
            };
            buf.truncate(read);
            let actual_end = start + read as u64 - 1;

            let content_range = Header::from_bytes(
                &b"Content-Range"[..],
                format!("bytes {start}-{actual_end}/{file_len}").as_bytes(),
            )
            .unwrap();
            let content_length = Header::from_bytes(
                &b"Content-Length"[..],
                read.to_string().as_bytes(),
            )
            .unwrap();

            let response = Response::from_data(buf)
                .with_status_code(206)
                .with_header(content_type)
                .with_header(content_range)
                .with_header(content_length);
            let response = cors_headers().into_iter().fold(response, |r, h| r.with_header(h));
            let _ = request.respond(response);
        } else {
            // Unsatisfiable range
            let range_err = Header::from_bytes(
                &b"Content-Range"[..],
                format!("bytes */{file_len}").as_bytes(),
            )
            .unwrap();
            let _ = request.respond(Response::empty(416).with_header(range_err));
        }
    } else {
        // Full file response
        let content_length =
            Header::from_bytes(&b"Content-Length"[..], file_len.to_string().as_bytes()).unwrap();
        let response = Response::from_file(file)
            .with_status_code(200)
            .with_header(content_type)
            .with_header(content_length);
        let response = cors_headers().into_iter().fold(response, |r, h| r.with_header(h));
        let _ = request.respond(response);
    }
}

/// Parse a `bytes=start-end` or `bytes=start-` range string.
/// Returns `(start, end)` inclusive, clamped to `[0, file_len-1]`.
fn parse_range(range: &str, file_len: u64) -> Option<(u64, u64)> {
    if file_len == 0 {
        return None;
    }
    let range = range.trim().strip_prefix("bytes=")?;
    let mut parts = range.splitn(2, '-');
    let start_str = parts.next()?;
    let end_str = parts.next().unwrap_or("");

    if start_str.is_empty() {
        // Suffix range: bytes=-N (last N bytes)
        let suffix: u64 = end_str.trim().parse().ok()?;
        let start = file_len.saturating_sub(suffix);
        Some((start, file_len - 1))
    } else {
        let start: u64 = start_str.trim().parse().ok()?;
        if start >= file_len {
            return None;
        }
        let end = if end_str.trim().is_empty() {
            file_len - 1
        } else {
            end_str.trim().parse::<u64>().ok()?.min(file_len - 1)
        };
        if start > end {
            return None;
        }
        Some((start, end))
    }
}

fn mime_for_path(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}
