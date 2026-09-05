import { useEffect, useState } from "react";
import { Rss, Trash2, RefreshCw } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button, Switch } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";
import type { RssFeed } from "@/lib/types";

export function RssDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "rss";

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setFeeds(await ipc.rssList());
  }
  useEffect(() => {
    if (open) load();
  }, [open]);

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await ipc.rssAdd({
        id: crypto.randomUUID(),
        url: url.trim(),
        name: name.trim() || url.trim(),
        enabled: true,
        lastFetched: null,
        filter: null,
        targetDir: null,
        autoDownload: false,
        fetchInterval: 30,
      });
      setUrl("");
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={560}>
      <DialogHeader icon={<Rss size={16} />} title="RSS feeds" subtitle="Auto-fetch new links from feeds" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex gap-2">
          <TextInput placeholder="Feed URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <TextInput placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="w-[140px]" />
          <Button primary onClick={add} disabled={busy || !url.trim()}>
            Add
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-line-soft">
          {feeds.length === 0 && <p className="px-3 py-4 text-center text-[12.5px] text-faint">No feeds yet.</p>}
          {feeds.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 border-b border-line-soft px-3 py-2 last:border-b-0">
              <Switch on={f.enabled} onToggle={() => ipc.rssUpdate(f.id, { enabled: !f.enabled }).then(load)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{f.name}</p>
                <p className="truncate font-mono text-[10.5px] text-faint">{f.url}</p>
              </div>
              <button
                onClick={() => ipc.rssFetchNow(f.id).then(load)}
                className="rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-ink"
                title="Fetch now"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => ipc.rssRemove(f.id).then(load)}
                className="rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-danger"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
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
