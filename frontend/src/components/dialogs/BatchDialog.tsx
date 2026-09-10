import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";

// Note: the old vanilla app's "Batch" panel scanned the currently active
// browser tab via the browser extension bridge (no URL input at all) -
// that needs a live extension connection this desktop rebuild doesn't
// have wired, so it's not practically reproducible here. Paste-based
// batch entry is a genuinely useful substitute that doesn't conflict with
// Grabber (which scans a single page you give it), and this dialog now
// carries the same filter + Select All/None interaction the old Batch
// panel had, just applied to the pasted list instead of a scanned one.
export function BatchDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const refresh = useDownloadsStore((s) => s.refresh);
  const open = dialog === "batch";

  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawUrls = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  function parseList() {
    setParsed(rawUrls);
    setSelected(new Set(rawUrls));
    setFilter("");
  }

  const filtered = useMemo(() => {
    if (!parsed) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return parsed;
    return parsed.filter((u) => u.toLowerCase().includes(q));
  }, [parsed, filter]);

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(filtered));
  }
  function selectNone() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((u) => next.delete(u));
      return next;
    });
  }

  async function submit() {
    const urls = parsed ? [...selected] : rawUrls;
    if (urls.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.downloadBatchAdd(urls.map((url) => ({ url, start: true })));
      await refresh();
      setText("");
      setParsed(null);
      setSelected(new Set());
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const count = parsed ? selected.size : rawUrls.length;

  return (
    <Modal open={open} onClose={close} width={parsed ? 600 : 560}>
      <DialogHeader icon={<ClipboardList size={16} />} title="Batch download" subtitle="One URL per line" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        {!parsed ? (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"https://example.com/file1.zip\nhttps://example.com/file2.zip\n…"}
              rows={9}
              className="w-full resize-none rounded-lg border border-line bg-panel p-2.5 font-mono text-[12px] text-ink focus:border-faint focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-faint">
                {rawUrls.length} link{rawUrls.length === 1 ? "" : "s"} detected
              </span>
              {rawUrls.length > 0 && (
                <button onClick={parseList} className="text-[11.5px] font-medium text-accent-ink hover:underline">
                  Review & filter list →
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <TextInput
                placeholder="Filter by extension or name (e.g. .mp4)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1"
              />
              <Button onClick={selectAll}>Select All</Button>
              <Button onClick={selectNone}>None</Button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line-soft">
              {filtered.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-faint">No links match that filter.</p>}
              {filtered.map((url) => (
                <label
                  key={url}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-line-soft px-3 py-2 last:border-b-0 hover:bg-hover"
                >
                  <input type="checkbox" checked={selected.has(url)} onChange={() => toggle(url)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{url}</span>
                </label>
              ))}
            </div>
            <button onClick={() => setParsed(null)} className="self-start text-[11.5px] text-faint hover:text-ink">
              ← Back to editing
            </button>
          </>
        )}

        {error && <p className="text-[11.5px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button primary onClick={submit} disabled={busy || count === 0}>
            {busy ? "Adding…" : `Add ${count || ""} download${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
