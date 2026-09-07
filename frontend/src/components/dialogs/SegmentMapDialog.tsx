import { useEffect, useState } from "react";
import { Grid3x3 } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";
import { fmtBytes } from "@/lib/format";
import type { SegmentMapEntry } from "@/lib/types";

type LoadState = "no-selection" | "loading" | "not-segmented" | "ready";

export function SegmentMapDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const tasks = useDownloadsStore((s) => s.tasks);
  const open = dialog === "segmentMap";
  const task = tasks.find((t) => t.id === taskId);

  const [segments, setSegments] = useState<SegmentMapEntry[]>([]);
  const [state, setState] = useState<LoadState>("no-selection");

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
  const donePct = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;

  return (
    <Modal open={open} onClose={close} width={400}>
      <DialogHeader
        icon={<Grid3x3 size={16} />}
        title="Segment map"
        subtitle={task?.filename ?? task?.url ?? "Live per-segment progress"}
        onClose={close}
      />
      <div className="flex flex-col gap-3 px-5 py-4">
        {state === "no-selection" && (
          <EmptyState text="Select a download in the main list, then open this from its menu or from Settings -> Downloads -> View map." />
        )}
        {state === "loading" && <EmptyState text="Loading segment data…" />}
        {state === "not-segmented" && (
          <EmptyState text="This download isn't using multiple segments (single-stream transfer, or it hasn't started yet)." />
        )}

        {state === "ready" && (
          <>
            <div className="flex items-center justify-between text-[11.5px] text-faint">
              <span>{segments.length} segments</span>
              <span className="font-mono">
                {fmtBytes(receivedBytes)} / {fmtBytes(totalBytes)} · {donePct}%
              </span>
            </div>

            <div className="grid grid-cols-8 gap-1">
              {segments.map((s) => {
                const pct = s.end > s.start ? s.received / (s.end - s.start) : 0;
                return (
                  <div
                    key={s.index}
                    title={`Segment ${s.index}: ${(pct * 100).toFixed(0)}%`}
                    className="h-7 rounded-md"
                    style={{
                      background: s.done
                        ? "var(--success)"
                        : `linear-gradient(90deg, var(--accent-ink) ${Math.round(pct * 100)}%, var(--sunken) ${Math.round(pct * 100)}%)`,
                      opacity: s.done ? 0.6 : 0.85,
                    }}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-4 text-[11px] text-faint">
              <Legend swatch="var(--success)" label="Done" />
              <Legend swatch="var(--accent-ink)" label="In progress" />
              <Legend swatch="var(--sunken)" label="Pending" />
            </div>
          </>
        )}

        <div className="mt-1 flex justify-end">
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

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: swatch }} />
      {label}
    </span>
  );
}
