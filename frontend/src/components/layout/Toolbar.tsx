import {
  Play,
  Pause,
  Square,
  Trash2,
  Clock,
  Rss,
  Share2,
  FastForward,
  PauseOctagon,
  Star,
  HelpCircle,
  Info,
} from "lucide-react";
import { useDownloadsStore } from "@/stores/downloads";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

export function Toolbar() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const selectedId = useDownloadsStore((s) => s.selectedId);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = useUIStore((s) => s.open);
  const openSettingsAt = useUIStore((s) => s.openSettingsAt);

  async function resumeSelected() {
    if (selectedId) await ipc.downloadResume(selectedId);
    else await Promise.all(tasks.filter((t) => t.status === "paused").map((t) => ipc.downloadResume(t.id)));
    refresh();
  }
  async function pauseSelected() {
    if (selectedId) await ipc.downloadPause(selectedId);
    else await Promise.all(tasks.filter((t) => t.status === "running").map((t) => ipc.downloadPause(t.id)));
    refresh();
  }
  async function stopSelected() {
    if (selectedId) await ipc.downloadCancel(selectedId);
    refresh();
  }
  async function stopAll() {
    await Promise.all(
      tasks.filter((t) => t.status === "running" || t.status === "queued").map((t) => ipc.downloadCancel(t.id)),
    );
    refresh();
  }
  async function deleteSelected() {
    if (selectedId) {
      useUIStore.getState().open("deleteConfirm", selectedId);
    }
  }
  async function startQueue() {
    await Promise.all(tasks.filter((t) => t.status === "paused" || t.status === "queued").map((t) => ipc.downloadResume(t.id)));
    refresh();
  }
  async function stopQueue() {
    await Promise.all(tasks.filter((t) => t.status === "queued").map((t) => ipc.downloadCancel(t.id)));
    refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line-soft px-3 py-1.5">
      <TbBtn icon={<Play size={17} />} label="Resume" onClick={resumeSelected} />
      <TbBtn icon={<Pause size={17} />} label="Pause" onClick={pauseSelected} />
      <TbBtn icon={<Square size={17} />} label="Stop" onClick={stopSelected} />
      <Sep />
      <TbBtn icon={<Trash2 size={17} />} label="Delete" onClick={deleteSelected} />
      <TbBtn icon={<Clock size={17} />} label="Scheduler" onClick={() => openSettingsAt("schedule")} />
      <TbBtn icon={<Rss size={17} />} label="RSS" onClick={() => open("rss")} />
      <TbBtn icon={<Share2 size={17} />} label="Mk Torrent" onClick={() => open("createTorrent")} />
      <Sep />
      <TbBtn icon={<FastForward size={17} />} label="Start Q." onClick={startQueue} />
      <TbBtn icon={<PauseOctagon size={17} />} label="Stop Q." onClick={stopQueue} />
      <div className="flex-1" />
      <TbBtn icon={<Star size={17} />} label="Register" onClick={() => open("registration")} />
      <TbBtn icon={<HelpCircle size={17} />} label="Help" onClick={() => open("help")} />
      <TbBtn icon={<Info size={17} />} label="About" onClick={() => open("about")} />
      <TbBtn icon={<Square size={17} />} hidden label="Stop All" onClick={stopAll} />
    </div>
  );
}

function TbBtn({
  icon,
  label,
  onClick,
  hidden,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <button
      onClick={onClick}
      className="flex min-w-[52px] flex-col items-center gap-[3px] rounded-lg px-2 py-1.5 text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      <span className="opacity-85">{icon}</span>
      <span className="text-[10px] font-medium tracking-tight">{label}</span>
    </button>
  );
}

function Sep() {
  return <div className="mx-1.5 my-1 w-px self-stretch bg-line-soft" />;
}
