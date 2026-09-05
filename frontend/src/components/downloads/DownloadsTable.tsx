import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useDownloadsStore } from "@/stores/downloads";
import { useCategoryStore } from "@/stores/category";
import { useUIStore } from "@/stores/ui";
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

export function DownloadsTable() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const loaded = useDownloadsStore((s) => s.loaded);
  const refresh = useDownloadsStore((s) => s.refresh);
  const selectedId = useDownloadsStore((s) => s.selectedId);
  const select = useDownloadsStore((s) => s.select);
  const category = useCategoryStore((s) => s.category);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000); // safety-net poll alongside the event-bus push
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (category === "all") return tasks;
    if (category === "unfinished") return tasks.filter((t) => t.status === "running" || t.status === "paused");
    if (category === "finished") return tasks.filter((t) => t.status === "completed");
    if (category === "queues") return tasks.filter((t) => t.status === "queued");
    return tasks.filter((t) => revealCategory(t, EXT_GROUPS) === category);
  }, [tasks, category]);

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
      <div className="grid grid-cols-[1fr_90px_120px_110px_100px_60px] px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
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
        />
      ))}
    </div>
  );
}

function Row({
  task,
  selected,
  menuOpen,
  onSelect,
  onMenu,
  onCloseMenu,
}: {
  task: DownloadTask;
  selected: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenu: () => void;
  onCloseMenu: () => void;
}) {
  const refresh = useDownloadsStore((s) => s.refresh);
  const live = useDownloadsStore((s) => s.live[task.id]);
  const open = useUIStore((s) => s.open);
  const pct = task.size ? Math.min(100, (task.receivedBytes / task.size) * 100) : 0;

  return (
    <div
      onClick={onSelect}
      className={`group relative grid grid-cols-[1fr_90px_120px_110px_100px_60px] items-center rounded-lg px-3 py-2 transition-colors ${
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

      <div>
        <Badge status={task.status} />
        {task.status === "running" && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
            <div className="h-full bg-info opacity-60 transition-all duration-500" style={{ width: `${pct}%` }} />
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
        {menuOpen && (
          <RowMenu
            task={task}
            onClose={onCloseMenu}
            onAction={async (action) => {
              onCloseMenu();
              if (action === "pause") await ipc.downloadPause(task.id);
              if (action === "resume") await ipc.downloadResume(task.id);
              if (action === "cancel") await ipc.downloadCancel(task.id);
              if (action === "openFile") await ipc.downloadOpenFile(task.id);
              if (action === "openFolder") await ipc.downloadOpenFolder(task.id);
              if (action === "openWith") await ipc.downloadOpenWith(task.id);
              if (action === "properties") open("properties", task.id);
              if (action === "rename") open("rename", task.id);
              if (action === "delete") open("deleteConfirm", task.id);
              if (action === "segmentMap") open("segmentMap", task.id);
              if (action === "torrentFiles") open("torrentFiles", task.id);
              refresh();
            }}
          />
        )}
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

function RowMenu({
  task,
  onAction,
  onClose,
}: {
  task: DownloadTask;
  onAction: (action: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDoc = () => onClose();
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const items: [string, string][] =
    task.status === "running"
      ? [["pause", "Pause"], ["cancel", "Stop"]]
      : task.status === "paused"
        ? [["resume", "Resume"], ["cancel", "Stop"]]
        : [];

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-line bg-bg py-1 shadow-2xl"
    >
      {items.map(([action, label]) => (
        <MenuItem key={action} onClick={() => onAction(action)}>
          {label}
        </MenuItem>
      ))}
      {task.status === "completed" && (
        <>
          <MenuItem onClick={() => onAction("openFile")}>Open file</MenuItem>
          <MenuItem onClick={() => onAction("openFolder")}>Open folder</MenuItem>
          <MenuItem onClick={() => onAction("openWith")}>Open with…</MenuItem>
        </>
      )}
      {task.kind === "torrent" && <MenuItem onClick={() => onAction("torrentFiles")}>File selection…</MenuItem>}
      <MenuItem onClick={() => onAction("segmentMap")}>Segment map…</MenuItem>
      <MenuItem onClick={() => onAction("rename")}>Move / rename…</MenuItem>
      <MenuItem onClick={() => onAction("properties")}>Properties…</MenuItem>
      <div className="my-1 h-px bg-line-soft" />
      <MenuItem danger onClick={() => onAction("delete")}>
        Delete…
      </MenuItem>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-hover ${
        danger ? "text-danger" : "text-ink"
      }`}
    >
      {children}
    </button>
  );
}
