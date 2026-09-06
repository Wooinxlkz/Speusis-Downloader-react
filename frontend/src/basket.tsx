import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ShoppingBasket, X, Trash2, Download } from "lucide-react";
import { ipc } from "@/lib/ipc";
import "./styles.css";

interface BasketEntry {
  url: string;
  addedAt: number;
}

function isLikelyUrl(text: string): boolean {
  return /^(https?:\/\/|magnet:\?|ftp:\/\/)/i.test(text.trim());
}

function BasketApp() {
  const [entries, setEntries] = useState<BasketEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    const un = listen<{ type: string; data?: { url: string } }>("event-bus", (evt) => {
      if (evt.payload.type === "BasketUrlDropped" && evt.payload.data?.url) {
        addEntry(evt.payload.data.url);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  function addEntry(url: string) {
    setEntries((prev) => (prev.some((e) => e.url === url) ? prev : [{ url, addedAt: Date.now() }, ...prev]));
    setSelected((prev) => new Set(prev).add(url));
  }

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }

  async function addSelected() {
    const urls = entries.filter((e) => selected.has(e.url));
    if (urls.length === 0) return;
    await ipc.downloadBatchAdd(urls.map((e) => ({ url: e.url, start: true })));
    setEntries((prev) => prev.filter((e) => !selected.has(e.url)));
    setSelected(new Set());
  }

  function clearAll() {
    setEntries([]);
    setSelected(new Set());
  }

  // Real HTML5 drag-and-drop: accepts dropped links (dragged from a
  // browser address bar, a link, or a text selection) in addition to the
  // clipboard-detected BasketUrlDropped events above.
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
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plain = e.dataTransfer.getData("text/plain");
    const candidates = (uriList || plain || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(isLikelyUrl);
    candidates.forEach(addEntry);
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-ink motion-modal-in">
      <div data-tauri-drag-region className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-line-soft bg-panel px-3">
        <ShoppingBasket size={14} className="text-accent-ink" />
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Basket</span>
        {entries.length > 0 && (
          <span className="rounded-full bg-sunken px-1.5 text-[10px] text-faint">{entries.length}</span>
        )}
        <button
          onClick={() => ipc.basketClose().then(() => getCurrentWindow().hide())}
          className="ml-auto flex h-[22px] w-[22px] items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>

      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`m-2.5 flex flex-1 flex-col overflow-hidden rounded-xl border-[1.5px] border-dashed transition-colors ${
          dragActive ? "border-accent-ink bg-hover" : "border-line"
        }`}
      >
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {entries.map((e) => (
            <label
              key={e.url}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:bg-hover"
            >
              <input
                type="checkbox"
                checked={selected.has(e.url)}
                onChange={() => toggle(e.url)}
                className="accent-[var(--accent-ink)]"
              />
              <span className="truncate font-mono">{e.url}</span>
            </label>
          ))}
        </div>

        <div className="mt-auto px-4 py-4 text-center text-[11px] text-faint">
          {entries.length === 0 ? (
            <>
              <ShoppingBasket size={22} className="mx-auto mb-2 opacity-30" />
              Drop links here, or copy a URL to add it automatically
            </>
          ) : (
            "Drop more links here"
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 gap-1.5 border-t border-line-soft p-2">
        <button
          onClick={clearAll}
          disabled={entries.length === 0}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[11.5px] text-muted transition-colors hover:bg-hover disabled:opacity-40"
        >
          <Trash2 size={12} /> Clear
        </button>
        <button
          onClick={addSelected}
          disabled={selected.size === 0}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border border-invert bg-invert text-[11.5px] font-medium text-invert-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Download size={12} /> Add ({selected.size})
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BasketApp />
  </React.StrictMode>,
);
