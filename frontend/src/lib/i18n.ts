import { create } from "zustand";

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
  { code: "da", label: "Dansk" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
  { code: "sv", label: "Svenska" },
  { code: "tr", label: "Türkçe" },
  { code: "zh-CN", label: "中文（简体）" },
];

interface I18nState {
  language: string;
  strings: Record<string, string>;
  setLanguage: (code: string) => Promise<void>;
  init: () => Promise<void>;
}

const STORAGE_KEY = "speusis-language";

async function loadStrings(code: string): Promise<Record<string, string>> {
  if (code === "en") return {};
  try {
    const res = await fetch(`/languages/${code}.json`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export const useI18nStore = create<I18nState>((set) => ({
  language: "en",
  strings: {},

  init: async () => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? "en";
    const strings = await loadStrings(saved);
    set({ language: saved, strings });
  },

  setLanguage: async (code) => {
    const strings = await loadStrings(code);
    localStorage.setItem(STORAGE_KEY, code);
    set({ language: code, strings });
  },
}));

/**
 * Translates a key against the original app's real language files
 * (copied over from the vanilla build's `languages/` folder, 487 keys
 * each). Coverage is real but partial: those files were written for the
 * old UI's exact strings, so plenty of this rebuild's wording (new
 * Settings tabs, new dialog copy) has no matching key yet and falls back
 * to the English text passed in - normal i18n fallback behavior, not a
 * bug, but worth knowing before assuming every label rotates languages.
 */
export function useT() {
  const strings = useI18nStore((s) => s.strings);
  return (key: string, fallback: string) => strings[key] ?? fallback;
}
