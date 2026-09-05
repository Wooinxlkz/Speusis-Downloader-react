import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";
import { fmtBytes } from "@/lib/format";
import type { TorrentFileEntry } from "@/lib/types";

export function TorrentFilesDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const taskId = useUIStore((s) => s.dialogTaskId);
  const close = useUIStore((s) => s.close);
  const open = dialog === "torrentFiles";

  const [files, setFiles] = useState<TorrentFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && taskId) {
      setLoading(true);
      ipc
        .torrentGetFiles(taskId)
        .then(setFiles)
        .catch(() => setFiles([]))
        .finally(() => setLoading(false));
    }
  }, [open, taskId]);

  async function toggle(file: TorrentFileEntry) {
    if (!taskId) return;
    const next = !file.selected;
    setFiles((fs) => fs.map((f) => (f.index === file.index ? { ...f, selected: next } : f)));
    try {
      await ipc.torrentSelectFile(taskId, file.index, next);
    } catch {
      setFiles((fs) => fs.map((f) => (f.index === file.index ? { ...f, selected: !next } : f)));
    }
  }

  return (
    <Modal open={open} onClose={close} width={520}>
      <DialogHeader icon={<Layers size={16} />} title="Torrent files" subtitle="Choose which files to download" onClose={close} />
      <div className="flex flex-col gap-2 px-5 py-4">
        {loading && <p className="text-[12.5px] text-faint">Loading file list…</p>}
        {!loading && files.length === 0 && <p className="text-[12.5px] text-faint">No file list available yet.</p>}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line-soft">
          {files.map((f) => (
            <label
              key={f.index}
              className="flex cursor-pointer items-center gap-2.5 border-b border-line-soft px-3 py-2 last:border-b-0 hover:bg-hover"
            >
              <input type="checkbox" checked={f.selected} onChange={() => toggle(f)} />
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{f.name}</span>
              <span className="flex-shrink-0 font-mono text-[11px] text-faint">{fmtBytes(f.length)}</span>
            </label>
          ))}
        </div>
        <div className="mt-1 flex justify-end">
          <Button primary onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
