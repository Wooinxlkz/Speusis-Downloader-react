import { useState } from "react";
import { useDownloadsStore } from "@/stores/downloads";
import { useSettingsStore } from "@/stores/settings";
import { ThroughputGraph } from "./ThroughputGraph";

export function StatusStrip() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const settings = useSettingsStore((s) => s.settings);
  const [speedLabel, setSpeedLabel] = useState("0 B/s");

  const active = tasks.filter((t) => t.status === "running").length;
  const done = tasks.filter((t) => t.status === "completed").length;

  return (
    <div className="flex items-center gap-6 border-b border-line-soft bg-panel px-4 py-2.5">
      <Stat label="Down" value={speedLabel} accent />
      <Stat label="Active" value={String(active)} />
      <Stat label="Done" value={String(done)} />
      <ThroughputGraph onSpeedLabel={setSpeedLabel} />
      <div className="ml-auto text-right">
        <div className="text-[10px] uppercase tracking-wide text-faint">Listener</div>
        <div className="font-mono text-[11px] font-semibold">
          127.0.0.1:{settings?.listenerPort ?? 9999}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-faint">{label}</span>
      <span className={`font-mono text-[13px] font-semibold ${accent ? "text-accent-ink" : ""}`}>{value}</span>
    </div>
  );
}
