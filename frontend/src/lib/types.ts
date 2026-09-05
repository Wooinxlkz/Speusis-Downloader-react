// Mirrors speusis-core/src/types.rs field-for-field (including its serde
// rename attributes) so the frontend never guesses at the wire shape.

export type DownloadKind = "http" | "torrent" | "ftp";

export type DownloadStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface SecurityScanInfo {
  status: "pending" | "clean" | "threats-found" | "failed";
  scanner: string;
  detail: string | null;
}

export interface TorrentFileEntry {
  index: number;
  name: string;
  length: number;
  selected: boolean;
}

export interface DownloadTask {
  // flattened DownloadRequest fields
  url: string;
  targetDir: string;
  filename: string | null;
  segmentCount: number | null;
  kind: DownloadKind | null;
  label: string | null;
  speedLimit: number | null;
  sequential: boolean | null;
  referer: string | null;
  // task fields
  id: string;
  status: DownloadStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  size: number | null;
  receivedBytes: number;
  outputPath: string | null;
  partPath: string | null;
  retryCount: number;
  partialBytes: number | null;
  peers: number | null;
  torrentFiles: TorrentFileEntry[] | null;
  isSeeding: boolean | null;
  uploadedBytes: number | null;
  seedRatio: number | null;
  securityScan: SecurityScanInfo | null;
  lastError: string | null;
}

export interface DownloadInput {
  url: string;
  filename?: string;
  start?: boolean;
  label?: string;
  speedLimit?: number;
  sequential?: boolean;
}

export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "slate" | "blue" | "green" | "amber" | "violet" | "rose";

export interface SiteCredential {
  domain: string;
  username: string;
  password: string;
}

export interface AppSettings {
  downloadDir: string;
  maxConcurrentDownloads: number;
  defaultSegments: number;
  listenerPort: number;
  uploadLimit: number;
  downloadLimit: number;
  allowInvalidTls: boolean;
  seedRatio: number;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  scheduleEnabled: boolean;
  scheduleStartHour: number;
  scheduleStartMinute: number;
  scheduleStopHour: number;
  scheduleStopMinute: number;
  peakHoursEnabled: boolean;
  peakStartHour: number;
  peakStopHour: number;
  peakDownloadLimit: number;
  peakUploadLimit: number;
  credentials: SiteCredential[];
  remoteAccess: boolean;
  scanCompletedFiles: boolean;
  autoStartWithSystem: boolean;
  minimizeToTray: boolean;
  fileTypeRouting: boolean;
  ipBlocklistUrl: string;
  maxRetries: number;
  tempDir: string;
}

export interface SegmentMapEntry {
  index: number;
  start: number;
  end: number;
  received: number;
  done: boolean;
}
export interface SegmentMapResponse {
  segments: SegmentMapEntry[];
}

export interface RssFeed {
  id: string;
  url: string;
  name: string;
  enabled: boolean;
  lastFetched: number | null;
  filter: string | null;
  targetDir: string | null;
  autoDownload: boolean;
  fetchInterval: number;
}

export interface GrabLink {
  url: string;
  text: string | null;
  kind: string;
}
export interface GrabberResult {
  ok: boolean;
  links: GrabLink[];
  error: string | null;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string | null;
}
export interface UpdateCheckResult {
  available: boolean;
  info: UpdateInfo | null;
}

// ---------- realtime event-bus payloads ----------

export interface DownloadStarted { id: string; url: string; size: number }
export interface DownloadProgress {
  id: string;
  bytesReceived: number;
  speed: number;
  eta: number;
  size: number | null;
}
export interface DownloadCompleted { id: string; path: string; duration: number }
export interface DownloadFailed { id: string; reason: string; retryCount: number }
export interface DownloadPaused { id: string }
export interface DownloadResumed { id: string }
export interface TorrentPeerAdded { torrentId: string; peerId: string; ip: string; port: number; peerCount: number | null }
export interface TorrentFilesReady { torrentId: string; files: { name: string; length: number; index: number }[] }
export interface RssFeedFetched { feedId: string; newItems: number }

export type AppEvent =
  | { type: "DownloadStarted"; data: DownloadStarted }
  | { type: "DownloadProgress"; data: DownloadProgress }
  | { type: "DownloadCompleted"; data: DownloadCompleted }
  | { type: "DownloadFailed"; data: DownloadFailed }
  | { type: "DownloadPaused"; data: DownloadPaused }
  | { type: "DownloadResumed"; data: DownloadResumed }
  | { type: "TorrentPeerAdded"; data: TorrentPeerAdded }
  | { type: "TorrentFilesReady"; data: TorrentFilesReady }
  | { type: "RssFeedFetched"; data: RssFeedFetched }
  | { type: "SchedulerStarted" }
  | { type: "SchedulerStopped" }
  | { type: string; data?: unknown };

export type LicensePlan = "trial" | "monthly" | "lifetime";

export interface LicenseRecord {
  name: string;
  email: string;
  key: string;
  plan: LicensePlan;
  deviceLocked: boolean;
  activatedAt: number;
}
