use crate::state::AppState;
use speusis_core::torrent_downloader::{create_torrent_file, parse_torrent_file_entries};
use speusis_core::types::{DownloadKind, DownloadRequest, DownloadTask, SiteCredential, TorrentFileEntry};
use tauri::{AppHandle, Emitter, Manager, State};

// ---------- downloads ----------

fn url_scheme(url: &str) -> Option<String> {
    url.split_once(':')
        .map(|(scheme, _)| scheme.trim().to_ascii_lowercase())
        .filter(|scheme| !scheme.is_empty())
}

/// Matches the real `addDownload` input shape from preload.ts.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DownloadInput {
    pub url: String,
    pub filename: Option<String>,
    pub start: Option<bool>,
    pub label: Option<String>,
    #[serde(rename = "speedLimit")]
    pub speed_limit: Option<u64>,
    pub sequential: Option<bool>,
}

fn build_request(input: &DownloadInput, download_dir: String, segment_count: u32, file_type_routing: bool) -> DownloadRequest {
    let kind = match url_scheme(&input.url).as_deref() {
        Some("ftp") => DownloadKind::Ftp,
        _ => DownloadKind::Http,
    };
    let target_dir = if file_type_routing {
        let name_hint = input.filename.as_deref().unwrap_or(&input.url);
        match category_subfolder(name_hint) {
            Some(sub) => format!("{download_dir}/{sub}"),
            None => download_dir,
        }
    } else {
        download_dir
    };
    DownloadRequest {
        url: input.url.clone(),
        target_dir,
        filename: input.filename.clone(),
        segment_count: Some(segment_count),
        kind: Some(kind),
        label: input.label.clone(),
        speed_limit: input.speed_limit,
        sequential: input.sequential,
        // In-app "Add URL" downloads have no originating page/referer -
        // only the browser extension's capture flow ever sets this.
        referer: None,
    }
}

/// Mirrors IDM's built-in categories (General/Compressed/Documents/Music/
/// Video/Programs) for the "Sort downloads into subfolders by type" setting.
/// Matched against the last extension found in a filename or URL; returns
/// None for anything uncategorized so it falls back to the plain download
/// folder instead of forcing every file into a bucket.
fn category_subfolder(name_or_url: &str) -> Option<&'static str> {
    let ext = name_or_url
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name_or_url)
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m3u8" | "ts" => Some("Video"),
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "m4a" | "wma" => Some("Music"),
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "csv" | "odt" => Some("Documents"),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => Some("Compressed"),
        "exe" | "msi" | "dmg" | "apk" | "deb" | "appimage" => Some("Programs"),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" => Some("Pictures"),
        _ => None,
    }
}

#[tauri::command]
pub async fn download_add(app: AppHandle, state: State<'_, AppState>, input: DownloadInput) -> Result<DownloadTask, String> {
    speusis_core::debug_log::log(&format!("commands::download_add called: url={} filename={:?} start={:?}", input.url, input.filename, input.start));
    let scheme = url_scheme(&input.url);

    // A task originally added by double-clicking a .torrent (or via the
    // file-picker "Torrent" button) has its `url` set to a local filesystem
    // path, not a scheme'd URL. The "Re-download" button calls this same
    // command with that same task.url - previously that had no "://" in it,
    // fell through every scheme arm below, and errored out with "Unsupported
    // or invalid URL", so redownloading a file-based torrent silently did
    // nothing. Route it the same place a fresh double-click would go.
    if scheme.is_none() && input.url.to_lowercase().ends_with(".torrent") {
        return add_torrent_from_path(&app, input.url.clone()).await;
    }

    match scheme.as_deref() {
        Some("http") | Some("https") | Some("ftp") => {}
        Some("magnet") => {
            // Magnet links go through the BitTorrent engine.
            let download_dir = state
                .settings_snapshot
                .read()
                .map_err(|e| e.to_string())?
                .download_dir
                .clone();
            let request = DownloadRequest {
                url: input.url.clone(),
                target_dir: download_dir,
                filename: input.filename.clone(),
                segment_count: None,
                kind: Some(DownloadKind::Torrent),
                label: input.label.clone().or_else(|| Some("Torrent".into())),
                speed_limit: None,
                sequential: None,
                referer: None,
            };
            let task = state.scheduler.add(request, input.start.unwrap_or(true)).await;
            speusis_core::debug_log::log(&format!("commands::download_add: magnet task id={}", task.id));
            return Ok(task);
        }
        _ => {
            return Err(format!(
                "Unsupported or invalid URL: \"{}\" - use an http://, https://, ftp://, or magnet: URL.",
                input.url
            ));
        }
    }

    let (download_dir, segments, file_type_routing) = {
        let snap = state.settings_snapshot.read().map_err(|e| e.to_string())?;
        (snap.download_dir.clone(), snap.default_segments, snap.file_type_routing)
    };
    speusis_core::debug_log::log(&format!("commands::download_add: download_dir='{download_dir}' segments={segments}"));
    let request = build_request(&input, download_dir, segments, file_type_routing);
    let task = state.scheduler.add(request, input.start.unwrap_or(true)).await;
    speusis_core::debug_log::log(&format!("commands::download_add: task created id={} status={:?}", task.id, task.status));
    Ok(task)
}

#[tauri::command]
pub async fn download_batch_add(app: AppHandle, state: State<'_, AppState>, urls: Vec<DownloadInput>) -> Result<Vec<DownloadTask>, String> {
    let mut created = vec![];
    for input in urls {
        created.push(download_add(app.clone(), state.clone(), input).await?);
    }
    Ok(created)
}

#[tauri::command]
pub async fn download_list(state: State<'_, AppState>) -> Result<Vec<DownloadTask>, String> {
    Ok(state.scheduler.list().await)
}

#[tauri::command]
pub async fn download_cancel(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.scheduler.cancel(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn download_remove(state: State<'_, AppState>, id: String, delete_from_disk: Option<bool>) -> Result<(), String> {
    state.scheduler.remove(&id, delete_from_disk.unwrap_or(false)).await;
    Ok(())
}

#[tauri::command]
pub async fn download_pause(state: State<'_, AppState>, id: String) -> Result<Option<DownloadTask>, String> {
    Ok(state.scheduler.pause(&id).await)
}

#[tauri::command]
pub async fn download_resume(state: State<'_, AppState>, id: String) -> Result<Option<DownloadTask>, String> {
    Ok(state.scheduler.resume(&id).await)
}

/// Live per-segment progress for the segment-map viewer. Reads the on-disk
/// resume manifest that the downloader already writes as it works — returns
/// `None` if the task isn't found or hasn't written a manifest yet (e.g.
/// single-segment, queued, or already finished/moved to its final path).
#[tauri::command]
pub async fn download_segment_map(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<speusis_core::types::SegmentMapResponse>, String> {
    let part_path = state
        .scheduler
        .list()
        .await
        .into_iter()
        .find(|t| t.id == id)
        .and_then(|t| t.part_path);
    let Some(part_path) = part_path else { return Ok(None) };
    Ok(speusis_core::file_manager::FileManager::read_segment_map(&part_path).await)
}

async fn find_task_path(state: &State<'_, AppState>, id: &str) -> Option<String> {
    state.scheduler.list().await.into_iter()
        .find(|t| t.id == id)
        .and_then(|t| t.output_path.or(t.part_path))
}

#[tauri::command]
pub async fn download_open_file(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(path) = find_task_path(&state, &id).await {
        open::that(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn download_open_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(path) = find_task_path(&state, &id).await {
        if let Some(folder) = std::path::PathBuf::from(path).parent() {
            open::that(folder).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn download_open_with(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(path) = find_task_path(&state, &id).await {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("rundll32.exe")
                .args(["shell32.dll,OpenAs_RunDLL", &path])
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            open::that(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn download_preview(state: State<'_, AppState>, id: String) -> Result<String, String> {
    download_streaming_url(state, id).await
}

#[tauri::command]
pub async fn download_streaming_url(_state: State<'_, AppState>, id: String) -> Result<String, String> {
    // The streaming_server is started in main.rs on port 47811.
    // Supports HTTP Range requests so <video> and <audio> elements can seek.
    Ok(format!("http://127.0.0.1:47811/stream/{id}"))
}

// ---------- archive manager ----------
//
// v0.5.50: right-click a downloaded file -> Extract Here / Extract to... /
// Add to Zip Archive..., backed by speusis_core::archive_manager. All three
// operate on a completed download by task id (same `find_task_path` lookup
// download_open_file etc. already use), and the extraction itself runs on
// a blocking thread so a large archive can't stall the async runtime that
// every other in-flight download is also using.

#[tauri::command]
pub fn archive_is_supported(path: String) -> bool {
    speusis_core::archive_manager::is_supported_archive(&path)
}

#[tauri::command]
pub async fn archive_extract_here(
    state: State<'_, AppState>,
    id: String,
) -> Result<speusis_core::archive_manager::ExtractResult, String> {
    let path = find_task_path(&state, &id)
        .await
        .ok_or_else(|| "File not found — it may not have finished downloading yet.".to_string())?;
    let dest_dir = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Couldn't determine the archive's folder.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || speusis_core::archive_manager::extract_archive(&path, &dest_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn archive_extract_to(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<speusis_core::archive_manager::ExtractResult, String> {
    let path = find_task_path(&state, &id)
        .await
        .ok_or_else(|| "File not found — it may not have finished downloading yet.".to_string())?;
    use tauri_plugin_dialog::DialogExt;
    let Some(dest_dir) = app.dialog().file().blocking_pick_folder().map(|f| f.to_string()) else {
        return Err("No destination folder was chosen.".to_string());
    };
    tauri::async_runtime::spawn_blocking(move || speusis_core::archive_manager::extract_archive(&path, &dest_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn archive_create_zip(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let path = find_task_path(&state, &id)
        .await
        .ok_or_else(|| "File not found — it may not have finished downloading yet.".to_string())?;
    use tauri_plugin_dialog::DialogExt;
    let default_name = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| format!("{s}.zip"))
        .unwrap_or_else(|| "archive.zip".to_string());
    let Some(output_path) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("ZIP archive", &["zip"])
        .blocking_save_file()
        .map(|f| f.to_string())
    else {
        return Err("No output location was chosen.".to_string());
    };
    let output_path_for_task = output_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        speusis_core::archive_manager::create_zip(&[path], &output_path_for_task)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(output_path)
}

// ---------- plugins (discovery only - see speusis-core's plugin_manager.rs
// doc comment: running plugin JS needs an embedded JS engine that doesn't
// exist here yet, so this reports what's found, not what's running) ----------

#[derive(serde::Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub permissions: Vec<speusis_core::plugin_manager::Permission>,
    pub executable: bool,
}

#[tauri::command]
pub async fn plugin_list(state: State<'_, AppState>) -> Result<Vec<PluginInfo>, String> {
    let found = state.plugin_manager.load_all().await;
    Ok(found
        .into_iter()
        .map(|(manifest, run_result)| PluginInfo {
            name: manifest.name,
            version: manifest.version,
            permissions: manifest.permissions,
            executable: run_result.is_ok(),
        })
        .collect())
}

// ---------- torrents ----------

/// Shared by the file-dialog command (download_add_torrent_file) and the
/// .torrent file-association launch handler in main.rs (double-clicking a
/// .torrent file in Explorer, or a browser save-as, now opens directly into
/// Speusis instead of whatever was previously registered as the handler).
pub async fn add_torrent_from_path(app: &AppHandle, path_str: String) -> Result<DownloadTask, String> {
    let bytes = tokio::fs::read(&path_str).await.map_err(|e| e.to_string())?;
    let file_entries = parse_torrent_file_entries(&bytes).map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    let download_dir = state
        .settings_snapshot
        .read()
        .map_err(|e| e.to_string())?
        .download_dir
        .clone();

    let request = DownloadRequest {
        url: path_str,
        target_dir: download_dir,
        filename: None,
        segment_count: None,
        kind: Some(DownloadKind::Torrent),
        label: Some("Torrent".into()),
        speed_limit: None,
        sequential: None,
        referer: None,
    };
    let mut task = state.scheduler.add(request, true).await;
    task.torrent_files = Some(file_entries);
    Ok(task)
}

/// Show a file picker dialog, parse the selected .torrent, and queue the
/// download.  Returns the new DownloadTask with `torrent_files` pre-populated
/// so the frontend can show a file-selection modal immediately.
#[tauri::command]
pub async fn download_add_torrent_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DownloadTask, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("Torrent files", &["torrent"])
        .blocking_pick_file()
        .ok_or_else(|| "No file selected".to_string())?;

    let path_str = path.to_string();
    let bytes = tokio::fs::read(&path_str).await.map_err(|e| e.to_string())?;

    // Parse immediately so the caller gets a file list before the download
    // engine has a chance to start and emit TorrentFilesReady itself.
    let file_entries = parse_torrent_file_entries(&bytes).map_err(|e| e.to_string())?;

    let download_dir = state
        .settings_snapshot
        .read()
        .map_err(|e| e.to_string())?
        .download_dir
        .clone();

    let request = DownloadRequest {
        url: path_str,
        target_dir: download_dir,
        filename: None,
        segment_count: None,
        kind: Some(DownloadKind::Torrent),
        label: Some("Torrent".into()),
        speed_limit: None,
        sequential: None,
        referer: None,
    };
    // start=true: the engine begins immediately; user can deselect files via
    // torrent_select_file() while the download is running.
    let mut task = state.scheduler.add(request, true).await;
    // Inject the pre-parsed list so the frontend doesn't have to wait for
    // TorrentFilesReady if it arrives before the JS event listener is set up.
    task.torrent_files = Some(file_entries);
    Ok(task)
}

/// Return the file list for a torrent task (used for the file-selection modal).
///
/// If the download is already running the list comes from the live librqbit
/// handle.  If the task was just queued (before the engine has connected to
/// any peer) we fall back to reading the .torrent file from disk.
#[tauri::command]
pub async fn torrent_get_files(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<TorrentFileEntry>, String> {
    // Try the live manager first.
    if let Some(files) = state.torrent_manager.get_file_entries(&id).await {
        return Ok(files);
    }
    // Fall back to reading the .torrent file stored as the task URL.
    let task = state
        .scheduler
        .list()
        .await
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Task {id} not found"))?;

    if let Some(files) = task.torrent_files {
        return Ok(files);
    }

    // The URL is a path to a .torrent file; parse it.
    let bytes = tokio::fs::read(&task.request.url)
        .await
        .map_err(|e| format!("Cannot read .torrent file: {e}"))?;
    parse_torrent_file_entries(&bytes).map_err(|e| e.to_string())
}

/// Enable or disable a specific file within a torrent download.
#[tauri::command]
pub async fn torrent_select_file(
    state: State<'_, AppState>,
    id: String,
    file_index: u32,
    selected: bool,
) -> Result<(), String> {
    state
        .torrent_manager
        .update_file_selection(&id, file_index, selected)
        .await
        .map_err(|e| e.to_string())
}

/// Create a .torrent file from a local file or directory.
/// Returns the path of the created .torrent file.
#[tauri::command]
pub async fn torrent_create(
    source_path: String,
    output_dir: String,
    name: Option<String>,
    tracker: Option<String>,
) -> Result<String, String> {
    // lava_torrent hashing is CPU-bound; run on blocking thread pool.
    tokio::task::spawn_blocking(move || {
        create_torrent_file(
            &source_path,
            &output_dir,
            name.as_deref(),
            tracker.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- grabber (real, from speusis-core::web_grabber) ----------

#[derive(serde::Serialize)]
pub struct GrabberResult {
    pub ok: bool,
    pub links: Vec<speusis_core::types::GrabLink>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn grabber_scan(url: String) -> Result<GrabberResult, String> {
    match speusis_core::web_grabber::grab_links_from_url(&url).await {
        Ok(links) => Ok(GrabberResult { ok: true, links, error: None }),
        Err(e) => Ok(GrabberResult { ok: false, links: vec![], error: Some(e.to_string()) }),
    }
}

// ---------- basket (Tauri window management, unrelated to speusis-core) ----------

#[tauri::command]
pub async fn basket_open(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("basket") {
        let _ = win.show();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "basket", tauri::WebviewUrl::App("basket.html".into()))
        .title("Speusis Downloader - Download Basket")
        .inner_size(360.0, 480.0)
        .decorations(false)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn basket_close(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("basket") {
        let _ = win.hide();
    }
    Ok(())
}

// ---------- native panels ----------
//
// Each panel keeps the existing renderer markup and behavior, but gets its own
// native Tauri window. Keeping the panel IDs in one allow-list prevents a
// renderer-controlled URL from creating arbitrary windows.
fn native_panel_config(panel: &str) -> Option<(&'static str, f64, f64)> {
    Some(match panel {
        "addUrlPanel" => ("Add Download", 560.0, 420.0),
        "settingsPanel" => ("Options", 700.0, 620.0),
        "schedulerPanel" => ("Scheduler", 560.0, 520.0),
        "loginsPanel" => ("Site Login Manager", 560.0, 460.0),
        "rssPanel" => ("RSS Feed Manager", 620.0, 520.0),
        "batchPanel" => ("Batch Download from Page", 640.0, 520.0),
        "createTorrentPanel" => ("Create Torrent File", 560.0, 400.0),
        "aboutPanel" => ("About Speusis", 440.0, 430.0),
        "helpPanel" => ("Help & Support", 440.0, 450.0),
        "registrationPanel" => ("Registration", 520.0, 600.0),
        "grabberPanel" => ("Web Grabber", 660.0, 560.0),
        "torrentFilesPanel" => ("Torrent File Selection", 600.0, 460.0),
        "renameDialog" => ("Move / Rename", 480.0, 300.0),
        "propertiesDialog" => ("Download Properties", 520.0, 420.0),
        "deleteConfirmDialog" => ("Confirm Deletion", 520.0, 360.0),
        "segmentMapDialog" => ("Segment Map", 340.0, 300.0),
        "tracerPanel" => ("Download Trace", 380.0, 560.0),
        "autoUpdateDialog" => ("Speusis Update", 480.0, 340.0),
        "updateWarnDialog" => ("Speusis", 440.0, 260.0),
        _ => return None,
    })
}

#[tauri::command]
pub async fn panel_open(app: AppHandle, panel: String, id: Option<String>) -> Result<(), String> {
    let (title, width, height) = native_panel_config(&panel)
        .ok_or_else(|| format!("Unknown native panel: {panel}"))?;
    let label = format!("panel-{panel}");

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let url = match id {
        Some(id) => format!(
            "index.html?panel={panel}&id={}",
            id.replace('%', "%25").replace('&', "%26").replace('=', "%3D").replace('?', "%3F")
        ),
        None => format!("index.html?panel={panel}"),
    };

    tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(format!("Speusis Downloader - {title}"))
    .inner_size(width, height)
    .min_inner_size(320.0, 220.0)
    .decorations(false)
    .always_on_top(true)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;
    // Built immediately visible at its exact configured size from
    // native_panel_config above - no hidden-then-measure-then-show dance.
    // That was tried before specifically to fix these dialogs looking
    // broken, but the frontend's ResizeObserver kept re-measuring shared
    // index.html content (which differs by active tab, loaded fonts, etc.)
    // and overwriting this already-correct size with a wrong one - that
    // was the actual cause of the huge empty gaps. Removed the JS side of
    // that loop too (installNativePanelSizing in app.js); manual resizing
    // via the edge/corner grips is untouched since that's user-initiated,
    // not automatic.

    Ok(())
}

#[tauri::command]
pub async fn panel_resize(app: AppHandle, panel: String, width: f64, height: f64) -> Result<(), String> {
    let _ = native_panel_config(&panel)
        .ok_or_else(|| format!("Unknown native panel: {panel}"))?;
    let label = format!("panel-{panel}");
    let Some(win) = app.get_webview_window(&label) else {
        return Ok(());
    };

    // Keep each custom-framed window sized to its current content instead of
    // making every dialog occupy the initial placeholder dimensions.
    let width = width.clamp(320.0, 1200.0);
    let height = height.clamp(220.0, 1000.0);
    win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|e| e.to_string())?;

    // First resize call after the window was built hidden means the content
    // is now measured and correctly sized - reveal it now instead of at the
    // guessed placeholder size, so there's no visible pop-then-jump.
    if !win.is_visible().unwrap_or(true) {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn panel_result(
    app: AppHandle,
    panel: String,
    result: serde_json::Value,
) -> Result<(), String> {
    let _ = native_panel_config(&panel)
        .ok_or_else(|| format!("Unknown native panel: {panel}"))?;
    app.emit_to("main", "panel-result", serde_json::json!({ "panel": panel, "result": result }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn panel_close(app: AppHandle, panel: String) -> Result<(), String> {
    let _ = native_panel_config(&panel)
        .ok_or_else(|| format!("Unknown native panel: {panel}"))?;
    let label = format!("panel-{panel}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.hide();
    }
    Ok(())
}

// ---------- settings (real, from speusis-core::settings_manager) ----------

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<speusis_core::types::AppSettings, String> {
    Ok(state.settings.lock().await.get().clone())
}

/// Updates both the persisted SettingsManager AND the fast-read snapshot
/// that the download engine's sync closures read from - see state.rs doc
/// comment for why there are two copies.
#[tauri::command]
pub async fn settings_update(app: AppHandle, state: State<'_, AppState>, patch: serde_json::Value) -> Result<speusis_core::types::AppSettings, String> {
    let updated = {
        let mut settings = state.settings.lock().await;
        settings.update(patch).await.map_err(|e| e.to_string())?.clone()
    };
    if let Ok(mut snap) = state.settings_snapshot.write() {
        *snap = updated.clone();
    }
    // Theme/accent changed here only ever applied to whichever window's own
    // document.body triggered it - if that was a native panel window (e.g.
    // Options), the main window (and every other open dialog) never saw the
    // change at all, since each is a fully separate DOM. Broadcasting to
    // every open window is what update-available already does for the same
    // reason - same fix, same pattern.
    let _ = app.emit("settings-updated", &updated);
    Ok(updated)
}

#[tauri::command]
pub async fn settings_choose_download_dir(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|f| f.to_string()))
}

#[tauri::command]
pub async fn settings_get_auto_start(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn settings_set_auto_start(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled { app.autolaunch().enable().map_err(|e| e.to_string()) }
    else { app.autolaunch().disable().map_err(|e| e.to_string()) }
}

#[tauri::command]
pub async fn settings_add_credential(app: AppHandle, state: State<'_, AppState>, cred: SiteCredential) -> Result<(), String> {
    let mut current = state.settings.lock().await.get().credentials.clone();
    current.retain(|c| c.domain != cred.domain);
    current.push(cred);
    let patch = serde_json::json!({ "credentials": current });
    settings_update(app, state, patch).await?;
    Ok(())
}

#[tauri::command]
pub async fn settings_remove_credential(app: AppHandle, state: State<'_, AppState>, domain: String) -> Result<(), String> {
    let mut current = state.settings.lock().await.get().credentials.clone();
    current.retain(|c| c.domain != domain);
    let patch = serde_json::json!({ "credentials": current });
    settings_update(app, state, patch).await?;
    Ok(())
}

#[tauri::command]
pub async fn settings_scan_download_dir(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let dir = state.settings_snapshot.read().map_err(|e| e.to_string())?.download_dir.clone();
    let mut entries = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
    let mut files = vec![];
    while let Ok(Some(entry)) = entries.next_entry().await {
        files.push(entry.file_name().to_string_lossy().to_string());
    }
    Ok(files)
}

#[tauri::command]
pub async fn settings_list_drives() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        Ok((b'A'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|p| std::path::PathBuf::from(p).exists())
            .collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec!["/".to_string()])
    }
}

// ---------- rss (real, from speusis-core::rss_manager) ----------

#[tauri::command]
pub async fn rss_list(state: State<'_, AppState>) -> Result<Vec<speusis_core::types::RssFeed>, String> {
    Ok(state.rss.list_feeds().await)
}

#[tauri::command]
pub async fn rss_add(state: State<'_, AppState>, feed: speusis_core::types::RssFeed) -> Result<speusis_core::types::RssFeed, String> {
    Ok(state.rss.add_feed(feed).await)
}

#[tauri::command]
pub async fn rss_update(state: State<'_, AppState>, id: String, patch: serde_json::Value) -> Result<Option<speusis_core::types::RssFeed>, String> {
    Ok(state.rss.update_feed(&id, patch).await)
}

#[tauri::command]
pub async fn rss_remove(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.rss.remove_feed(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn rss_fetch_now(state: State<'_, AppState>, id: String) -> Result<u32, String> {
    Ok(state.rss.fetch_now(&id).await)
}

// ---------- dialog / app / update (Tauri-specific, unrelated to speusis-core) ----------

#[derive(serde::Deserialize)]
pub struct ChooseFileOptions {
    pub directory: Option<bool>,
    #[allow(dead_code)]
    pub filters: Option<Vec<serde_json::Value>>,
}

#[tauri::command]
pub async fn dialog_choose_file(app: AppHandle, options: Option<ChooseFileOptions>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let wants_directory = options.and_then(|o| o.directory).unwrap_or(false);
    if wants_directory {
        Ok(app.dialog().file().blocking_pick_folder().map(|f| f.to_string()))
    } else {
        Ok(app.dialog().file().blocking_pick_file().map(|f| f.to_string()))
    }
}

#[tauri::command]
pub fn app_get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<speusis_core::update_checker::UpdateCheckResult, String> {
    let result = speusis_core::update_checker::check_for_update(None, env!("CARGO_PKG_VERSION")).await;
    // Options/About/etc. all run as separate native windows now, each with
    // its own isolated DOM - toggling #updateBanner locally only affects
    // whichever popup the check was triggered from, never the main window
    // the user actually sees. Push it through an event instead, same as
    // panel_result does, so the main window's already-wired
    // api.onUpdateAvailable listener can show the real banner regardless of
    // which window kicked off the check.
    if let Some(info) = &result.info {
        let _ = app.emit_to("main", "update-available", info);
    }
    Ok(result)
}

/// Fetches whatever the automatic startup update check last found, if
/// anything — used by the auto-update dialog, which (like every other
/// dialog) opens as its own fresh native window and has no other way to
/// see the payload the startup check emitted earlier in the main window.
#[tauri::command]
pub async fn update_get_pending(
    state: State<'_, AppState>,
) -> Result<Option<speusis_core::update_checker::UpdateInfo>, String> {
    Ok(state.pending_update.read().map(|g| g.clone()).unwrap_or(None))
}

#[tauri::command]
pub async fn update_open_download(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| e.to_string())
}

/// Opens the extension's store/listing page for a given browser. Used for
/// Firefox and Arc, which the NSIS installer cannot auto-register (Firefox
/// requires Mozilla's own signing; Arc has no confirmed registry hook) -
/// this is the one-click fallback instead of silent install.
///
/// IMPORTANT: these are placeholder URLs. The Chrome Web Store URL only
/// becomes real once the extension is actually submitted and approved
/// there (same listing serves Chrome/Edge/Brave/Arc users); the AMO URL
/// once approved on addons.mozilla.org. Replace both below with the real
/// listing URLs after each store approves the submission.
#[tauri::command]
pub async fn extension_open_store(app: AppHandle, browser: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let url = match browser.as_str() {
        "firefox" => "https://addons.mozilla.org/firefox/addon/speusis-downloader/", // TODO: replace once AMO listing is live
        _ => "https://chromewebstore.google.com/detail/speusis-downloader/PLACEHOLDER_ID", // TODO: replace once Chrome Web Store listing is live
    };
    app.shell().open(url, None).map_err(|e| e.to_string())
}

// ---------- Hot-patch system ----------
//
// In the Tauri context there is no "asar" (that's an Electron concept).
// "Patch" here means: download the new release installer to a temp path, then
// run it silently so it overwrites the current installation.  Windows NSIS
// installers accept /S; MSI installers use msiexec /qn.

/// Download the update installer to a temporary file and remember its path.
/// The frontend calls this right after `update_check` returns a download URL.
#[tauri::command]
pub async fn update_download_patch(
    state: State<'_, AppState>,
    asar_url: String,
) -> Result<(), String> {
    speusis_core::debug_log::log(&format!("update_download_patch: {asar_url}"));
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&asar_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned HTTP {}", resp.status()));
    }

    // Infer a sensible filename from the URL
    let filename = asar_url
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("speusis-update.exe");
    let tmp_path = std::env::temp_dir().join(filename);

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&tmp_path, &bytes)
        .await
        .map_err(|e| format!("Cannot save installer: {e}"))?;

    *state.pending_patch.lock().await = Some(tmp_path);
    Ok(())
}

/// Run the previously downloaded installer.
/// On Windows the installer is launched silently (no UI) so Speusis Downloader can
/// quit immediately after; on other platforms the file is opened with the
/// system's default handler.
#[tauri::command]
pub async fn update_apply_patch(state: State<'_, AppState>) -> Result<(), String> {
    let path = state
        .pending_patch
        .lock()
        .await
        .clone()
        .ok_or_else(|| "No patch has been downloaded yet. Call update_download_patch first.".to_string())?;

    speusis_core::debug_log::log(&format!("update_apply_patch: running {}", path.display()));

    #[cfg(target_os = "windows")]
    {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let result = if ext == "msi" {
            let mut cmd = std::process::Command::new("msiexec");
            cmd.args(["/i", &path.to_string_lossy(), "/qn"]);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            cmd.spawn()
        } else {
            // Assume NSIS installer - /S = silent install
            let mut cmd = std::process::Command::new(&path);
            cmd.arg("/S");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            cmd.spawn()
        };
        result.map_err(|e| format!("Failed to launch installer: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        open::that(&path).map_err(|e| format!("Failed to open installer: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_relaunch(app: AppHandle) -> Result<(), String> {
    app.restart()
}

// ---------- License activation ----------
// See speusis_core::license module doc comment for what this does and does
// NOT protect against - it's "harder to crack than plaintext JS", not DRM.

#[tauri::command]
pub async fn license_activate(app: AppHandle, name: String, email: String, key: String) -> Result<speusis_core::license::LicenseRecord, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    speusis_core::license::activate(&dir, &name, &email, &key)
}

#[tauri::command]
pub async fn license_get_status(app: AppHandle) -> Result<Option<speusis_core::license::LicenseRecord>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(speusis_core::license::get_status(&dir))
}
