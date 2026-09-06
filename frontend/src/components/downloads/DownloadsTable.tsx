import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  FileText,
  ExternalLink,
  FolderOpen,
  Play,
  Pause as PauseIcon,
  Square,
  FileArchive,
  FolderOutput,
  FileArchiveIcon,
  PenLine,
  RotateCw,
  RefreshCw,
  Link2,
  Info,
  Grid3x3,
  Radar,
  Layers,
  Trash2,
} from "lucide-react";
import { useDownloadsStore } from "@/stores/downloads";
import { useCategoryStore } from "@/stores/category";
import { useSearchStore } from "@/stores/search";
import { useUIStore } from "@/stores/ui";
import { MorphMenu } from "@/components/ui/MorphMenu";
import { ipc } from "@/lib/ipc";
import { fmtBytes, fmtEta } from "@/lib/format";
import { badgeColor, extBadge, revealCategory } from "@/lib/categorize";
import type { DownloadTask } from "@/lib/types";

const EXT_GROUPS: Record<string, string[]> = {
  compressed: ["zip", "rar", "7z", "tar", "gz"],
  documents: ["pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "ppt", "pptx"],
  music: ["mp3", "flac", "wav", "aac", "ogg", "m4a"],
  programs: ["exe", "msi", "dmg", "apk"],
  video: ["mp4", "mkv", "avi", "mov", "webm"],
};

function extOf(task: DownloadTask): string {
  const name = task.filename || task.outputPath || task.url;
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase().split(/[?#]/)[0];
}
const isArchive = (t: DownloadTask) => EXT_GROUPS.compressed.includes(extOf(t));
const isMedia = (t: DownloadTask) => EXT_GROUPS.music.includes(extOf(t)) || EXT_GROUPS.video.includes(extOf(t));

export function DownloadsTable() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const loaded = useDownloadsStore((s) => s.loaded);
  const refresh = useDownloadsStore((s) => s.refresh);
  const selectedId = useDownloadsStore((s) => s.selectedId);
  const select = useDownloadsStore((s) => s.select);
  const category = useCategoryStore((s) => s.category);
  const query = useSearchStore((s) => s.query);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000); // safety-net poll alongside the event-bus push
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (category === "unfinished") list = list.filter((t) => t.status === "running" || t.status === "paused");
    else if (category === "finished") list = list.filter((t) => t.status === "completed");
    else if (category === "queues") list = list.filter((t) => t.status === "queued");
    else if (category !== "all") list = list.filter((t) => revealCategory(t, EXT_GROUPS) === category);

    const q = query.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.filename || t.url).toLowerCase().includes(q));
    return list;
  }, [tasks, category, query]);

  const ctxTask = ctxMenu ? tasks.find((t) => t.id === ctxMenu.taskId) : null;

  if (loaded && tasks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-panel text-faint">
          <MoreHorizontal size={22} />
        </div>
        <div>
          <p className="text-[14px] font-semibold">Nothing downloading yet</p>
          <p className="mt-1 text-[12px] text-faint">Add a URL, a torrent, or drop a batch of links.</p>
        </div>
        <button
          onClick={() => useUIStore.getState().open("addUrl")}
          className="mt-1 h-8 rounded-lg border border-invert bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition-opacity hover:opacity-90"
        >
          Add download
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1">
      <div className="grid grid-cols-[1fr_90px_150px_110px_100px_60px] px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        <span>File name</span>
        <span>Size</span>
        <span>Status</span>
        <span>Time left</span>
        <span>Rate</span>
        <span>Actions</span>
      </div>

      {filtered.map((t) => (
        <Row
          key={t.id}
          task={t}
          selected={t.id === selectedId}
          menuOpen={menuFor === t.id}
          onSelect={() => select(t.id)}
          onMenu={() => setMenuFor(menuFor === t.id ? null : t.id)}
          onCloseMenu={() => setMenuFor(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            select(t.id);
            setMenuFor(null);
            setCtxMenu({ taskId: t.id, x: e.clientX, y: e.clientY });
          }}
        />
      ))}

      {ctxTask &&
        createPortal(
          <MorphMenu
            open={!!ctxMenu}
            onClose={() => setCtxMenu(null)}
            fixed
            align="start"
            style={{ top: ctxMenu!.y, left: ctxMenu!.x }}
          >
            <RowActionItems
              task={ctxTask}
              onAction={(action) => {
                setCtxMenu(null);
                runTaskAction(ctxTask, action, refresh);
              }}
            />
          </MorphMenu>,
          document.body,
        )}
    </div>
  );
}

async function runTaskAction(task: DownloadTask, action: string, refresh: () => void) {
  const { open } = useUIStore.getState();
  switch (action) {
    case "pause":
      await ipc.downloadPause(task.id);
      break;
    case "resume":
      await ipc.downloadResume(task.id);
      break;
    case "cancel":
      await ipc.downloadCancel(task.id);
      break;
    case "openFile":
      await ipc.downloadOpenFile(task.id);
      break;
    case "openFolder":
      await ipc.downloadOpenFolder(task.id);
      break;
    case "openWith":
      await ipc.downloadOpenWith(task.id);
      break;
    case "play": {
      const url = await ipc.downloadStreamingUrl(task.id);
      const { open: openUrl } = await import("@tauri-apps/plugin-shell");
      await openUrl(url);
      break;
    }
    case "extractHere":
      await ipc.archiveExtractHere(task.id);
      break;
    case "extractTo":
      await ipc.archiveExtractTo(task.id);
      break;
    case "createZip":
      await ipc.archiveCreateZip(task.id);
      break;
    case "copyUrl": {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(task.url);
      break;
    }
    case "redownload":
    case "refreshUrl": {
      const fresh = await ipc.downloadAdd({
        url: task.url,
        filename: task.filename ?? undefined,
        label: task.label ?? undefined,
        start: true,
      });
      if (fresh?.id) await ipc.downloadRemove(task.id, false);
      break;
    }
    case "properties":
      open("properties", task.id);
      return;
    case "rename":
      open("rename", task.id);
      return;
    case "delete":
      open("deleteConfirm", task.id);
      return;
    case "segmentMap":
      open("segmentMap", task.id);
      return;
    case "torrentFiles":
      open("torrentFiles", task.id);
      return;
  }
  refresh();
}

function Row({
  task,
  selected,
  menuOpen,
  onSelect,
  onMenu,
  onCloseMenu,
  onContextMenu,
}: {
  task: DownloadTask;
  selected: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenu: () => void;
  onCloseMenu: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const refresh = useDownloadsStore((s) => s.refresh);
  const live = useDownloadsStore((s) => s.live[task.id]);
  const pct = task.size ? Math.min(100, (task.receivedBytes / task.size) * 100) : 0;

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group relative grid grid-cols-[1fr_90px_150px_110px_100px_60px] items-center rounded-lg px-3 py-2 transition-colors ${
        selected ? "bg-active" : "hover:bg-hover"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="grid h-[26px] w-[26px] flex-shrink-0 place-items-center rounded-md font-mono text-[9px] font-bold text-invert-ink"
          style={{ background: badgeColor(task) }}
        >
          {extBadge(task)}
        </div>
        <span className="truncate text-[13px] font-medium">{task.filename || task.url}</span>
      </div>

      <span className="font-mono text-[12px] text-muted">{fmtBytes(task.size)}</span>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <Badge status={task.status} />
          {task.securityScan && <ScanBadge status={task.securityScan.status} />}
        </div>
        {task.status === "running" && (
          <div className="relative h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent-ink opacity-60 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
            <div className="progress-shimmer absolute inset-0" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <span className="font-mono text-[12px] text-muted">
        {task.status === "running" ? fmtEta(live?.eta) : "—"}
      </span>
      <span className="font-mono text-[12px] text-muted">
        {task.status === "running" && live ? `${fmtBytes(live.speed)}/s` : "—"}
      </span>

      <div className="relative flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
          className="rounded-md p-1 text-faint opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>
        <MorphMenu open={menuOpen} onClose={onCloseMenu} align="end" anchorClassName="top-8">
          <RowActionItems
            task={task}
            onAction={(action) => {
              onCloseMenu();
              runTaskAction(task, action, refresh);
            }}
          />
        </MorphMenu>
      </div>
    </div>
  );
}

function Badge({ status }: { status: DownloadTask["status"] }) {
  const map: Record<DownloadTask["status"], { label: string; cls: string }> = {
    running: { label: "Downloading", cls: "text-info bg-info-bg border-info-line" },
    completed: { label: "Complete", cls: "text-success bg-success-bg border-success-line" },
    paused: { label: "Paused", cls: "text-warning bg-warning-bg border-warning-line" },
    queued: { label: "Queued", cls: "text-muted bg-panel border-line" },
    failed: { label: "Failed", cls: "text-danger bg-warning-bg border-warning-line" },
    cancelled: { label: "Cancelled", cls: "text-faint bg-panel border-line" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

function ScanBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Scanning", cls: "text-muted bg-sunken border-line" },
    clean: { label: "Clean", cls: "text-success bg-success-bg border-success-line" },
    "threats-found": { label: "Threat found", cls: "text-danger bg-warning-bg border-warning-line" },
    failed: { label: "Scan failed", cls: "text-faint bg-panel border-line" },
  };
  const m = map[status] ?? map.pending;
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

/** The full action list, shared by the "..." button dropdown and the real
 *  right-click context menu — same items, same gating, same handler, just
 *  two different triggers into the same MorphMenu shell. */
function RowActionItems({ task, onAction }: { task: DownloadTask; onAction: (action: string) => void }) {
  const isRunning = task.status === "running";
  const isPaused = task.status === "paused";
  const isDone = task.status === "completed";
  const canStop = isRunning || isPaused || task.status === "queued";

  return (
    <>
      <MenuItem icon={<FileText size={13} />} disabled={!isDone} onClick={() => onAction("openFile")}>
        Open
      </MenuItem>
      <MenuItem icon={<ExternalLink size={13} />} disabled={!isDone} onClick={() => onAction("openWith")}>
        Open with…
      </MenuItem>
      <MenuItem icon={<FolderOpen size={13} />} disabled={!task.outputPath} onClick={() => onAction("openFolder")}>
        Open folder
      </MenuItem>
      {isMedia(task) && (
        <MenuItem icon={<Play size={13} />} disabled={!isDone} onClick={() => onAction("play")}>
          Play
        </MenuItem>
      )}

      <Sep />
      <MenuItem icon={<Play size={13} />} disabled={!isPaused} onClick={() => onAction("resume")}>
        Resume download
      </MenuItem>
      <MenuItem icon={<PauseIcon size={13} />} disabled={!isRunning} onClick={() => onAction("pause")}>
        Pause download
      </MenuItem>
      <MenuItem icon={<Square size={13} />} disabled={!canStop} onClick={() => onAction("cancel")}>
        Stop download
      </MenuItem>

      {isArchive(task) && isDone && (
        <>
          <Sep />
          <MenuItem icon={<FileArchive size={13} />} onClick={() => onAction("extractHere")}>
            Extract here
          </MenuItem>
          <MenuItem icon={<FolderOutput size={13} />} onClick={() => onAction("extractTo")}>
            Extract to…
          </MenuItem>
          <MenuItem icon={<FileArchiveIcon size={13} />} onClick={() => onAction("createZip")}>
            Add to zip archive…
          </MenuItem>
        </>
      )}

      <Sep />
      <MenuItem icon={<PenLine size={13} />} shortcut="Ctrl+M" onClick={() => onAction("rename")}>
        Move / rename
      </MenuItem>
      <MenuItem icon={<RotateCw size={13} />} onClick={() => onAction("redownload")}>
        Redownload
      </MenuItem>
      <MenuItem icon={<RefreshCw size={13} />} onClick={() => onAction("refreshUrl")}>
        Refresh download address
      </MenuItem>
      <MenuItem icon={<Link2 size={13} />} onClick={() => onAction("copyUrl")}>
        Copy URL
      </MenuItem>

      <Sep />
      <MenuItem icon={<Info size={13} />} onClick={() => onAction("properties")}>
        Properties
      </MenuItem>
      <MenuItem icon={<Grid3x3 size={13} />} onClick={() => onAction("segmentMap")}>
        Segment map
      </MenuItem>
      <MenuItem icon={<Radar size={13} />} disabled title="Not available in this engine build">
        Tracer
      </MenuItem>
      {task.kind === "torrent" && (
        <MenuItem icon={<Layers size={13} />} onClick={() => onAction("torrentFiles")}>
          Torrent files…
        </MenuItem>
      )}

      <Sep />
      <MenuItem icon={<Trash2 size={13} />} danger onClick={() => onAction("delete")}>
        Delete
      </MenuItem>
    </>
  );
}

function Sep() {
  return <div className="my-1 h-px bg-line-soft" />;
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
  disabled,
  shortcut,
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  title?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      className={`flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] transition-colors ${
        disabled ? "cursor-default text-faint" : danger ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-hover"
      }`}
    >
      {icon && <span className="opacity-80">{icon}</span>}
      <span>{children}</span>
      {shortcut && <span className="ml-auto text-[10px] text-faint">{shortcut}</span>}
    </button>
  );
}
