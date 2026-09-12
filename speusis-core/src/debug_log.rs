//! Minimal always-on debug tracing, separate from main.rs's crash-only
//! panic log. This build has no console attached in release
//! (windows_subsystem = "windows"), so eprintln! output goes nowhere -
//! writing to a file is the only way to see what's actually happening.
//! Temporary/diagnostic: once the download pipeline is confirmed working
//! end-to-end, most of these call sites can be deleted or gated behind a
//! debug flag.
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn init(path: PathBuf) {
    let _ = LOG_PATH.set(Some(path));
}

pub fn log(msg: &str) {
    let path = LOG_PATH.get_or_init(|| None);
    let Some(path) = path else { return };
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[unix:{secs}] {msg}");
    }
}

/// The folder both debug.log and crash.log (written separately by
/// main.rs's panic hook) live in — same directory, so this is the one
/// thing the Debug settings tab needs to know to open it or to find
/// crash.log, which this module doesn't otherwise track a path for.
pub fn log_dir() -> Option<PathBuf> {
    let path = LOG_PATH.get()?;
    let path = path.as_ref()?;
    path.parent().map(|p| p.to_path_buf())
}

/// Last `max_lines` lines of a log file, or an explanatory placeholder if
/// it doesn't exist yet — capped so a debug.log that's grown large over a
/// long session doesn't get shipped whole across IPC into the webview.
fn read_tail(path: &std::path::Path, max_lines: usize) -> String {
    let Ok(content) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

/// Verbose operational trace (every download's HEAD/GET resolution,
/// segment/torrent progress milestones, etc.) — the "what was it actually
/// doing" log.
pub fn read_debug_log(max_lines: usize) -> String {
    match log_dir() {
        Some(dir) => read_tail(&dir.join("debug.log"), max_lines),
        None => String::new(),
    }
}

/// Rust panics only — written by main.rs's panic hook, separate from the
/// trace above, so "did anything actually crash" doesn't require
/// scrolling past thousands of routine trace lines to find out.
pub fn read_crash_log(max_lines: usize) -> String {
    match log_dir() {
        Some(dir) => read_tail(&dir.join("crash.log"), max_lines),
        None => String::new(),
    }
}

/// Deletes both files outright rather than truncating in place - the next
/// `log()`/panic-hook write recreates whichever one is needed via
/// `OpenOptions::create(true)`, same as a fresh install.
pub fn clear_logs() {
    if let Some(dir) = log_dir() {
        let _ = std::fs::remove_file(dir.join("debug.log"));
        let _ = std::fs::remove_file(dir.join("crash.log"));
    }
}
