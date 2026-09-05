import { useState } from "react";
import { Layers } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";

export function OpenTorrentDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = dialog === "openTorrent";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    setBusy(true);
    setError(null);
    try {
      await ipc.downloadAddTorrentFile();
      await refresh();
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={420}>
      <DialogHeader icon={<Layers size={16} />} title="Open torrent" subtitle="Add a local .torrent file" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[12.5px] text-muted">
          Pick a <span className="font-mono">.torrent</span> file from disk to start seeding/downloading it.
        </p>
        {error && <p className="text-[11.5px] text-danger">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button primary onClick={pickFile} disabled={busy}>
            {busy ? "Opening…" : "Choose file…"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
