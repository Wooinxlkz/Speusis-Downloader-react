import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal, DialogHeader, Button, Switch, FieldRow } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";

export function DeleteConfirmDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const tasks = useDownloadsStore((s) => s.tasks);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = dialog === "deleteConfirm";
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [busy, setBusy] = useState(false);

  const task = tasks.find((t) => t.id === taskId);

  async function confirm() {
    if (!taskId) return;
    setBusy(true);
    try {
      await ipc.downloadRemove(taskId, deleteFromDisk);
      await refresh();
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={440}>
      <DialogHeader icon={<Trash2 size={16} />} title="Delete download" subtitle={task?.filename ?? task?.url} onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[12.5px] text-muted">This removes the entry from your list. It won't affect anything else running.</p>
        <FieldRow label="Also delete the file from disk" desc="Cannot be undone">
          <Switch on={deleteFromDisk} onToggle={() => setDeleteFromDisk((v) => !v)} />
        </FieldRow>
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button danger onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
