import { useState } from "react";
import { Share2 } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button, FieldRow } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

export function CreateTorrentDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "createTorrent";

  const [sourcePath, setSourcePath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [name, setName] = useState("");
  const [tracker, setTracker] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(setter: (v: string) => void, directory: boolean) {
    const path = await ipc.dialogChooseFile(directory);
    if (path) setter(path);
  }

  async function create() {
    if (!sourcePath.trim() || !outputDir.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const path = await ipc.torrentCreate(sourcePath.trim(), outputDir.trim(), name.trim() || undefined, tracker.trim() || undefined);
      setResult(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={480}>
      <DialogHeader icon={<Share2 size={16} />} title="Create torrent" subtitle="Package a file or folder as a .torrent" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <FieldRow label="Source file / folder">
          <div className="flex w-[240px] gap-1.5">
            <TextInput value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="Not chosen" />
            <Button onClick={() => pick(setSourcePath, false)}>…</Button>
          </div>
        </FieldRow>
        <FieldRow label="Save .torrent to">
          <div className="flex w-[240px] gap-1.5">
            <TextInput value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="Not chosen" />
            <Button onClick={() => pick(setOutputDir, true)}>…</Button>
          </div>
        </FieldRow>
        <FieldRow label="Name (optional)">
          <TextInput className="w-[240px]" value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <FieldRow label="Tracker URL (optional)">
          <TextInput className="w-[240px]" value={tracker} onChange={(e) => setTracker(e.target.value)} />
        </FieldRow>

        {result && (
          <p className="rounded-lg bg-success-bg px-3 py-2 text-[11.5px] text-success">
            Created: <span className="font-mono">{result}</span>
          </p>
        )}
        {error && <p className="text-[11.5px] text-danger">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={close}>Close</Button>
          <Button primary onClick={create} disabled={busy || !sourcePath.trim() || !outputDir.trim()}>
            {busy ? "Creating…" : "Create torrent"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
