import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "@/lib/ipc";
import type { UpdateInfo } from "@/lib/types";

type Status = "idle" | "checking" | "available" | "error";

interface UpdaterState {
  status: Status;
  release: UpdateInfo | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  _initListener: () => void;
}

let listenerStarted = false;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  release: null,

  check: async () => {
    set({ status: "checking" });
    try {
      const res = await ipc.updateCheck();
      if (res.info) set({ status: "available", release: res.info });
      else set({ status: "idle", release: null });
    } catch {
      set({ status: "error" });
    }
  },

  download: async () => {
    const { release } = get();
    if (release) await ipc.updateOpenDownload(release.downloadUrl);
  },

  // Real cross-platform detection: the backend's update_check command runs
  // identically on Windows/Linux/macOS and pushes a real "update-available"
  // event (see main.rs -> commands.rs::update_check) whenever any window
  // triggers a check - not just the one that asked. One listener here
  // covers all three platforms because the check itself isn't
  // platform-specific, only the download link it resolves is (a direct
  // .exe on Windows; the release page itself elsewhere, since the engine
  // doesn't do per-asset matching for those platforms yet).
  _initListener: () => {
    if (listenerStarted) return;
    listenerStarted = true;
    listen<UpdateInfo>("update-available", (evt) => {
      set({ status: "available", release: evt.payload });
    });
  },
}));
