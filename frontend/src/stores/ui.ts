import { create } from "zustand";

export type DialogName =
  | "addUrl"
  | "openTorrent"
  | "batch"
  | "grabber"
  | "createTorrent"
  | "torrentFiles"
  | "settings"
  | "rss"
  | "logins"
  | "registration"
  | "about"
  | "help"
  | "properties"
  | "rename"
  | "deleteConfirm"
  | "segmentMap"
  | "tracer"
  | null;

interface UIState {
  dialog: DialogName;
  dialogTaskId: string | null;
  settingsTab: string;
  open: (dialog: DialogName, taskId?: string) => void;
  close: () => void;
  setSettingsTab: (tab: string) => void;
  openSettingsAt: (tab: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  dialog: null,
  dialogTaskId: null,
  settingsTab: "general",
  open: (dialog, taskId) => set({ dialog, dialogTaskId: taskId ?? null }),
  close: () => set({ dialog: null, dialogTaskId: null }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  openSettingsAt: (tab) => set({ dialog: "settings", settingsTab: tab }),
}));
