import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { applyTheme } from "@/lib/theme";
import type { AppSettings } from "@/lib/types";

interface SettingsState {
  settings: AppSettings | null;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,

  load: async () => {
    const settings = await ipc.settingsGet();
    applyTheme(settings);
    set({ settings });
  },

  update: async (patch) => {
    const settings = await ipc.settingsUpdate(patch);
    applyTheme(settings);
    set({ settings });
  },
}));
