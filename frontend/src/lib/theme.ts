import type { AppSettings } from "@/lib/types";

/**
 * Applies theme mode + accent color to whichever document calls this.
 * Every window is its own separate document in Tauri (main window,
 * basket, any native panel), so each one needs to call this itself after
 * fetching settings - there's no automatic propagation between windows.
 * Shared here so the logic can't drift between them.
 */
export function applyTheme(settings: Pick<AppSettings, "themeMode" | "accentColor" | "backgroundStyle">) {
  const root = document.documentElement;
  const wantsDark =
    settings.themeMode === "dark" ||
    (settings.themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", wantsDark);
  if (settings.accentColor === "slate") {
    root.removeAttribute("data-accent");
  } else {
    root.setAttribute("data-accent", settings.accentColor);
  }
  if (settings.backgroundStyle === "default") {
    root.removeAttribute("data-bg");
  } else {
    root.setAttribute("data-bg", settings.backgroundStyle);
  }
}
