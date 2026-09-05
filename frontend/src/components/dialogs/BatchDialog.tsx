import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";

export function BatchDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = dialog === "batch";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urls = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  async function submit() {
    if (urls.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.downloadBatchAdd(urls.map((url) => ({ url, start: true })));
      await refresh();
      setText("");
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={560}>
      <DialogHeader icon={<ClipboardList size={16} />} title="Batch download" subtitle="One URL per line" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"https://example.com/file1.zip\nhttps://example.com/file2.zip\n…"}
          rows={9}
          className="w-full resize-none rounded-lg border border-line bg-panel p-2.5 font-mono text-[12px] text-ink focus:border-faint focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] text-faint">{urls.length} link{urls.length === 1 ? "" : "s"} detected</span>
          {error && <span className="text-[11.5px] text-danger">{error}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button primary onClick={submit} disabled={busy || urls.length === 0}>
            {busy ? "Adding…" : `Add ${urls.length || ""} download${urls.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
