import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Grid3x3, Check } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";
import { fmtBytes, fmtEta } from "@/lib/format";
import type { SegmentMapEntry } from "@/lib/types";

type LoadState = "no-selection" | "loading" | "not-segmented" | "ready";

// Quick-pick segment counts, matching the reference design exactly.
const QUICK_PICKS = [1, 2, 4, 8, 16, 32];

function statusColorVar(status?: string): string {
  if (status === "completed") return "var(--success)";
  if (status === "failed") return "var(--danger)";
  if (status === "paused") return "var(--warning)";
  return "var(--accent-ink)"; // running / queued
}

export function SegmentMapDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const tasks = useDownloadsStore((s) => s.tasks);
  const live = useDownloadsStore((s) => s.live);
  const open = dialog === "segmentMap";
  const task = tasks.find((t) => t.id === taskId);

  const [segments, setSegments] = useState<SegmentMapEntry[]>([]);
  const [state, setState] = useState<LoadState>("no-selection");
  const [defaultSegments, setDefaultSegments] = useState<number | null>(null);

  useEffect(() => {
    if (open) ipc.settingsGet().then((s) => setDefaultSegments(s.defaultSegments)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!taskId) {
      setState("no-selection");
      return;
    }
    let stop = false;
    setState("loading");
    async function poll() {
      try {
        const res = await ipc.downloadSegmentMap(taskId!);
        if (stop) return;
        if (!res || res.segments.length === 0) {
          setState("not-segmented");
          setSegments([]);
        } else {
          setState("ready");
          setSegments(res.segments);
        }
      } catch {
        if (!stop) {
          setState("not-segmented");
          setSegments([]);
        }
      }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [open, taskId]);

  const totalBytes = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const receivedBytes = segments.reduce((sum, s) => sum + s.received, 0);
  const doneCount = segments.filter((s) => s.done).length;
  const firstPendingIndex = segments.findIndex((s) => !s.done);
  const remaining = task?.size != null ? Math.max(0, task.size - task.receivedBytes) : totalBytes - receivedBytes;
  const speed = taskId ? live[taskId]?.speed : undefined;
  const eta = taskId ? live[taskId]?.eta : undefined;
  const color = statusColorVar(task?.status);
  const cols = 8;

  async function pickSegments(n: number) {
    setDefaultSegments(n);
    await ipc.settingsUpdate({ defaultSegments: n });
  }

  return (
    <Modal open={open} onClose={close} width={380}>
      <DialogHeader
        icon={<Grid3x3 size={16} />}
        title={
          state === "ready"
            ? `${segments.length} segments${task?.status === "running" && speed ? ` · ${fmtBytes(speed)}/s` : ""}`
            : "Segment map"
        }
        subtitle={task?.filename ?? task?.url ?? "Live per-segment progress"}
        onClose={close}
      />
      <div className="flex flex-col px-5 py-4">
        {state === "no-selection" && (
          <EmptyState text="Select a download in the main list, then open this from its menu or from Settings -> Downloads -> View map." />
        )}
        {state === "loading" && <EmptyState text="Loading segment data…" />}
        {state === "not-segmented" && (
          <EmptyState text="This download isn't using multiple segments (single-stream transfer, or it hasn't started yet)." />
        )}

        {state === "ready" && (
          <>
            {/* Segment grid - filled cells get a colored fill + checkmark,
                the next pending segment pulses while the task is running,
                everything else sits flat. Matches the reference design's
                stagger-in + pulse motion, colors mapped onto our own
                status tokens instead of a separate hardcoded palette. */}
            <div className="grid gap-[5px]" style={{ gridTemplateColumns: `repeat(${Math.min(cols, segments.length)}, 1fr)` }}>
              {segments.map((seg, i) => {
                const isActive = i === firstPendingIndex && task?.status === "running";
                return (
                  <motion.div
                    key={seg.index}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.018, duration: 0.18, ease: "easeOut" }}
                    className="relative h-7 overflow-hidden rounded"
                    style={{
                      border: `1px solid ${seg.done ? color : isActive ? color : "var(--line)"}`,
                      background: seg.done ? `color-mix(in oklab, ${color} 14%, transparent)` : "var(--sunken)",
                    }}
                  >
                    {isActive && (
                      <motion.div
                        animate={{ opacity: [0.35, 0.9, 0.35] }}
                        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0"
                        style={{ background: `color-mix(in oklab, ${color} 16%, transparent)` }}
                      />
                    )}
                    {seg.done && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.018 + 0.1 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <Check size={11} strokeWidth={2.5} style={{ color }} />
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Stats - 2x2 grid matching the reference layout exactly. */}
            <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line-soft overflow-hidden rounded-lg border border-line-soft">
              <StatCell label="Downloaded" value={fmtBytes(receivedBytes)} />
              <StatCell label="Remaining" value={remaining > 0 ? fmtBytes(remaining) : "—"} />
              <StatCell label="Segments" value={`${doneCount} / ${segments.length}`} />
              <StatCell label="ETA" value={task?.status === "running" ? fmtEta(eta) : "—"} />
            </div>

            {/* Segment-count quick picks - changes the app-wide default for
                new downloads (same field as Settings -> Downloads), not
                this specific already-running transfer. */}
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-soft pt-3">
              <span className="text-[10px] uppercase tracking-wide text-faint">Segments / file</span>
              <div className="flex gap-1.5">
                {QUICK_PICKS.map((n) => (
                  <button
                    key={n}
                    onClick={() => pickSegments(n)}
                    className={`flex h-6 w-7 items-center justify-center rounded-md border font-mono text-[10px] transition-colors ${
                      defaultSegments === n
                        ? "border-accent-ink text-accent-ink"
                        : "border-line text-faint hover:border-faint hover:text-ink"
                    }`}
                    style={defaultSegments === n ? { background: "color-mix(in oklab, var(--accent-ink) 12%, transparent)" } : undefined}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end">
          <Button primary onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-panel text-faint">
        <Grid3x3 size={18} />
      </div>
      <p className="max-w-[280px] text-[12px] text-faint">{text}</p>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] font-semibold text-ink">{value}</div>
    </div>
  );
}
