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
