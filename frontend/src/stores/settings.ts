import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import type { AppSettings } from "@/lib/types";

interface SettingsState {
  settings: AppSettings | null;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

function applyTheme(settings: AppSettings) {
  const root = document.documentElement;
  const wantsDark =
    settings.themeMode === "dark" ||
    (settings.themeMode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", wantsDark);
  if (settings.accentColor === "slate") {
    root.removeAttribute("data-accent");
  } else {
    root.setAttribute("data-accent", settings.accentColor);
  }
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
