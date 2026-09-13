import React, { useEffect, useRef, useState } from "react";
import { ShoppingBasket, Plus, Check, CircleAlert, RotateCw, Trash2 } from "lucide-react";
import { Modal, DialogHeader } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { useDownloadsStore } from "@/stores/downloads";
import { ipc } from "@/lib/ipc";

interface RecentEntry {
  id: string;
  url: string;
  ok: boolean;
  at: number;
}

function isLikelyUrl(text: string): boolean {
  return /^(https?:\/\/|magnet:\?|ftp:\/\/)/i.test(text.trim());
}

function extBadge(url: string): { label: string; color: string } {
  if (/^magnet:/i.test(url)) return { label: "TOR", color: "#7a5cc9" };
  const clean = url.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  const ext = dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
  const colors: Record<string, string> = {
    zip: "#3457b2", rar: "#3457b2", "7z": "#3457b2",
    mp4: "#b23a2e", mkv: "#b23a2e", avi: "#b23a2e", webm: "#b23a2e",
    mp3: "#2f7d4f", flac: "#2f7d4f", wav: "#2f7d4f",
    exe: "#2f7d4f", msi: "#2f7d4f", dmg: "#2f7d4f",
    pdf: "#b23a2e", doc: "#3457b2", docx: "#3457b2",
  };
  return { label: ext ? ext.slice(0, 3).toUpperCase() : "URL", color: colors[ext] ?? "#6e6e6a" };
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

/**
 * In-page dialog now (matches Settings/every other dialog's chrome and
 * motion) instead of a separate floating OS window. Handles real HTML5
 * drag-drop, same as before - dropping a link onto this window works the
 * same whether it arrived from a browser tab or a file manager, since
 * both are just drag events landing on the page.
 *
 * The old version listened for an event named "BasketUrlDropped" that
 * the real backend never actually emits (defined in the Rust AppEvent
 * enum, never constructed anywhere) - so clipboard-based capture never
 * worked in any prior build. That's a separate feature anyway: the real
 * backend's clipboard watcher drives a banner in the main window, not
 * the basket (see ClipboardBanner.tsx) - basket itself is drag-drop only,
 * matching the old app's actual split between the two features.
 */
export function BasketDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "basket";
  const refresh = useDownloadsStore((s) => s.refresh);

  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formValue, setFormValue] = useState("");
  const [, forceTick] = useState(0);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => forceTick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

  async function addUrl(raw: string) {
    const url = raw.trim();
    if (!url) return;
    if (!isLikelyUrl(url)) {
      setStatus("Not a link");
      pushRecent(url, false);
      setTimeout(() => setStatus(null), 1500);
      return;
    }
    setStatus("Adding…");
    try {
      await ipc.downloadAdd({ url, start: true });
      setStatus("Added!");
      pushRecent(url, true);
      refresh();
    } catch {
      setStatus("Failed");
      pushRecent(url, false);
    } finally {
      setTimeout(() => setStatus(null), 1500);
    }
  }

  function pushRecent(url: string, ok: boolean) {
    setRecent((prev) => [{ id: `${Date.now()}-${Math.random()}`, url, ok, at: Date.now() }, ...prev].slice(0, 12));
  }

  function retry(entry: RecentEntry) {
    setRecent((prev) => prev.filter((r) => r.id !== entry.id));
    addUrl(entry.url);
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setDragActive(true);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) setDragActive(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
    addUrl(url);
  }

  function submitForm() {
    const url = formValue.trim();
    if (!url) return;
    setFormOpen(false);
    setFormValue("");
    addUrl(url);
  }

  return (
    <Modal open={open} onClose={close} width={360}>
      <DialogHeader
        icon={<ShoppingBasket size={16} />}
        title="Basket"
        subtitle={status ?? (recent.length > 0 ? `${recent.length} recent` : "Drop links to add them")}
        onClose={close}
      />
      {/* max-h, not h: hugs actual content (just the drop zone when the
          basket is empty) and only grows - capped at 420px, with the
          Recent list scrolling internally past that - as entries pile up. */}
      <div className="flex max-h-[420px] flex-col gap-2.5 p-3">
        {!formOpen ? (
          <div
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => setFormOpen(true)}
            className={`flex flex-shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed py-7 text-center transition-colors ${
              dragActive ? "border-accent-ink bg-hover" : "border-line hover:border-faint"
            }`}
          >
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-panel text-faint">
              <Plus size={16} />
            </div>
            <p className="max-w-[220px] text-[11px] text-faint">
              Drop a link here, paste one anywhere, or click to add a URL by hand
            </p>
          </div>
        ) : (
          <div className="flex flex-shrink-0 flex-col gap-2 rounded-xl border border-line-soft bg-panel p-3">
            <p className="text-[11px] font-medium text-muted">Add a URL</p>
            <input
              ref={inputRef}
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitForm();
                if (e.key === "Escape") {
                  setFormOpen(false);
                  setFormValue("");
                }
              }}
              placeholder="https://… or magnet:?xt=urn:btih:…"
              className="rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-[11px] text-ink focus:border-faint focus:outline-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setFormOpen(false);
                  setFormValue("");
                }}
                className="flex-1 rounded-lg border border-line py-1.5 text-[11px] text-muted transition-colors hover:bg-hover"
              >
                Cancel
              </button>
              <button
                onClick={submitForm}
                disabled={!formValue.trim()}
                className="flex-1 rounded-lg border border-invert bg-invert py-1.5 text-[11px] font-medium text-invert-ink transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Recent</p>
              <button
                onClick={() => setRecent([])}
                className="flex items-center gap-1 text-[10px] text-faint transition-colors hover:text-ink"
              >
                <Trash2 size={10} /> Clear
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
              {recent.map((r) => {
                const badge = extBadge(r.url);
                return (
                  <div key={r.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-hover">
                    <div
                      className="grid h-5 w-5 flex-shrink-0 place-items-center rounded font-mono text-[7px] font-bold text-invert-ink"
                      style={{ background: badge.color }}
                    >
                      {badge.label}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[10.5px] text-ink">{r.url}</p>
                      <p className="text-[9.5px] text-faint">{timeAgo(r.at)}</p>
                    </div>
                    {r.ok ? (
                      <Check size={12} className="flex-shrink-0 text-success" />
                    ) : (
                      <button
                        onClick={() => retry(r)}
                        title="Retry"
                        className="flex flex-shrink-0 items-center gap-1 text-danger opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                      >
                        <CircleAlert size={12} />
                        <RotateCw size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
