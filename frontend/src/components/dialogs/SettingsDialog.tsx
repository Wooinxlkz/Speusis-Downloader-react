import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Settings as SettingsIcon,
  Download,
  Share2,
  Clock,
  Palette,
  Info,
  X,
  FolderOpen,
} from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
import { FieldRow, Switch, TextInput, Button } from "./Modal";
import { ipc } from "@/lib/ipc";
import type { AccentColor, ThemeMode } from "@/lib/types";

const TABS: { id: string; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={14} />, desc: "Folders and default behavior" },
  { id: "downloads", label: "Downloads", icon: <Download size={14} />, desc: "Concurrency, retries, scanning" },
  { id: "connections", label: "Connections", icon: <Share2 size={14} />, desc: "Bandwidth and network limits" },
  { id: "schedule", label: "Schedule", icon: <Clock size={14} />, desc: "Auto start/stop and peak hours" },
  { id: "appearance", label: "Appearance", icon: <Palette size={14} />, desc: "Theme and accent color" },
  { id: "about", label: "About", icon: <Info size={14} />, desc: "Version and app info" },
];

export function SettingsDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const { settings, load, update } = useSettingsStore();
  const open = dialog === "settings";

  useEffect(() => {
    if (open && !settings) load();
  }, [open, settings, load]);

  const tab = TABS.find((t) => t.id === settingsTab) ?? TABS[0];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-[6px] transition-opacity duration-200 ease-out ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={{ width: 720, height: 520 }}
        className={`flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl transition-all duration-300 ease-out ${
          open ? "translate-y-0 scale-100 opacity-100" : "translate-y-2.5 scale-[.96] opacity-0"
        }`}
      >
        {/* left nav */}
        <aside className="flex w-[196px] flex-shrink-0 flex-col border-r border-line-soft">
          <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
            <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-panel text-muted">
              <SettingsIcon size={15} />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
              <p className="text-[10.5px] text-faint">Speusis preferences</p>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5 px-2.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setSettingsTab(t.id)}
                className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] font-medium transition-colors ${
                  t.id === tab.id ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                <span className="opacity-85">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto p-4 text-[10.5px] leading-4 text-faint">
            <p>Downloads, torrents, and FTP, one native app.</p>
            <p className="mt-2 font-mono">Version 0.1.0</p>
          </div>
        </aside>

        {/* right content */}
        <section className="flex min-w-0 flex-1 flex-col bg-bg">
          <header className="flex h-[65px] flex-shrink-0 items-center border-b border-line-soft px-5">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">{tab.label}</h3>
              <p className="mt-0.5 text-[11.5px] text-faint">{tab.desc}</p>
            </div>
            <button
              onClick={close}
              className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <X size={14} />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {/* Same page-transition contract as Xuro's real SettingsModal.tsx:
                AnimatePresence mode="wait", 3px y-slide, 120ms ease-out. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab.id}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 overflow-y-auto px-6 py-5"
              >
                {!settings ? (
                  <p className="text-[12.5px] text-faint">Loading…</p>
                ) : tab.id === "general" ? (
                  <GeneralTab settings={settings} update={update} />
                ) : tab.id === "downloads" ? (
                  <DownloadsTab settings={settings} update={update} />
                ) : tab.id === "connections" ? (
                  <ConnectionsTab settings={settings} update={update} />
                ) : tab.id === "schedule" ? (
                  <ScheduleTab settings={settings} update={update} />
                ) : tab.id === "appearance" ? (
                  <AppearanceTab settings={settings} update={update} />
                ) : (
                  <AboutTab />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  );
}

type Settings = NonNullable<ReturnType<typeof useSettingsStore.getState>["settings"]>;
type Update = ReturnType<typeof useSettingsStore.getState>["update"];

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="text-[12.5px] font-semibold">{title}</p>
      {desc && <p className="mb-2.5 mt-0.5 text-[11.5px] text-faint">{desc}</p>}
      <div className="divide-y divide-line-soft">{children}</div>
    </div>
  );
}

function GeneralTab({ settings, update }: { settings: Settings; update: Update }) {
  async function chooseDir() {
    const dir = await ipc.settingsChooseDownloadDir();
    if (dir) update({ downloadDir: dir });
  }
  return (
    <>
      <Group title="Download folder" desc="Where new files are saved by default">
        <div className="flex gap-1.5 py-1.5">
          <TextInput readOnly value={settings.downloadDir} />
          <Button onClick={chooseDir}>
            <FolderOpen size={14} />
          </Button>
        </div>
      </Group>
      <Group title="Behavior">
        <FieldRow label="Start with system" desc="Launch Speusis when you log in">
          <Switch on={settings.autoStartWithSystem} onToggle={() => update({ autoStartWithSystem: !settings.autoStartWithSystem })} />
        </FieldRow>
        <FieldRow label="Minimize to tray" desc="Keep running in the background when closed">
          <Switch on={settings.minimizeToTray} onToggle={() => update({ minimizeToTray: !settings.minimizeToTray })} />
        </FieldRow>
        <FieldRow label="Scan completed files" desc="Run a security scan after each download finishes">
          <Switch on={settings.scanCompletedFiles} onToggle={() => update({ scanCompletedFiles: !settings.scanCompletedFiles })} />
        </FieldRow>
        <FieldRow label="Route by file type" desc="Sort into Documents/Music/Video subfolders automatically">
          <Switch on={settings.fileTypeRouting} onToggle={() => update({ fileTypeRouting: !settings.fileTypeRouting })} />
        </FieldRow>
      </Group>
    </>
  );
}

function DownloadsTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Group title="Queue" desc="How many transfers run at once">
        <FieldRow label="Max concurrent downloads">
          <NumberInput value={settings.maxConcurrentDownloads} onChange={(v) => update({ maxConcurrentDownloads: v })} min={1} max={20} />
        </FieldRow>
        <FieldRow label="Segments per download">
          <NumberInput value={settings.defaultSegments} onChange={(v) => update({ defaultSegments: v })} min={1} max={32} />
        </FieldRow>
        <FieldRow label="Max retries on failure">
          <NumberInput value={settings.maxRetries} onChange={(v) => update({ maxRetries: v })} min={0} max={20} />
        </FieldRow>
      </Group>
      <Group title="Seeding" desc="Torrent seed ratio target">
        <FieldRow label="Seed ratio">
          <NumberInput value={settings.seedRatio} onChange={(v) => update({ seedRatio: v })} min={0} max={10} step={0.1} />
        </FieldRow>
      </Group>
    </>
  );
}

function ConnectionsTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Group title="Bandwidth" desc="Speed caps in KB/s. Zero means unlimited.">
        <FieldRow label="Download limit">
          <NumberInput value={settings.downloadLimit} onChange={(v) => update({ downloadLimit: v })} min={0} />
        </FieldRow>
        <FieldRow label="Upload limit">
          <NumberInput value={settings.uploadLimit} onChange={(v) => update({ uploadLimit: v })} min={0} />
        </FieldRow>
      </Group>
      <Group title="Network">
        <FieldRow label="Listener port">
          <NumberInput value={settings.listenerPort} onChange={(v) => update({ listenerPort: v })} min={1} max={65535} />
        </FieldRow>
        <FieldRow label="Allow insecure TLS" desc="Accept invalid/self-signed certificates">
          <Switch on={settings.allowInvalidTls} onToggle={() => update({ allowInvalidTls: !settings.allowInvalidTls })} />
        </FieldRow>
        <FieldRow label="Remote access" desc="Allow adding downloads from the browser extension">
          <Switch on={settings.remoteAccess} onToggle={() => update({ remoteAccess: !settings.remoteAccess })} />
        </FieldRow>
      </Group>
      <Group title="IP blocklist">
        <div className="py-1.5">
          <TextInput
            placeholder="https://…/blocklist.txt"
            value={settings.ipBlocklistUrl}
            onChange={(e) => update({ ipBlocklistUrl: e.target.value })}
          />
        </div>
      </Group>
    </>
  );
}

function ScheduleTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Group title="Auto start / stop" desc="Run the app only within a daily window">
        <FieldRow label="Enable schedule">
          <Switch on={settings.scheduleEnabled} onToggle={() => update({ scheduleEnabled: !settings.scheduleEnabled })} />
        </FieldRow>
        {settings.scheduleEnabled && (
          <div className="flex items-center gap-3 py-2">
            <TimeInput
              hour={settings.scheduleStartHour}
              minute={settings.scheduleStartMinute}
              onChange={(h, m) => update({ scheduleStartHour: h, scheduleStartMinute: m })}
            />
            <span className="text-[12px] text-faint">to</span>
            <TimeInput
              hour={settings.scheduleStopHour}
              minute={settings.scheduleStopMinute}
              onChange={(h, m) => update({ scheduleStopHour: h, scheduleStopMinute: m })}
            />
          </div>
        )}
      </Group>
      <Group title="Peak hours" desc="Apply a stricter speed cap during busy hours">
        <FieldRow label="Enable peak hours">
          <Switch on={settings.peakHoursEnabled} onToggle={() => update({ peakHoursEnabled: !settings.peakHoursEnabled })} />
        </FieldRow>
        {settings.peakHoursEnabled && (
          <>
            <div className="flex items-center gap-3 py-2">
              <NumberInput value={settings.peakStartHour} onChange={(v) => update({ peakStartHour: v })} min={0} max={23} />
              <span className="text-[12px] text-faint">to</span>
              <NumberInput value={settings.peakStopHour} onChange={(v) => update({ peakStopHour: v })} min={0} max={23} />
            </div>
            <FieldRow label="Peak download limit (KB/s)">
              <NumberInput value={settings.peakDownloadLimit} onChange={(v) => update({ peakDownloadLimit: v })} min={0} />
            </FieldRow>
            <FieldRow label="Peak upload limit (KB/s)">
              <NumberInput value={settings.peakUploadLimit} onChange={(v) => update({ peakUploadLimit: v })} min={0} />
            </FieldRow>
          </>
        )}
      </Group>
    </>
  );
}

const ACCENTS: { id: AccentColor; hex: string }[] = [
  { id: "slate", hex: "#6e6e6a" },
  { id: "blue", hex: "#3457b2" },
  { id: "green", hex: "#2f7d4f" },
  { id: "amber", hex: "#96631c" },
  { id: "violet", hex: "#7a5cc9" },
  { id: "rose", hex: "#b23a2e" },
];

function AppearanceTab({ settings, update }: { settings: Settings; update: Update }) {
  const themes: { id: ThemeMode; label: string; desc: string }[] = [
    { id: "system", label: "System", desc: "Match your OS" },
    { id: "light", label: "Light", desc: "Bright canvas" },
    { id: "dark", label: "Dark", desc: "Low light" },
  ];
  return (
    <>
      <Group title="Theme">
        <div className="grid grid-cols-3 gap-2 py-1.5">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => update({ themeMode: t.id })}
              className={`flex min-h-16 flex-col items-start gap-2 rounded-xl p-3 text-left transition-colors ${
                settings.themeMode === t.id ? "bg-invert text-invert-ink" : "bg-panel text-muted hover:bg-hover hover:text-ink"
              }`}
            >
              <span className="text-[12.5px] font-semibold">{t.label}</span>
              <span className="text-[10.5px] opacity-75">{t.desc}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Accent" desc="Touches progress bars and active states">
        <div className="flex gap-2.5 py-1.5">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => update({ accentColor: a.id })}
              className={`grid h-8 w-8 place-items-center rounded-full border-2 transition-colors ${
                settings.accentColor === a.id ? "border-ink" : "border-transparent hover:border-line"
              }`}
            >
              <span className="h-5 w-5 rounded-full" style={{ background: a.hex }} />
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}

function AboutTab() {
  const [version, setVersion] = useState("…");
  useEffect(() => {
    ipc.appGetVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);
  return (
    <Group title="Speusis Downloader" desc="Native desktop download manager — HTTP, FTP, and BitTorrent in one app.">
      <p className="py-1.5 font-mono text-[11px] text-faint">Version {version}</p>
    </Group>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-[80px] rounded-lg border border-line bg-panel px-2.5 py-1.5 text-center text-[12.5px] text-ink focus:border-faint focus:outline-none"
    />
  );
}

function TimeInput({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <NumberInput value={hour} onChange={(v) => onChange(v, minute)} min={0} max={23} />
      <span className="text-faint">:</span>
      <NumberInput value={minute} onChange={(v) => onChange(hour, v)} min={0} max={59} />
    </div>
  );
}
