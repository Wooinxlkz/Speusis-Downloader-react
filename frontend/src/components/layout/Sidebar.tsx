import { useEffect, useMemo, useState } from "react";
import {
  Search,
  FolderOpen,
  CirclePlus,
  Layers,
  SearchCode,
  ClipboardList,
  ShoppingBasket,
  LayoutGrid,
  Archive,
  FileText,
  Music,
  MonitorSmartphone,
  Film,
  Clock,
  CheckCircle2,
  ListOrdered,
  HardDrive,
  Settings as SettingsIcon,
  Sun,
  Moon,
  ChevronDown,
  X,
  ArrowDownToLine,
} from "lucide-react";
import { useDownloadsStore } from "@/stores/downloads";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useCategoryStore } from "@/stores/category";
import { useSearchStore } from "@/stores/search";
import { useUpdaterStore } from "@/stores/updater";
import { ipc } from "@/lib/ipc";
import { revealCategory } from "@/lib/categorize";

const EXT_GROUPS: Record<string, string[]> = {
  compressed: ["zip", "rar", "7z", "tar", "gz"],
  documents: ["pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "ppt", "pptx"],
  music: ["mp3", "flac", "wav", "aac", "ogg", "m4a"],
  programs: ["exe", "msi", "dmg", "apk"],
  video: ["mp4", "mkv", "avi", "mov", "webm"],
};

export function Sidebar() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const { settings, update, load } = useSettingsStore();
  const open = useUIStore((s) => s.open);
  const openSettingsAt = useUIStore((s) => s.openSettingsAt);
  const category = useCategoryStore((s) => s.category);
  const setCategory = useCategoryStore((s) => s.set);
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const [drives, setDrives] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleSection = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  useEffect(() => {
    ipc.settingsListDrives().then(setDrives).catch(() => setDrives([]));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: tasks.length,
      compressed: 0,
      documents: 0,
      music: 0,
      programs: 0,
      video: 0,
      unfinished: 0,
      finished: 0,
      queues: 0,
    };
    for (const t of tasks) {
      const group = revealCategory(t, EXT_GROUPS);
      if (group) c[group]++;
      if (t.status === "running" || t.status === "paused") c.unfinished++;
      if (t.status === "completed") c.finished++;
      if (t.status === "queued") c.queues++;
    }
    return c;
  }, [tasks]);

  const isDark = document.documentElement.classList.contains("dark");

  return (
    <aside className="flex h-full w-[250px] flex-shrink-0 flex-col border-r border-line-soft bg-panel">
      <div data-tauri-drag-region className="h-[38px] flex-shrink-0" />

      <div className="px-2 pb-2">
        <div className="flex w-full items-center gap-2 rounded-md border border-line-soft bg-bg px-2.5 py-1.5 text-[12.5px] transition-colors focus-within:border-line">
          <Search size={14} className="flex-shrink-0 text-faint" />
          <input
            data-sidebar-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search downloads…"
            className="w-full bg-transparent text-ink placeholder:text-faint focus:outline-none"
          />
          {query ? (
            <button onClick={() => setQuery("")} className="flex-shrink-0 text-faint hover:text-ink">
              <X size={12} />
            </button>
          ) : (
            <span className="flex-shrink-0 rounded border border-line px-1 text-[10px] text-faint">⌘K</span>
          )}
        </div>
      </div>

      <SectionLabel>Speusis</SectionLabel>
      <nav className="flex flex-shrink-0 flex-col gap-px px-2">
        <NavItem icon={<FolderOpen size={15} />} label="Folder" hint="⌘⇧F" onClick={() => ipc.settingsChooseDownloadDir().then(() => load())} />
        <NavItem icon={<CirclePlus size={15} />} label="Add URL" hint="⌘N" active onClick={() => open("addUrl")} />
        <NavItem icon={<Layers size={15} />} label="Torrent" hint="⌘T" onClick={() => open("openTorrent")} />
        <NavItem icon={<SearchCode size={15} />} label="Grabber" hint="⌘G" onClick={() => open("grabber")} />
        <NavItem icon={<ClipboardList size={15} />} label="Batch" hint="⌘B" onClick={() => open("batch")} />
        <NavItem icon={<ShoppingBasket size={15} />} label="Basket" hint="⌘E" onClick={() => ipc.basketOpen().catch(() => {})} />
      </nav>

      {/* Only this zone scrolls — quick actions above and the settings
          footer below stay put. Scrollbar is invisible until hovered. */}
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        <CollapseHead label="Downloads" id="downloads" collapsed={!!collapsed.downloads} onToggle={toggleSection} />
        <Collapse collapsed={!!collapsed.downloads}>
          <div className="flex flex-col gap-px px-2 pb-1">
            <TreeItem icon={<LayoutGrid size={14} />} label="All Downloads" count={counts.all} selected={category === "all"} onClick={() => setCategory("all")} />
            <TreeItem icon={<Archive size={14} />} label="Compressed" count={counts.compressed} selected={category === "compressed"} onClick={() => setCategory("compressed")} />
            <TreeItem icon={<FileText size={14} />} label="Documents" count={counts.documents} selected={category === "documents"} onClick={() => setCategory("documents")} />
            <TreeItem icon={<Music size={14} />} label="Music" count={counts.music} selected={category === "music"} onClick={() => setCategory("music")} />
            <TreeItem icon={<MonitorSmartphone size={14} />} label="Programs" count={counts.programs} selected={category === "programs"} onClick={() => setCategory("programs")} />
            <TreeItem icon={<Film size={14} />} label="Video" count={counts.video} selected={category === "video"} onClick={() => setCategory("video")} />
          </div>
        </Collapse>

        <CollapseHead label="Status" id="status" collapsed={!!collapsed.status} onToggle={toggleSection} />
        <Collapse collapsed={!!collapsed.status}>
          <div className="flex flex-col gap-px px-2 pb-1">
            <TreeItem icon={<Clock size={14} />} label="Unfinished" count={counts.unfinished} selected={category === "unfinished"} onClick={() => setCategory("unfinished")} />
            <TreeItem icon={<CheckCircle2 size={14} />} label="Finished" count={counts.finished} selected={category === "finished"} onClick={() => setCategory("finished")} />
            <TreeItem icon={<ListOrdered size={14} />} label="Queues" count={counts.queues} selected={category === "queues"} onClick={() => setCategory("queues")} />
          </div>
        </Collapse>

        {drives.length > 0 && (
          <>
            <CollapseHead label="Drives" id="drives" collapsed={!!collapsed.drives} onToggle={toggleSection} />
            <Collapse collapsed={!!collapsed.drives}>
              <div className="flex flex-col gap-px px-2 pb-1">
                {drives.map((d) => (
                  <TreeItem key={d} icon={<HardDrive size={14} />} label={d} />
                ))}
              </div>
            </Collapse>
          </>
        )}
      </div>

      <UpdateRow />

      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-line-soft p-2">
        <button
          onClick={() => openSettingsAt("general")}
          className="flex h-[30px] flex-1 items-center gap-2 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <SettingsIcon size={15} />
          <span>Settings</span>
          <span className="ml-auto text-[10px] text-faint">⌘,</span>
        </button>
        <button
          onClick={() => update({ themeMode: isDark ? "light" : "dark" })}
          className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          {isDark ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-4 pb-1.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
      {children}
    </div>
  );
}

function CollapseHead({
  label,
  id,
  collapsed,
  onToggle,
}: {
  label: string;
  id: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(id)}
      className="flex w-full select-none items-center gap-1.5 px-3 pb-1.5 pt-2.5 text-left"
    >
      <ChevronDown
        size={11}
        strokeWidth={3}
        className={`flex-shrink-0 text-faint transition-transform duration-150 ease-out ${collapsed ? "-rotate-90" : ""}`}
      />
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{label}</span>
    </button>
  );
}

function Collapse({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden transition-[max-height,opacity] duration-200 ease-out"
      style={{ maxHeight: collapsed ? 0 : 400, opacity: collapsed ? 0 : 1 }}
    >
      {children}
    </div>
  );
}

function NavItem({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-medium transition-colors ${
        active ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      <span className="opacity-85">{icon}</span>
      <span>{label}</span>
      {hint && <span className="ml-auto text-[10px] text-faint">{hint}</span>}
    </button>
  );
}

function TreeItem({
  icon,
  label,
  count,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
        selected ? "bg-active font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      <span className="opacity-80">{icon}</span>
      <span className="truncate">{label}</span>
      {!!count && (
        <span
          className={`ml-auto rounded-full px-1.5 text-[10.5px] ${selected ? "bg-panel" : "bg-sunken"} text-faint`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function UpdateRow() {
  const status = useUpdaterStore((s) => s.status);
  const release = useUpdaterStore((s) => s.release);
  const download = useUpdaterStore((s) => s.download);
  const check = useUpdaterStore((s) => s.check);
  const initListener = useUpdaterStore((s) => s._initListener);

  useEffect(() => {
    initListener();
    check();
  }, [initListener, check]);

  if (status !== "available") return null;

  return (
    <div className="flex-shrink-0 border-t border-line-soft px-2 py-1.5">
      <button
        onClick={() => download()}
        className="flex w-full items-center gap-2 rounded-md bg-hover px-2.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors duration-100 hover:bg-active"
      >
        <ArrowDownToLine size={14} strokeWidth={2} className="flex-shrink-0" />
        <span className="truncate">Update to {release?.version}</span>
        <span className="ml-auto flex-shrink-0 text-[11px] text-faint">Download</span>
      </button>
    </div>
  );
}
