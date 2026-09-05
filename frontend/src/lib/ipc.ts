import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  DownloadInput,
  DownloadTask,
  GrabberResult,
  LicenseRecord,
  PluginInfo,
  RssFeed,
  SegmentMapResponse,
  SiteCredential,
  TorrentFileEntry,
  UpdateCheckResult,
} from "./types";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export const ipc = {
  // ---- downloads (commands.rs) ----
  downloadAdd: (input: DownloadInput) => call<DownloadTask>("download_add", { input }),
  downloadBatchAdd: (urls: DownloadInput[]) => call<DownloadTask[]>("download_batch_add", { urls }),
  downloadList: () => call<DownloadTask[]>("download_list"),
  downloadCancel: (id: string) => call<void>("download_cancel", { id }),
  downloadRemove: (id: string, deleteFromDisk?: boolean) =>
    call<void>("download_remove", { id, deleteFromDisk }),
  downloadPause: (id: string) => call<DownloadTask | null>("download_pause", { id }),
  downloadResume: (id: string) => call<DownloadTask | null>("download_resume", { id }),
  downloadSegmentMap: (id: string) => call<SegmentMapResponse | null>("download_segment_map", { id }),
  downloadOpenFile: (id: string) => call<void>("download_open_file", { id }),
  downloadOpenFolder: (id: string) => call<void>("download_open_folder", { id }),
  downloadOpenWith: (id: string) => call<void>("download_open_with", { id }),
  downloadPreview: (id: string) => call<string>("download_preview", { id }),
  downloadStreamingUrl: (id: string) => call<string>("download_streaming_url", { id }),
  downloadAddTorrentFile: () => call<DownloadTask>("download_add_torrent_file"),

  // ---- archives ----
  archiveIsSupported: (path: string) => call<boolean>("archive_is_supported", { path }),
  archiveExtractHere: (id: string) => call<void>("archive_extract_here", { id }),
  archiveExtractTo: (id: string) => call<void>("archive_extract_to", { id }),
  archiveCreateZip: (id: string) => call<void>("archive_create_zip", { id }),

  // ---- torrent ----
  torrentGetFiles: (id: string) => call<TorrentFileEntry[]>("torrent_get_files", { id }),
  torrentSelectFile: (id: string, fileIndex: number, selected: boolean) =>
    call<void>("torrent_select_file", { id, fileIndex, selected }),
  torrentCreate: (sourcePath: string, outputDir: string, name?: string, tracker?: string) =>
    call<string>("torrent_create", { sourcePath, outputDir, name, tracker }),

  // ---- grabber ----
  grabberScan: (url: string) => call<GrabberResult>("grabber_scan", { url }),

  // ---- basket (native window) ----
  basketOpen: () => call<void>("basket_open"),
  basketClose: () => call<void>("basket_close"),

  // ---- native side panels (options/logins/scheduler/rss/about, each its own window) ----
  panelOpen: (panel: string, id?: string) => call<void>("panel_open", { panel, id }),
  panelResize: (panel: string, width: number, height: number) =>
    call<void>("panel_resize", { panel, width, height }),
  panelClose: (panel: string) => call<void>("panel_close", { panel }),

  // ---- settings ----
  settingsGet: () => call<AppSettings>("settings_get"),
  settingsUpdate: (patch: Partial<AppSettings>) => call<AppSettings>("settings_update", { patch }),
  settingsChooseDownloadDir: () => call<string | null>("settings_choose_download_dir"),
  settingsGetAutoStart: () => call<boolean>("settings_get_auto_start"),
  settingsSetAutoStart: (enabled: boolean) => call<void>("settings_set_auto_start", { enabled }),
  settingsAddCredential: (cred: SiteCredential) => call<void>("settings_add_credential", { cred }),
  settingsRemoveCredential: (domain: string) => call<void>("settings_remove_credential", { domain }),
  settingsScanDownloadDir: () => call<string[]>("settings_scan_download_dir"),
  settingsListDrives: () => call<string[]>("settings_list_drives"),

  // ---- rss ----
  rssList: () => call<RssFeed[]>("rss_list"),
  rssAdd: (feed: RssFeed) => call<RssFeed>("rss_add", { feed }),
  rssUpdate: (id: string, patch: Partial<RssFeed>) => call<RssFeed | null>("rss_update", { id, patch }),
  rssRemove: (id: string) => call<void>("rss_remove", { id }),
  rssFetchNow: (id: string) => call<number>("rss_fetch_now", { id }),

  // ---- dialogs / misc ----
  dialogChooseFile: (directory?: boolean) =>
    call<string | null>("dialog_choose_file", { options: { directory } }),
  appGetVersion: () => call<string>("app_get_version"),
  updateCheck: () => call<UpdateCheckResult>("update_check"),
  updateOpenDownload: (url: string) => call<void>("update_open_download", { url }),
  extensionOpenStore: (browser: string) => call<void>("extension_open_store", { browser }),

  // ---- plugins ----
  pluginList: () => call<PluginInfo[]>("plugin_list"),

  // ---- licensing ----
  licenseActivate: (name: string, email: string, key: string) =>
    call<LicenseRecord>("license_activate", { name, email, key }),
  licenseGetStatus: () => call<LicenseRecord | null>("license_get_status"),
};

export class IpcError extends Error {}
