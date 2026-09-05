import { useState } from "react";
import { PenLine } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button, FieldRow } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";

export function RenameDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const tasks = useDownloadsStore((s) => s.tasks);
  const open = dialog === "rename";
  const task = tasks.find((t) => t.id === taskId);
  const [name, setName] = useState(task?.filename ?? "");

  return (
    <Modal open={open} onClose={close} width={420}>
      <DialogHeader icon={<PenLine size={16} />} title="Move / rename" subtitle={task?.filename ?? undefined} onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <FieldRow label="File name">
          <TextInput className="w-[220px]" value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <p className="rounded-lg bg-panel px-3 py-2 text-[11.5px] text-faint">
          The download engine doesn't expose a rename/move command yet, so this can't be wired to real behavior
          without changing engine logic you asked me to leave untouched. The dialog's here and ready for whenever
          that command gets added.
        </p>
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={close}>Close</Button>
          <Button primary disabled>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
