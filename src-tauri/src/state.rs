use speusis_core::event_bus::EventBus;
use speusis_core::ip_blocklist::IpBlocklist;
use speusis_core::plugin_manager::PluginManager;
use speusis_core::rss_manager::RssManager;
use speusis_core::scheduler::Scheduler;
use speusis_core::settings_manager::SettingsManager;
use speusis_core::torrent_downloader::TorrentManager;
use speusis_core::types::AppSettings;
use std::path::PathBuf;
use std::sync::{Arc, RwLock as StdRwLock};
use tokio::sync::Mutex;

/// Shared app state, injected via `tauri::Manager::manage`.
///
/// `settings_snapshot` exists because `HttpDirectDownloader` needs plain
/// synchronous closures (`Arc<dyn Fn() -> u64 + Send + Sync>`) for reading
/// live settings mid-download (speed limit, retries, credentials), but
/// `SettingsManager` itself is behind an async `tokio::Mutex` for
/// load/persist. The snapshot is the fast-read copy; every `settings_update`
/// call refreshes both together — see `commands::settings_update`.
///
/// `settings` is `Arc<Mutex<..>>` (not a bare `Mutex<..>`) specifically so
/// `PluginManager` can hold its own `Arc` to the same instance rather than a
/// second, out-of-sync copy.
///
/// `torrent_manager` is an `Arc<TorrentManager>` so commands can call its
/// management API (file listing, file selection) while the scheduler holds a
/// separate `Arc<dyn Downloader>` reference for actual downloading.
///
/// `pending_patch` stores the path of a downloaded update installer that
/// `update_apply_patch` will invoke.
///
/// `pending_update` stores the most recent `UpdateInfo` found by either the
/// manual "Check for Updates" flow or the automatic startup check, so the
/// auto-update dialog (a separate native window, like every other panel)
/// has something to fetch on open instead of needing the payload passed
/// through the window-open call itself.
pub struct AppState {
    pub scheduler: Arc<Scheduler>,
    pub settings: Arc<Mutex<SettingsManager>>,
    pub settings_snapshot: Arc<StdRwLock<AppSettings>>,
    pub rss: Arc<RssManager>,
    pub ip_blocklist: Mutex<IpBlocklist>,
    pub event_bus: EventBus,
    pub torrent_manager: Arc<TorrentManager>,
    pub pending_patch: Mutex<Option<PathBuf>>,
    pub plugin_manager: Arc<PluginManager>,
    pub pending_update: StdRwLock<Option<speusis_core::update_checker::UpdateInfo>>,
}
