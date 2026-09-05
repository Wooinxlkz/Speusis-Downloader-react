import { Info } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { fmtBytes } from "@/lib/format";

export function PropertiesDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const tasks = useDownloadsStore((s) => s.tasks);
  const open = dialog === "properties";
  const task = tasks.find((t) => t.id === taskId);

  return (
    <Modal open={open} onClose={close} width={480}>
      <DialogHeader icon={<Info size={16} />} title="Properties" subtitle={task?.filename ?? undefined} onClose={close} />
      <div className="flex flex-col gap-2.5 px-5 py-4">
        {task ? (
          <>
            <Row label="URL" value={task.url} mono />
            <Row label="Kind" value={task.kind ?? "http"} />
            <Row label="Status" value={task.status} />
            <Row label="Size" value={fmtBytes(task.size)} />
            <Row label="Received" value={fmtBytes(task.receivedBytes)} />
            <Row label="Output path" value={task.outputPath ?? "—"} mono />
            <Row label="Retries" value={String(task.retryCount)} />
            {task.peers != null && <Row label="Peers" value={String(task.peers)} />}
            {task.securityScan && <Row label="Security scan" value={task.securityScan.status} />}
            {task.lastError && <Row label="Last error" value={task.lastError} />}
          </>
        ) : (
          <p className="text-[12.5px] text-faint">Task not found.</p>
        )}
        <div className="mt-2 flex justify-end">
          <Button primary onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-1.5 last:border-b-0">
      <span className="flex-shrink-0 text-[12px] text-faint">{label}</span>
      <span className={`min-w-0 truncate text-right text-[12.5px] ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
