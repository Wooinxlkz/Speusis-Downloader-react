import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toolbar } from "@/components/layout/Toolbar";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { DownloadsTable } from "@/components/downloads/DownloadsTable";
import { useCategoryStore } from "@/stores/category";
import { useUIStore } from "@/stores/ui";

const TITLES: Record<string, string> = {
  all: "All Downloads",
  compressed: "Compressed",
  documents: "Documents",
  music: "Music",
  programs: "Programs",
  video: "Video",
  unfinished: "Unfinished",
  finished: "Finished",
  queues: "Queues",
};

export function MainShell() {
  const category = useCategoryStore((s) => s.category);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        useUIStore.getState().open("addUrl");
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        useUIStore.getState().openSettingsAt("general");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="flex h-[38px] flex-shrink-0 items-center px-4 text-[12px] text-faint">
          {TITLES[category] ?? "All Downloads"}
        </div>
        <Toolbar />
        <StatusStrip />
        <DownloadsTable />
      </main>
    </div>
  );
}
