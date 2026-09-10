import { useEffect, useState } from "react";
import { Rss, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button, Switch } from "./Modal";
import { MorphMenu } from "@/components/ui/MorphMenu";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";
import type { RssFeed } from "@/lib/types";

// Matches the old app's real interval options exactly (value in seconds).
const INTERVALS = [
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "30 min", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
];

export function RssDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "rss";

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [interval, setInterval_] = useState(1800);
  const [autoDownload, setAutoDownload] = useState(true);
  const [intervalOpen, setIntervalOpen] = useState(false);
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
        filter: filter.trim() || null,
        targetDir: null,
        autoDownload,
        fetchInterval: interval,
      });
      setUrl("");
      setName("");
      setFilter("");
      setInterval_(1800);
      setAutoDownload(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const currentInterval = INTERVALS.find((i) => i.value === interval) ?? INTERVALS[2];

  return (
    <Modal open={open} onClose={close} width={580}>
      <DialogHeader icon={<Rss size={16} />} title="RSS feeds" subtitle="Auto-fetch new links from feeds" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex gap-2">
          <TextInput placeholder="Feed URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <TextInput placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="w-[140px]" />
        </div>
        <div className="flex items-center gap-2">
          <TextInput
            placeholder="Optional regex filter (e.g. \.mkv$)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 font-mono"
          />
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setIntervalOpen((o) => !o)}
              className="flex h-[30px] items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[12px] text-ink transition-colors hover:border-faint"
            >
              {currentInterval.label}
              <ChevronDown size={12} className={`text-faint transition-transform ${intervalOpen ? "rotate-180" : ""}`} />
            </button>
            <MorphMenu open={intervalOpen} onClose={() => setIntervalOpen(false)} align="end" width={130} anchorClassName="top-[calc(100%+4px)]">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  onClick={() => {
                    setInterval_(i.value);
                    setIntervalOpen(false);
                  }}
                  className={`flex h-7 w-full items-center rounded-lg px-2.5 text-left text-[12px] transition-colors ${
                    i.value === interval ? "bg-hover font-medium text-ink" : "text-ink hover:bg-hover"
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </MorphMenu>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <Switch on={autoDownload} onToggle={() => setAutoDownload((v) => !v)} />
            Auto-download matches
          </label>
          <Button primary onClick={add} disabled={busy || !url.trim()}>
            Add feed
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
