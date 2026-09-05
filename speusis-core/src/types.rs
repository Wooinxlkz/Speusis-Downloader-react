//! Ported 1:1 from src/shared/types.ts and src/shared/events.ts
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFileEntry {
    pub name: String,
    pub path: String,
    pub length: u64,
    pub selected: bool,
    pub index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    Http,
    Torrent,
    Ftp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRequest {
    pub url: String,
    #[serde(rename = "targetDir")]
    pub target_dir: String,
    pub filename: Option<String>,
    #[serde(rename = "segmentCount")]
    pub segment_count: Option<u32>,
    pub kind: Option<DownloadKind>,
    pub label: Option<String>,
    #[serde(rename = "speedLimit")]
    pub speed_limit: Option<u64>,
    pub sequential: Option<bool>,
    /// The page the URL was captured from (browser extension only). Sent
    /// as the `Referer` header on every request for this download - a lot
    /// of video/stream CDNs 403 a HEAD/GET with no Referer or a mismatched
    /// one (hotlink protection), which used to make every such capture
    /// fail instantly with an unresolvable size, before this existed to
    /// send anywhere.
    pub referer: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecurityScanStatus {
    Pending,
    Clean,
    ThreatsFound,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityScanInfo {
    pub status: SecurityScanStatus,
    pub scanner: String,
    pub message: Option<String>,
    #[serde(rename = "scannedAt")]
    pub scanned_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    #[serde(flatten)]
    pub request: DownloadRequest,
    pub id: String,
    pub status: DownloadStatus,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "startedAt")]
    pub started_at: Option<i64>,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<i64>,
    pub size: Option<u64>,
    #[serde(rename = "receivedBytes")]
    pub received_bytes: u64,
    #[serde(rename = "outputPath")]
    pub output_path: Option<String>,
    #[serde(rename = "partPath")]
    pub part_path: Option<String>,
    #[serde(rename = "retryCount")]
    pub retry_count: u32,
    #[serde(rename = "partialBytes")]
    pub partial_bytes: Option<u64>,
    pub peers: Option<u32>,
    #[serde(rename = "torrentFiles")]
    pub torrent_files: Option<Vec<TorrentFileEntry>>,
    #[serde(rename = "isSeeding")]
    pub is_seeding: Option<bool>,
    #[serde(rename = "uploadedBytes")]
    pub uploaded_bytes: Option<u64>,
    #[serde(rename = "seedRatio")]
    pub seed_ratio: Option<f64>,
    #[serde(rename = "securityScan")]
    pub security_scan: Option<SecurityScanInfo>,
    /// Human-readable reason the download last failed (HEAD/GET status,
    /// network error, etc.). Previously this only ever went out as a
    /// one-shot DownloadFailed event and to debug.log - once a task sat
    /// in the list as "Failed" there was no way to see why without digging
    /// through the log file. Cleared on a fresh start/retry.
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteCredential {
    pub domain: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssFeed {
    pub id: String,
    pub url: String,
    pub name: String,
    pub enabled: bool,
    #[serde(rename = "lastFetched")]
    pub last_fetched: Option<i64>,
    pub filter: Option<String>,
    #[serde(rename = "targetDir")]
    pub target_dir: Option<String>,
    #[serde(rename = "autoDownload")]
    pub auto_download: bool,
    #[serde(rename = "fetchInterval")]
    pub fetch_interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrabLink {
    pub url: String,
    pub name: String,
    pub ext: String,
    #[serde(rename = "sizeHint")]
    pub size_hint: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccentColor {
    Blue,
    Green,
    Purple,
    Orange,
    Red,
    Teal,
    Slate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub download_dir: String,
    pub max_concurrent_downloads: u32,
    pub default_segments: u32,
    pub listener_port: u16,
    pub upload_limit: u64,
    pub download_limit: u64,
    pub allow_invalid_tls: bool,
    pub seed_ratio: f64,
    pub theme_mode: ThemeMode,
    pub accent_color: AccentColor,
    pub schedule_enabled: bool,
    pub schedule_start_hour: u8,
    pub schedule_start_minute: u8,
    pub schedule_stop_hour: u8,
    pub schedule_stop_minute: u8,
    pub peak_hours_enabled: bool,
    pub peak_start_hour: u8,
    pub peak_stop_hour: u8,
    pub peak_download_limit: u64,
    pub peak_upload_limit: u64,
    pub credentials: Vec<SiteCredential>,
    pub remote_access: bool,
    pub scan_completed_files: bool,
    pub auto_start_with_system: bool,
    pub minimize_to_tray: bool,
    pub file_type_routing: bool,
    pub ip_blocklist_url: String,
    pub max_retries: u32,
    pub temp_dir: String,
}

impl AppSettings {
    /// Mirrors the constructor defaults in settingsManager.ts exactly, except
    /// download_dir: the original always defaulted into the app's own
    /// AppData folder. Real download managers (IDM, uTorrent) keep settings/
    /// session state in AppData but default *downloaded files* to the user's
    /// actual Windows Downloads folder - so this now takes that resolved
    /// path separately and falls back to the old AppData behavior only if
    /// the OS Downloads folder couldn't be resolved for some reason.
    pub fn defaults(app_data_dir: &str, default_download_dir: &str) -> Self {
        let download_dir = if default_download_dir.trim().is_empty() {
            format!("{app_data_dir}/downloads")
        } else {
            default_download_dir.to_string()
        };
        Self {
            download_dir,
            max_concurrent_downloads: 3,
            default_segments: 8,
            listener_port: 9999,
            upload_limit: 0,
            download_limit: 0,
            allow_invalid_tls: false,
            seed_ratio: 1.0,
            theme_mode: ThemeMode::System,
            accent_color: AccentColor::Slate,
            schedule_enabled: false,
            schedule_start_hour: 9,
            schedule_start_minute: 0,
            schedule_stop_hour: 23,
            schedule_stop_minute: 0,
            peak_hours_enabled: false,
            peak_start_hour: 9,
            peak_stop_hour: 18,
            peak_download_limit: 0,
            peak_upload_limit: 0,
            credentials: vec![],
            remote_access: false,
            scan_completed_files: true,
            auto_start_with_system: true,
            minimize_to_tray: true,
            file_type_routing: true,
            ip_blocklist_url: String::new(),
            max_retries: 5,
            temp_dir: String::new(),
        }
    }
}

// ---- segment map (live per-segment progress, read from the resume manifest) ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentMapEntry {
    pub index: u32,
    pub start: u64,
    pub end: u64,
    pub received: u64,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentMapResponse {
    pub total_segments: u32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub segments: Vec<SegmentMapEntry>,
}

// ---- events.ts ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStarted { pub id: String, pub url: String, pub size: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress { pub id: String, pub bytes_received: u64, pub speed: f64, pub eta: f64, pub size: Option<u64> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadCompleted { pub id: String, pub path: String, pub duration: f64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFailed { pub id: String, pub reason: String, pub retry_count: u32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadPaused { pub id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResumed { pub id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityScanStarted { pub id: String, pub path: String, pub scanner: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityScanCompleted {
    pub id: String,
    pub path: String,
    pub scanner: String,
    pub status: SecurityScanStatus,
    pub message: String,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPeerAdded { pub torrent_id: String, pub peer_id: String, pub ip: String, pub port: u16, pub peer_count: Option<u32> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPieceVerified { pub torrent_id: String, pub piece_index: u32, pub valid: bool }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentCompleted { pub torrent_id: String, pub path: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSeeding { pub torrent_id: String, pub ratio: f64, pub uploaded_bytes: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFileMeta { pub name: String, pub length: u64, pub index: u32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFilesReady { pub torrent_id: String, pub files: Vec<TorrentFileMeta> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedLimitChanged { pub upload_limit: u64, pub download_limit: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssFeedFetched { pub feed_id: String, pub new_items: u32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssItemDownloaded { pub feed_id: String, pub item_title: String, pub task_id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasketUrlDropped { pub url: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpBlocked { pub torrent_id: String, pub ip: String }

/// Mirrors the EventMap union in events.ts. Tauri commands emit these via
/// `app_handle.emit("event-bus", AppEvent::DownloadProgress(payload))`,
/// which the renderer listens for exactly like it did `ipcRenderer.on("event-bus", ...)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum AppEvent {
    DownloadStarted(DownloadStarted),
    DownloadProgress(DownloadProgress),
    DownloadCompleted(DownloadCompleted),
    DownloadFailed(DownloadFailed),
    DownloadPaused(DownloadPaused),
    DownloadResumed(DownloadResumed),
    SecurityScanStarted(SecurityScanStarted),
    SecurityScanCompleted(SecurityScanCompleted),
    TorrentPeerAdded(TorrentPeerAdded),
    TorrentPieceVerified(TorrentPieceVerified),
    TorrentCompleted(TorrentCompleted),
    TorrentSeeding(TorrentSeeding),
    TorrentFilesReady(TorrentFilesReady),
    SpeedLimitChanged(SpeedLimitChanged),
    RssFeedFetched(RssFeedFetched),
    RssItemDownloaded(RssItemDownloaded),
    SchedulerStarted,
    SchedulerStopped,
    BasketUrlDropped(BasketUrlDropped),
    IpBlocked(IpBlocked),
}
