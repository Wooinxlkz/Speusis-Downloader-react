import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ShoppingBasket, X, Plus, Check, CircleAlert } from "lucide-react";
import { ipc } from "@/lib/ipc";
import "./styles.css";

interface RecentEntry {
  id: string;
  text: string;
  ok: boolean;
}

function isLikelyUrl(text: string): boolean {
  return /^(https?:\/\/|magnet:\?|ftp:\/\/)/i.test(text.trim());
}

function BasketApp() {
  // Matches the old vanilla basket's real behavior: a drop/paste adds the
  // download immediately (no staging-then-selecting step) and the window
  // shows a short rolling log of what just happened - not a persistent
  // checklist. Clicking the drop zone opens an inline "add URL manually"
  // form, same as the old one did.
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formValue, setFormValue] = useState("");
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const un = listen<{ type: string; data?: { url: string } }>("event-bus", (evt) => {
      if (evt.payload.type === "BasketUrlDropped" && evt.payload.data?.url) {
        addUrl(evt.payload.data.url);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

  async function addUrl(raw: string) {
    const url = raw.trim();
    if (!url) return;
    if (!isLikelyUrl(url)) {
      setStatus("Failed");
      pushRecent(url, false);
      setTimeout(() => setStatus(null), 1500);
      return;
    }
    setStatus("Adding…");
    try {
      await ipc.downloadAdd({ url, start: true });
      setStatus("Added!");
      pushRecent(url, true);
    } catch {
      setStatus("Failed");
      pushRecent(url, false);
    } finally {
      setTimeout(() => setStatus(null), 1500);
    }
  }

  function pushRecent(text: string, ok: boolean) {
    setRecent((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, ok }, ...prev].slice(0, 5));
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
    <div className="flex h-screen w-screen flex-col bg-bg text-ink motion-modal-in">
      <div data-tauri-drag-region className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-line-soft bg-panel px-3">
        <ShoppingBasket size={14} className="text-accent-ink" />
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Basket</span>
        {status && <span className="ml-2 text-[10.5px] text-faint">{status}</span>}
        <button
          onClick={() => ipc.basketClose().then(() => getCurrentWindow().hide())}
          className="ml-auto flex h-[22px] w-[22px] items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-2.5">
        {!formOpen ? (
          <div
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => setFormOpen(true)}
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed text-center transition-colors ${
              dragActive ? "border-accent-ink bg-hover" : "border-line hover:border-faint"
            }`}
          >
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-panel text-faint">
              <Plus size={16} />
            </div>
            <p className="max-w-[200px] text-[11px] text-faint">
              Drop a link here, paste one anywhere, or click to add a URL by hand
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2 rounded-xl border border-line-soft bg-panel p-3">
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
            <div className="mt-auto flex gap-1.5">
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
          <div className="flex flex-col gap-0.5">
            <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Recent</p>
            {recent.map((r) => (
              <div key={r.id} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10.5px]">
                {r.ok ? (
                  <Check size={11} className="flex-shrink-0 text-success" />
                ) : (
                  <CircleAlert size={11} className="flex-shrink-0 text-danger" />
                )}
                <span className={`truncate font-mono ${r.ok ? "text-muted" : "text-danger"}`}>{r.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BasketApp />
  </React.StrictMode>,
);
