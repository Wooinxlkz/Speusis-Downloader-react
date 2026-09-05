import { useState } from "react";
import { SearchCode } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";
import type { GrabLink } from "@/lib/types";

export function GrabberDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = dialog === "grabber";

  const [pageUrl, setPageUrl] = useState("");
  const [links, setLinks] = useState<GrabLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    if (!pageUrl.trim()) return;
    setScanning(true);
    setError(null);
    try {
      const res = await ipc.grabberScan(pageUrl.trim());
      if (!res.ok) {
        setError(res.error ?? "Scan failed");
        setLinks([]);
      } else {
        setLinks(res.links);
        setSelected(new Set(res.links.map((l) => l.url)));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }

  async function addSelected() {
    const chosen = links.filter((l) => selected.has(l.url));
    if (chosen.length === 0) return;
    await ipc.downloadBatchAdd(chosen.map((l) => ({ url: l.url, start: true })));
    await refresh();
    close();
    setLinks([]);
    setPageUrl("");
  }

  return (
    <Modal open={open} onClose={close} width={620}>
      <DialogHeader icon={<SearchCode size={16} />} title="Web grabber" subtitle="Scan a page for downloadable links" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex gap-2">
          <TextInput
            autoFocus
            placeholder="https://example.com/downloads"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan()}
          />
          <Button primary onClick={scan} disabled={scanning || !pageUrl.trim()}>
            {scanning ? "Scanning…" : "Scan"}
          </Button>
        </div>
        {error && <p className="text-[11.5px] text-danger">{error}</p>}

        {links.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line-soft">
            {links.map((l) => (
              <label
                key={l.url}
                className="flex cursor-pointer items-center gap-2.5 border-b border-line-soft px-3 py-2 last:border-b-0 hover:bg-hover"
              >
                <input type="checkbox" checked={selected.has(l.url)} onChange={() => toggle(l.url)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium">{l.text || l.url}</p>
                  <p className="truncate font-mono text-[10.5px] text-faint">{l.url}</p>
                </div>
                <span className="flex-shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[10px] uppercase text-faint">{l.kind}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[11.5px] text-faint">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button primary onClick={addSelected} disabled={selected.size === 0}>
              Add selected
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
