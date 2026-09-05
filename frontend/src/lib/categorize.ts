import type { DownloadTask } from "./types";

function extOf(task: DownloadTask): string {
  const name = task.filename || task.outputPath || task.url;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase().split(/[?#]/)[0];
}

export function revealCategory(
  task: DownloadTask,
  groups: Record<string, string[]>,
): string | null {
  const ext = extOf(task);
  if (!ext) return null;
  for (const [group, exts] of Object.entries(groups)) {
    if (exts.includes(ext)) return group;
  }
  return null;
}

export function extBadge(task: DownloadTask): string {
  const ext = extOf(task);
  return ext ? ext.slice(0, 3).toUpperCase() : task.kind === "torrent" ? "TOR" : "URL";
}

const BADGE_COLORS: Record<string, string> = {
  zip: "#3457b2", rar: "#3457b2", "7z": "#3457b2", tar: "#3457b2", gz: "#3457b2",
  pdf: "#b23a2e", doc: "#3457b2", docx: "#3457b2", txt: "#6e6e6a", md: "#6e6e6a",
  mp3: "#2f7d4f", flac: "#2f7d4f", wav: "#2f7d4f", aac: "#2f7d4f",
  exe: "#2f7d4f", msi: "#2f7d4f", dmg: "#2f7d4f", apk: "#2f7d4f",
  mp4: "#b23a2e", mkv: "#b23a2e", avi: "#b23a2e", mov: "#b23a2e", webm: "#b23a2e",
  iso: "#c9622b", torrent: "#7a5cc9",
};

export function badgeColor(task: DownloadTask): string {
  const ext = extOf(task);
  if (task.kind === "torrent") return BADGE_COLORS.torrent;
  return BADGE_COLORS[ext] ?? "#6e6e6a";
}
