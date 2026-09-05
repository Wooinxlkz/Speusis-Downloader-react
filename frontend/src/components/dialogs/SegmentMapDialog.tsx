import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";
import type { SegmentMapEntry } from "@/lib/types";

export function SegmentMapDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const open = dialog === "segmentMap";
  const [segments, setSegments] = useState<SegmentMapEntry[]>([]);

  useEffect(() => {
    if (!open || !taskId) return;
    let stop = false;
    async function poll() {
      try {
        const res = await ipc.downloadSegmentMap(taskId!);
        if (!stop) setSegments(res?.segments ?? []);
      } catch {
        if (!stop) setSegments([]);
      }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [open, taskId]);

  return (
    <Modal open={open} onClose={close} width={360}>
      <DialogHeader icon={<LayoutGrid size={16} />} title="Segment map" subtitle="Live per-segment progress" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        {segments.length === 0 ? (
          <p className="text-[12.5px] text-faint">No segmented transfer for this task.</p>
        ) : (
          <div className="grid grid-cols-8 gap-1">
            {segments.map((s) => {
              const pct = s.end > s.start ? s.received / (s.end - s.start) : 0;
              return (
                <div
                  key={s.index}
                  title={`Segment ${s.index}: ${(pct * 100).toFixed(0)}%`}
                  className="h-6 rounded"
                  style={{
                    background: s.done
                      ? "var(--success)"
                      : `linear-gradient(90deg, var(--info) ${Math.round(pct * 100)}%, var(--sunken) ${Math.round(pct * 100)}%)`,
                    opacity: s.done ? 0.6 : 0.85,
                  }}
                />
              );
            })}
          </div>
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
