import React, { useEffect, useState } from "react";
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

function BasketApp() {
  const [entries, setEntries] = useState<BasketEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const un = listen<{ type: string; data?: { url: string } }>("event-bus", (evt) => {
      if (evt.payload.type === "BasketUrlDropped" && evt.payload.data?.url) {
        setEntries((prev) => [{ url: evt.payload.data!.url, addedAt: Date.now() }, ...prev]);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

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

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-ink">
      <div data-tauri-drag-region className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <ShoppingBasket size={14} className="text-muted" />
        <span className="text-[12px] font-medium text-muted">Basket</span>
        <button
          onClick={() => ipc.basketClose().then(() => getCurrentWindow().hide())}
          className="ml-auto rounded-md p-1 text-faint hover:bg-hover hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-faint">
            <ShoppingBasket size={28} className="opacity-40" />
            <p className="text-[12px]">Links you drop here will show up as you copy them.</p>
          </div>
        ) : (
          entries.map((e) => (
            <label
              key={e.url + e.addedAt}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] hover:bg-hover"
            >
              <input type="checkbox" checked={selected.has(e.url)} onChange={() => toggle(e.url)} />
              <span className="truncate font-mono">{e.url}</span>
            </label>
          ))
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-line-soft p-2">
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
