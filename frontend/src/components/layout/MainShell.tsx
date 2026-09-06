import { useEffect } from "react";
import { motion } from "motion/react";
import { PanelLeft } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toolbar } from "@/components/layout/Toolbar";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { DownloadsTable } from "@/components/downloads/DownloadsTable";
import { useCategoryStore } from "@/stores/category";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

// Same spring physics as Xuro's SPRING_PANEL (lib/ease.ts).
const SPRING_PANEL = { type: "spring" as const, stiffness: 420, damping: 40, mass: 0.5 };
const SIDEBAR_WIDTH = 250;

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
  const sidebarHidden = useUIStore((s) => s.sidebarHidden);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (!mod) return;

      if (key === "n") {
        e.preventDefault();
        useUIStore.getState().open("addUrl");
      } else if (e.key === ",") {
        e.preventDefault();
        useUIStore.getState().openSettingsAt("general");
      } else if (key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "k") {
        e.preventDefault();
        // No command palette yet — closest real equivalent is the sidebar
        // search box, so focus that instead of doing nothing.
        document.querySelector<HTMLInputElement>("[data-sidebar-search]")?.focus();
      } else if (key === "t") {
        e.preventDefault();
        useUIStore.getState().open("openTorrent");
      } else if (key === "g") {
        e.preventDefault();
        useUIStore.getState().open("grabber");
      } else if (key === "b") {
        e.preventDefault();
        useUIStore.getState().open("batch");
      } else if (key === "e") {
        e.preventDefault();
        ipc.basketOpen().catch(() => {});
      } else if (e.shiftKey && key === "f") {
        e.preventDefault();
        ipc.settingsChooseDownloadDir().catch(() => {});
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <motion.div
        animate={{ width: sidebarHidden ? 0 : SIDEBAR_WIDTH }}
        initial={false}
        transition={SPRING_PANEL}
        className="h-full flex-shrink-0 overflow-hidden"
      >
        <div style={{ width: SIDEBAR_WIDTH }} className="h-full">
          <Sidebar />
        </div>
      </motion.div>

      <main className="flex min-w-0 flex-1 flex-col">
        <div
          data-tauri-drag-region
          className="flex h-[38px] flex-shrink-0 items-center gap-2 px-2 text-[12px] text-faint"
        >
          <button
            onClick={toggleSidebar}
            title="Toggle sidebar ⌘\"
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <PanelLeft size={15.5} strokeWidth={1.75} />
          </button>
          <span>{TITLES[category] ?? "All Downloads"}</span>
        </div>
        <Toolbar />
        <StatusStrip />
        <DownloadsTable />
      </main>
    </div>
  );
}
