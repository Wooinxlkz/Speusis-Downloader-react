#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use speusis_core::downloader_trait::Downloader;
use speusis_core::event_bus::EventBus;
use speusis_core::file_manager::FileManager;
use speusis_core::ftp_downloader::{FtpDownloader, ProtocolDownloader};
use speusis_core::http_direct_downloader::HttpDirectDownloader;
use speusis_core::ip_blocklist::IpBlocklist;
use speusis_core::network_manager::NetworkManager;
use speusis_core::plugin_manager::PluginManager;
use speusis_core::rss_manager::{AddDownloadInput, RssManager};
use speusis_core::scheduler::Scheduler;
use speusis_core::settings_manager::SettingsManager;
use speusis_core::torrent_downloader::TorrentManager;
use speusis_core::types::{AppEvent, DownloadKind, DownloadRequest};
use state::AppState;
use std::sync::{Arc, RwLock as StdRwLock};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::sync::Mutex;

/// Logs any panic (message + location + a rough timestamp) to
/// %LOCALAPPDATA%\Speusis Downloader\crash.log instead of it vanishing silently - this
/// build is windows_subsystem = "windows" in release, so there's no
/// console attached and nothing prints even for an unhandled panic;
/// previously (with panic = "abort" in Cargo.toml) that also took the
/// whole app down instantly with zero record of why. Now a panic in a
/// background task just fails that task and gets logged here instead.
fn install_panic_hook() {
    let log_path = std::env::var("LOCALAPPDATA")
        .map(|dir| std::path::PathBuf::from(dir).join("Speusis Downloader").join("crash.log"))
        .ok();

    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message = info.payload().downcast_ref::<&str>().map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(no message)".to_string());
        let timestamp_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let entry = format!(
            "[unix:{}] panic at {}: {}\n",
            timestamp_secs,
            location,
            message
        );
        if let Some(path) = &log_path {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                use std::io::Write;
                let _ = file.write_all(entry.as_bytes());
            }
        }
        eprintln!("{entry}");
    }));
}

/// Bridges speusis-core's internal EventBus to the frontend, matching the
/// exact `event-bus` channel the real preload.ts/app.js already expect -
/// this is the direct replacement for Electron's ipcMain "event-bus" relay.
fn start_event_bridge(app: tauri::AppHandle, event_bus: EventBus) {
    let mut rx = event_bus.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = app.emit("event-bus", event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Reacts to `DownloadCompleted` by running the real Windows Defender scan
/// (if enabled in settings) and emitting `SecurityScanStarted`/`Completed` -
/// the original app triggered this the same way, automatically after each
/// download, not via a renderer-invoked command (app.js only *listens* for
/// these two events on `task.securityScan`, confirmed against the real source).
fn start_security_scan_reactor(app: tauri::AppHandle, event_bus: EventBus, settings_snapshot: Arc<StdRwLock<speusis_core::types::AppSettings>>) {
    use speusis_core::security_scanner::scan_path_with_windows_defender;
    use speusis_core::types::{SecurityScanCompleted, SecurityScanStarted};

    let mut rx = event_bus.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(AppEvent::DownloadCompleted(completed)) => {
                    let enabled = settings_snapshot.read().map(|s| s.scan_completed_files).unwrap_or(true);
                    if !enabled {
                        continue;
                    }
                    event_bus.emit(AppEvent::SecurityScanStarted(SecurityScanStarted {
                        id: completed.id.clone(),
                        path: completed.path.clone(),
                        scanner: "Windows Defender".to_string(),
                    }));
                    let result = scan_path_with_windows_defender(&completed.path).await;
                    event_bus.emit(AppEvent::SecurityScanCompleted(SecurityScanCompleted {
                        id: completed.id,
                        path: completed.path,
                        scanner: result.scanner,
                        status: result.status,
                        message: result.message,
                        output: result.output,
                    }));
                    let _ = &app; // app handle kept for future use (e.g. native notification on threat)
                }
                Ok(_) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn start_clipboard_monitor(app: tauri::AppHandle) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    tauri::async_runtime::spawn(async move {
        let mut last_seen = String::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if let Ok(text) = app.clipboard().read_text() {
                if text != last_seen
                    && (text.starts_with("http://") || text.starts_with("https://") || text.starts_with("magnet:"))
                {
                    last_seen = text.clone();
                    let _ = app.emit("clipboard-url-detected", text);
                }
            }
        }
    });
}

/// Scans launch/relaunch arguments for a .torrent file path (from Windows
/// double-clicking a .torrent file once Speusis is registered as its
/// handler) and queues it via the same logic the file-picker command uses.
/// Called both at initial startup (app not yet running) and from the
/// single-instance relaunch callback (app already running, user
/// double-clicked another .torrent file).
fn handle_launch_args(app: &tauri::AppHandle, args: &[String]) {
    let Some(torrent_path) = args.iter().skip(1).find(|a| a.to_lowercase().ends_with(".torrent")) else {
        return;
    };
    let path = torrent_path.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        speusis_core::debug_log::log(&format!("handle_launch_args: opening .torrent from {path}"));
        if let Err(e) = commands::add_torrent_from_path(&app, path).await {
            speusis_core::debug_log::log(&format!("handle_launch_args: failed to add torrent: {e}"));
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

fn main() {
    install_panic_hook();
    if let Ok(dir) = std::env::var("LOCALAPPDATA") {
        speusis_core::debug_log::init(std::path::PathBuf::from(dir).join("Speusis Downloader").join("debug.log"));
    }
            speusis_core::debug_log::log(&format!("=== Speusis Downloader v{} starting ===", env!("CARGO_PKG_VERSION")));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (double-clicking the exe again, a shortcut,
            // the browser extension trying to relaunch it, a .torrent file
            // now that we're registered as its handler, etc.) lands
            // here instead of starting a second process - same behavior
            // as IDM/most download managers. Just bring the existing
            // window forward, and if a .torrent file was the reason for
            // this relaunch, queue it too.
            handle_launch_args(app, &argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Only act on the key-down edge, not the key-up, so
                    // holding the combo doesn't fire repeatedly.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    use tauri_plugin_clipboard_manager::ClipboardExt;
                    let Ok(text) = app.clipboard().read_text() else { return };
                    let looks_like_a_link = text.starts_with("http://")
                        || text.starts_with("https://")
                        || text.starts_with("ftp://")
                        || text.starts_with("magnet:");
                    if !looks_like_a_link {
                        return;
                    }
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<AppState>();
                        let (download_dir, segments) = {
                            let snap = state.settings_snapshot.read().unwrap();
                            (snap.download_dir.clone(), snap.default_segments)
                        };
                        let request = DownloadRequest {
                            url: text,
                            target_dir: download_dir,
                            filename: None,
                            segment_count: Some(segments),
                            kind: Some(DownloadKind::Http),
                            label: None,
                            speed_limit: None,
                            sequential: None,
                            referer: None,
                        };
                        state.scheduler.add(request, true).await;
                        // Silent by design, same as the tray staying quiet -
                        // the item just shows up in the (already-open-or-not)
                        // window's list; no popup steals focus from whatever
                        // the user was doing when they pressed the hotkey.
                    });
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            // Clicking the OS close button (X) hides the window instead of
            // quitting the app - Speusis Downloader keeps running in the tray and
            // downloads keep going, same as IDM/most download managers.
            // The only real quit path is the tray menu's "Exit Speusis Downloader".
            // Scoped to the main window only - this used to apply to every
            // window including native panel dialogs (Options/RSS/About/etc),
            // so closing one of those from its own titlebar button silently
            // hid it instead of actually closing it, leaving it running
            // invisibly in the background instead of being freed.
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let app_data_dir = handle.path().app_config_dir().unwrap_or_default();
            std::fs::create_dir_all(&app_data_dir).ok();
            // Real Windows Downloads folder, e.g. C:\Users\<user>\Downloads -
            // matches IDM/uTorrent (their settings/session state live in
            // AppData like ours does, but downloaded files default to here,
            // not into AppData). Falls back to the old AppData\downloads
            // behavior if the OS path can't be resolved for some reason.
            let default_download_dir = handle.path().download_dir().unwrap_or_default();

            // --- Build the real backend (speusis-core), synchronously at
            // startup so every Tauri command has it ready via `state::<AppState>()` ---
            let event_bus = EventBus::new();
            let mut settings_manager = SettingsManager::new(&app_data_dir, &default_download_dir);
            let loaded_settings = tauri::async_runtime::block_on(async {
                settings_manager.load().await.ok();
                settings_manager.get().clone()
            });
            let settings_snapshot = Arc::new(StdRwLock::new(loaded_settings.clone()));
            let settings_shared = Arc::new(Mutex::new(settings_manager));

            // Storing auto_start_with_system=true as the default setting
            // only changes what gets saved to disk - it doesn't actually
            // register anything with Windows on its own. The Options
            // toggle reads the *real* OS registration state
            // (autolaunch().is_enabled()) in preference to this stored
            // value, so without this sync a fresh install would still
            // show the toggle as off despite the new default. Runs every
            // launch, not just first-run, so it also self-heals if
            // something external (Task Manager, antivirus) removed the
            // registration behind the app's back.
            {
                use tauri_plugin_autostart::ManagerExt;
                let autolaunch = handle.autolaunch();
                let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
                if loaded_settings.auto_start_with_system && !currently_enabled {
                    let _ = autolaunch.enable();
                } else if !loaded_settings.auto_start_with_system && currently_enabled {
                    let _ = autolaunch.disable();
                }
            }

            let network = Arc::new(NetworkManager::new());
            let files = Arc::new(FileManager::new());

            let snap_for_limit = Arc::clone(&settings_snapshot);
            let get_download_limit_bps: Arc<dyn Fn() -> u64 + Send + Sync> =
                Arc::new(move || snap_for_limit.read().map(|s| s.download_limit).unwrap_or(0));

            let snap_for_creds = Arc::clone(&settings_snapshot);
            let get_credentials: Arc<dyn Fn(&str) -> Option<speusis_core::types::SiteCredential> + Send + Sync> =
                Arc::new(move |domain: &str| {
                    snap_for_creds
                        .read()
                        .ok()
                        .and_then(|s| s.credentials.iter().find(|c| c.domain == domain).cloned())
                });

            let snap_for_retries = Arc::clone(&settings_snapshot);
            let get_max_retries: Arc<dyn Fn() -> u32 + Send + Sync> =
                Arc::new(move || snap_for_retries.read().map(|s| s.max_retries).unwrap_or(5));

            let snap_for_temp_dir = Arc::clone(&settings_snapshot);
            let get_temp_dir: Arc<dyn Fn() -> String + Send + Sync> =
                Arc::new(move || snap_for_temp_dir.read().map(|s| s.temp_dir.clone()).unwrap_or_default());

            let http_downloader = Arc::new(HttpDirectDownloader::new(
                event_bus.clone(),
                Arc::clone(&network),
                Arc::clone(&files),
                get_download_limit_bps,
                get_credentials,
                get_max_retries,
                get_temp_dir,
            ));
            let ftp_downloader = Arc::new(FtpDownloader::new(event_bus.clone(), Arc::clone(&files)));

            // --- BitTorrent engine ---
            let torrent_data_dir = app_data_dir.join("torrent-session");
            let torrent_download_dir = std::path::PathBuf::from(&loaded_settings.download_dir);
            let torrent_manager = tauri::async_runtime::block_on(async {
                TorrentManager::new(torrent_data_dir, torrent_download_dir, event_bus.clone()).await
            })?;
            // Pass a type-erased copy to ProtocolDownloader so it can dispatch
            // magnet: links and Torrent-kind tasks through the same engine.
            let torrent_dl: Arc<dyn Downloader> = Arc::clone(&torrent_manager) as Arc<dyn Downloader>;
            let protocol_downloader = Arc::new(ProtocolDownloader::new(
                http_downloader,
                ftp_downloader,
                torrent_dl,
            ));

            let snap_for_concurrency = Arc::clone(&settings_snapshot);
            let max_concurrent: Arc<dyn Fn() -> u32 + Send + Sync> =
                Arc::new(move || snap_for_concurrency.read().map(|s| s.max_concurrent_downloads).unwrap_or(3));

            let scheduler = Scheduler::new(event_bus.clone(), protocol_downloader, max_concurrent);

            // --- Local HTTP listener the browser extension posts to ---
            // (Nothing was bound to this port before v0.4.0, which is why the
            // extension always said "Speusis Downloader is not running" even with the app open.)
            {
                let scheduler_for_listener = Arc::clone(&scheduler);
                let settings_snapshot_for_listener = Arc::clone(&settings_snapshot);
                let runtime_handle = tauri::async_runtime::block_on(async { tokio::runtime::Handle::current() });
                speusis_core::listener::start(scheduler_for_listener, settings_snapshot_for_listener, runtime_handle);
            }

            // --- In-app file streaming server (port 47811) ---
            // Serves downloaded files with HTTP Range support so <video>/<audio>
            // elements can seek.  The URL is returned by download_streaming_url.
            {
                let sched_for_stream = Arc::clone(&scheduler);
                let rt_for_stream = tauri::async_runtime::block_on(async {
                    tokio::runtime::Handle::current()
                });
                let resolve_path: Arc<dyn Fn(&str) -> Option<String> + Send + Sync + 'static> =
                    Arc::new(move |task_id: &str| {
                        let id = task_id.to_string();
                        rt_for_stream.block_on(async {
                            sched_for_stream
                                .list()
                                .await
                                .into_iter()
                                .find(|t| t.id == id)
                                .and_then(|t| t.output_path.or(t.part_path))
                        })
                    });
                speusis_core::streaming_server::start(resolve_path);
            }

            // --- RSS manager ---
            let scheduler_for_rss = Arc::clone(&scheduler);
            let add_download_fn: speusis_core::rss_manager::AddDownloadFn = Arc::new(move |input: AddDownloadInput| {
                let scheduler = Arc::clone(&scheduler_for_rss);
                Box::pin(async move {
                    let request = DownloadRequest {
                        url: input.url,
                        target_dir: input.target_dir.unwrap_or_default(),
                        filename: input.filename,
                        segment_count: None,
                        kind: Some(DownloadKind::Http),
                        label: None,
                        speed_limit: None,
                        sequential: None,
                        referer: None,
                    };
                    scheduler.add(request, input.start).await
                })
            });
            let rss_data_dir = app_data_dir.join("rss");
            let rss = RssManager::new(rss_data_dir, event_bus.clone(), add_download_fn);
            {
                let rss = Arc::clone(&rss);
                tauri::async_runtime::spawn(async move {
                    let _ = rss.load().await;
                });
            }

            let ip_blocklist = Mutex::new(IpBlocklist::new());
            let blocklist_url = settings_snapshot.read().map(|s| s.ip_blocklist_url.clone()).unwrap_or_default();
            let settings_snapshot_for_scanner = Arc::clone(&settings_snapshot);

            // --- Plugin discovery (NOT execution - see plugin_manager.rs's
            // own doc comment: running plugin JS needs an embedded JS engine
            // that doesn't exist here yet). This just finds plugin.json
            // manifests under app_data_dir/plugins and validates them, so
            // the UI can show "3 plugins found" instead of the feature
            // being completely invisible. ---
            let plugins_dir = app_data_dir.join("plugins");
            std::fs::create_dir_all(&plugins_dir).ok();
            let plugin_manager = Arc::new(PluginManager::new(&plugins_dir, event_bus.clone(), Arc::clone(&settings_shared)));
            {
                let plugin_manager = Arc::clone(&plugin_manager);
                tauri::async_runtime::spawn(async move {
                    let found = plugin_manager.load_all().await;
                    if !found.is_empty() {
                        eprintln!("[Speusis Downloader] {} plugin manifest(s) found (discovery only, execution not implemented)", found.len());
                    }
                });
            }

            app.manage(AppState {
                scheduler,
                settings: settings_shared,
                settings_snapshot,
                rss,
                ip_blocklist,
                event_bus: event_bus.clone(),
                torrent_manager,
                pending_patch: Mutex::new(None),
                pending_update: StdRwLock::new(None),
                plugin_manager,
            });

            // Initial launch (app wasn't already running) with a .torrent
            // file as an argument - Windows does this when Speusis is
            // registered as the .torrent handler and the user double-clicks
            // one with no instance running yet. The already-running case is
            // handled by handle_launch_args() in the single-instance
            // callback above; this covers the cold-start case.
            handle_launch_args(&handle, &std::env::args().collect::<Vec<_>>());

            if !blocklist_url.is_empty() {
                let handle_for_blocklist = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle_for_blocklist.state::<AppState>();
                    state.ip_blocklist.lock().await.load(&blocklist_url).await;
                });
            }

            start_event_bridge(handle.clone(), event_bus.clone());
            start_security_scan_reactor(handle.clone(), event_bus.clone(), settings_snapshot_for_scanner);
            start_clipboard_monitor(handle.clone());

            // "CmdOrCtrl" resolves to Ctrl on Windows/Linux and Cmd on macOS -
            // same key combo OmniGet uses for its clipboard-download hotkey.
            if let Ok(shortcut) = "CmdOrCtrl+Shift+D".parse::<tauri_plugin_global_shortcut::Shortcut>() {
                let _ = app.global_shortcut().register(shortcut);
            }

            // --- system tray ---
            let show = MenuItem::with_id(app, "show", "Show Speusis Downloader", true, None::<&str>)?;

            let add_url = MenuItem::with_id(app, "add-url", "Add URL...", true, None::<&str>)?;
            let resume_all = MenuItem::with_id(app, "resume-all", "Resume All", true, None::<&str>)?;
            let stop_all = MenuItem::with_id(app, "stop-all", "Stop All", true, None::<&str>)?;

            // Speed Limiter submenu - these actually patch the live settings
            // snapshot the downloader reads from mid-transfer, not just a
            // label; the change takes effect on the next chunk written.
            let limit_unlimited = MenuItem::with_id(app, "limit-0", "Unlimited", true, None::<&str>)?;
            let limit_512k = MenuItem::with_id(app, "limit-512", "512 KB/s", true, None::<&str>)?;
            let limit_1m = MenuItem::with_id(app, "limit-1024", "1 MB/s", true, None::<&str>)?;
            let limit_5m = MenuItem::with_id(app, "limit-5120", "5 MB/s", true, None::<&str>)?;
            let speed_limiter = Submenu::with_id_and_items(
                app,
                "speed-limiter",
                "Speed Limiter",
                true,
                &[&limit_unlimited, &limit_512k, &limit_1m, &limit_5m],
            )?;

            let options = MenuItem::with_id(app, "settings", "Options", true, None::<&str>)?;
            let registration = MenuItem::with_id(app, "registration", "Registration", true, None::<&str>)?;
            let about = MenuItem::with_id(app, "about", "About Speusis Downloader", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit Speusis Downloader", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &PredefinedMenuItem::separator(app)?,
                    &add_url,
                    &resume_all,
                    &stop_all,
                    &PredefinedMenuItem::separator(app)?,
                    &speed_limiter,
                    &PredefinedMenuItem::separator(app)?,
                    &options,
                    &registration,
                    &about,
                    &PredefinedMenuItem::separator(app)?,
                    &exit,
                ],
            )?;

            /// Shows, un-minimizes, and focuses the main window - the same
            /// three-call sequence already used by the single-instance and
            /// launch-args handlers above, now reused here too. Previously
            /// this only called .show()+.set_focus(): if the window had been
            /// minimized (not hidden-to-tray, but actually minimized to the
            /// taskbar) rather than closed, show()/set_focus() alone don't
            /// reliably de-minimize it on Windows, which would make every
            /// tray menu item and the tray icon's own click look like it
            /// was doing nothing.
            fn bring_main_to_front(app: &tauri::AppHandle) {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }

            /// Shows + focuses the main window, then forwards `command` to
            /// the frontend's existing `nativeMenuActions` dispatch table
            /// (app.js already has real handlers for "add-url", "settings",
            /// "about", "registration", etc. - this reuses that, it isn't
            /// new frontend work).
            fn show_and_forward(app: &tauri::AppHandle, command: &str) {
                bring_main_to_front(app);
                let _ = app.emit("menu-command", command);
            }

            /// Patches `downloadLimit` on both the persisted SettingsManager
            /// and the fast-read snapshot the downloader's sync closures use -
            /// same two-copy update `commands::settings_update` does.
            fn apply_speed_limit(app: &tauri::AppHandle, kbps: u64) {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<AppState>();
                    let patch = serde_json::json!({ "downloadLimit": kbps * 1024 });
                    let mut settings = state.settings.lock().await;
                    if let Ok(updated) = settings.update(patch).await {
                        if let Ok(mut snap) = state.settings_snapshot.write() {
                            *snap = updated.clone();
                        }
                    }
                });
            }

            TrayIconBuilder::with_id("speusis-main-tray")
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                // On Windows this defaults to true - meaning a plain left
                // click was showing the context menu instead of ever
                // reaching our Click handler below, which is exactly why
                // clicking the tray icon (and by extension the "Show"
                // menu item's underlying logic) could look completely dead.
                // Left click now only ever triggers bring_main_to_front();
                // the menu itself still opens correctly on right click.
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => bring_main_to_front(app),
                    "add-url" => show_and_forward(app, "add-url"),
                    "resume-all" => show_and_forward(app, "resume-all"),
                    "stop-all" => show_and_forward(app, "stop-all"),
                    "settings" => show_and_forward(app, "settings"),
                    "registration" => show_and_forward(app, "registration"),
                    "about" => show_and_forward(app, "about"),
                    "limit-0" => apply_speed_limit(app, 0),
                    "limit-512" => apply_speed_limit(app, 512),
                    "limit-1024" => apply_speed_limit(app, 1024),
                    "limit-5120" => apply_speed_limit(app, 5120),
                    "exit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click brings the window forward - same as IDM's
                    // tray icon. A real double-click naturally fires this as
                    // two rapid clicks, so it's already covered without
                    // needing a separate DoubleClick match (the exact shape
                    // of that variant differs enough across Tauri versions
                    // that guessing at it isn't worth the risk here).
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        bring_main_to_front(tray.app_handle());
                    }
                })
                .build(app)?;

            // --- Automatic update check (IDM-style prompt) ---
            // Separate from the manual "Check for Updates" button in About:
            // that flow is untouched, its own event name (`update-available`),
            // its own banner UI, never calls into this dialog.
            // Runs once ~4s after launch (so the window has time to render
            // first), then keeps re-checking every 15 minutes for as long as
            // the app stays open - previously this only ever ran once at
            // startup, so a release published mid-session was never noticed
            // until the next relaunch.
            let startup_update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last_notified_version: Option<String> = None;
                let mut first_run = true;
                loop {
                    if first_run {
                        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                        first_run = false;
                    } else {
                        tokio::time::sleep(std::time::Duration::from_secs(15 * 60)).await;
                    }
                    let result = speusis_core::update_checker::check_for_update(
                        None,
                        env!("CARGO_PKG_VERSION"),
                    )
                    .await;
                    if let Some(info) = result.info {
                        // Don't re-nag with a dialog for the exact same
                        // version the user has already been shown this
                        // session (they may have dismissed it on purpose).
                        // A genuinely newer release still gets its own
                        // fresh prompt.
                        if last_notified_version.as_deref() == Some(info.version.as_str()) {
                            continue;
                        }
                        last_notified_version = Some(info.version.clone());
                        if let Ok(mut slot) = startup_update_handle
                            .state::<AppState>()
                            .pending_update
                            .write()
                        {
                            *slot = Some(info.clone());
                        }
                        let _ = startup_update_handle.emit_to("main", "update-available-startup", info);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::download_add,
            commands::download_batch_add,
            commands::download_list,
            commands::download_cancel,
            commands::download_remove,
            commands::download_pause,
            commands::download_resume,
            commands::download_segment_map,
            commands::download_open_file,
            commands::download_open_folder,
            commands::download_open_with,
            commands::download_preview,
            commands::download_streaming_url,
            commands::download_add_torrent_file,
            commands::archive_is_supported,
            commands::archive_extract_here,
            commands::archive_extract_to,
            commands::archive_create_zip,
            commands::torrent_get_files,
            commands::torrent_select_file,
            commands::torrent_create,
            commands::grabber_scan,
            commands::plugin_list,
            commands::basket_open,
            commands::basket_close,
            commands::panel_open,
            commands::panel_resize,
            commands::panel_close,
            commands::panel_result,
            commands::settings_get,
            commands::settings_update,
            commands::settings_choose_download_dir,
            commands::settings_get_auto_start,
            commands::settings_set_auto_start,
            commands::settings_add_credential,
            commands::settings_remove_credential,
            commands::settings_scan_download_dir,
            commands::settings_list_drives,
            commands::rss_list,
            commands::rss_add,
            commands::rss_update,
            commands::rss_remove,
            commands::rss_fetch_now,
            commands::dialog_choose_file,
            commands::app_get_version,
            commands::update_check,
            commands::update_get_pending,
            commands::update_open_download,
            commands::extension_open_store,
            commands::update_download_patch,
            commands::update_apply_patch,
            commands::update_relaunch,
            commands::license_activate,
            commands::license_get_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Speusis Downloader");
}
