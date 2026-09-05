import { useState } from "react";
import { CirclePlus } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";

export function AddDownloadDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = dialog === "addUrl";

  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(start: boolean) {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.downloadAdd({
        url: url.trim(),
        filename: filename.trim() || undefined,
        label: label.trim() || undefined,
        start,
      });
      await refresh();
      setUrl("");
      setFilename("");
      setLabel("");
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={440}>
      <DialogHeader icon={<CirclePlus size={16} />} title="Add download" subtitle="Paste a URL or magnet link" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <TextInput
          autoFocus
          placeholder="https://… or magnet:?xt=urn:btih:…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(true)}
        />
        <TextInput placeholder="Save as (optional)" value={filename} onChange={(e) => setFilename(e.target.value)} />
        <TextInput placeholder="Label — e.g. Work, Movies (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        {error && <p className="text-[11.5px] text-danger">{error}</p>}
        <div className="mt-1.5 flex justify-end gap-2">
          <Button onClick={() => submit(false)} disabled={busy || !url.trim()}>
            Download later
          </Button>
          <Button primary onClick={() => submit(true)} disabled={busy || !url.trim()}>
            Start download
          </Button>
        </div>
      </div>
    </Modal>
  );
}
