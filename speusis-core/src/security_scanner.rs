//! Ported 1:1 from src/core/securityScanner.ts
use crate::types::SecurityScanStatus as ScanStatus;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityScanResult {
    pub status: ScanStatus,
    pub scanner: String,
    pub message: String,
    pub output: Option<String>,
}

async fn path_exists(path: impl AsRef<Path>) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}

/// Mirrors `latestDefenderPlatform(programData)`: pick the highest-versioned
/// Platform\<version>\MpCmdRun.exe under ProgramData, newest first.
async fn latest_defender_platform(program_data: &str) -> Option<PathBuf> {
    let platform_dir = Path::new(program_data).join("Microsoft").join("Windows Defender").join("Platform");
    let mut entries = tokio::fs::read_dir(&platform_dir).await.ok()?;
    let mut versions: Vec<(u64, u64, u64, u64, String)> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        let parts: Vec<&str> = name.split('.').collect();
        if parts.len() == 4 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
            let nums: Vec<u64> = parts.iter().map(|p| p.parse().unwrap_or(0)).collect();
            versions.push((nums[0], nums[1], nums[2], nums[3], name));
        }
    }
    versions.sort_by(|a, b| b.cmp(a)); // descending, matches the TS comparator
    for (_, _, _, _, version) in versions {
        let candidate = platform_dir.join(&version).join("MpCmdRun.exe");
        if path_exists(&candidate).await {
            return Some(candidate);
        }
    }
    None
}

/// Mirrors `findDefenderCommand()`.
async fn find_defender_command() -> Option<PathBuf> {
    let program_data = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    if let Some(cmd) = latest_defender_platform(&program_data).await {
        return Some(cmd);
    }

    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let program_files_x86 =
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());

    let candidates = [
        Path::new(&program_files).join("Windows Defender").join("MpCmdRun.exe"),
        Path::new(&program_files_x86).join("Windows Defender").join("MpCmdRun.exe"),
        Path::new(&system_root).join("System32").join("MpCmdRun.exe"),
    ];
    for candidate in candidates {
        if path_exists(&candidate).await {
            return Some(candidate);
        }
    }
    None
}

struct ProcessResult {
    code: Option<i32>,
    output: String,
}

/// Mirrors `runProcess(command, args, timeoutMs)`.
async fn run_process(command: &Path, args: &[&str], timeout_duration: Duration) -> ProcessResult {
    let mut cmd = Command::new(command);
    cmd.args(args);
    // Without this, MpCmdRun.exe briefly flashes a console window every
    // time a download completes and gets scanned - CREATE_NO_WINDOW tells
    // Windows to run it fully hidden instead. No effect on non-Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.output();
    match timeout(timeout_duration, child).await {
        Ok(Ok(output)) => {
            let mut combined = output.stdout;
            combined.extend_from_slice(&output.stderr);
            ProcessResult {
                code: output.status.code(),
                output: String::from_utf8_lossy(&combined).trim().to_string(),
            }
        }
        Ok(Err(e)) => ProcessResult { code: Some(-1), output: e.to_string() },
        Err(_) => ProcessResult { code: None, output: "Windows Defender scan timed out.".to_string() },
    }
}

fn has_threat_keywords(lower: &str) -> bool {
    lower.contains("threat")
        || lower.contains("found malware")
        || lower.contains("remediation")
        || lower.contains("infected")
        || lower.contains("detected")
}

/// Mirrors `scanPathWithWindowsDefender(filePath)`.
pub async fn scan_path_with_windows_defender(file_path: &str) -> SecurityScanResult {
    if cfg!(not(target_os = "windows")) {
        return SecurityScanResult {
            status: ScanStatus::Skipped,
            scanner: "Windows Defender".to_string(),
            message: "Windows Defender scan is available on Windows builds only.".to_string(),
            output: None,
        };
    }

    if !path_exists(file_path).await {
        return SecurityScanResult {
            status: ScanStatus::Failed,
            scanner: "Windows Defender".to_string(),
            message: "Downloaded file was not found for security scan.".to_string(),
            output: None,
        };
    }

    let Some(command) = find_defender_command().await else {
        return SecurityScanResult {
            status: ScanStatus::Failed,
            scanner: "Windows Defender".to_string(),
            message: "Windows Defender command-line scanner (MpCmdRun.exe) was not found on this system.".to_string(),
            output: None,
        };
    };

    // Small delay to ensure the file handle is fully released before Defender opens it.
    tokio::time::sleep(Duration::from_millis(800)).await;

    let result = run_process(
        &command,
        &["-Scan", "-ScanType", "3", "-File", file_path, "-DisableRemediation"],
        Duration::from_secs(30 * 60),
    )
    .await;
    let output = result.output;
    let lower = output.to_lowercase();

    if result.code == Some(0) {
        return SecurityScanResult {
            status: ScanStatus::Clean,
            scanner: "Windows Defender".to_string(),
            message: "No threats found.".to_string(),
            output: Some(output),
        };
    }

    if result.code == Some(2) {
        if has_threat_keywords(&lower) {
            return SecurityScanResult {
                status: ScanStatus::ThreatsFound,
                scanner: "Windows Defender".to_string(),
                message: "Windows Defender reported a possible threat in the downloaded file.".to_string(),
                output: Some(output),
            };
        }
        return SecurityScanResult {
            status: ScanStatus::Clean,
            scanner: "Windows Defender".to_string(),
            message: "Scan completed. No threat keywords detected. (Run Speusis Downloader as Administrator for full scanning capability.)".to_string(),
            output: Some(output),
        };
    }

    if has_threat_keywords(&lower) {
        return SecurityScanResult {
            status: ScanStatus::ThreatsFound,
            scanner: "Windows Defender".to_string(),
            message: "Windows Defender reported a possible threat in the downloaded file.".to_string(),
            output: Some(output),
        };
    }

    let is_access_issue = lower.contains("access")
        || lower.contains("permission")
        || lower.contains("denied")
        || lower.contains("service")
        || result.code == Some(13)
        || result.code == Some(5);

    let message = if is_access_issue {
        format!("Windows Defender scan failed — run Speusis Downloader as Administrator for full scanning. (Code {:?})", result.code)
    } else if result.code.is_none() {
        "Windows Defender scan timed out.".to_string()
    } else {
        format!("Windows Defender scan failed with code {}.", result.code.unwrap())
    };

    SecurityScanResult { status: ScanStatus::Failed, scanner: "Windows Defender".to_string(), message, output: Some(output) }
}
