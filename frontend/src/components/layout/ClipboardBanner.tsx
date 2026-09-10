import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ClipboardCheck, X } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { useDownloadsStore } from "@/stores/downloads";

/**
 * The real feature the old vanilla app's clipboard watcher actually
 * drives - a small banner in the main window offering to add whatever
 * URL-looking thing you just copied. Not related to the Basket at all
 * (that's drag-drop only) - a past version of this rebuild mistakenly
 * tried to route this event into the basket window, which never worked
 * because it was also listening for the wrong event name.
 *
 * Backend emits a plain "clipboard-url-detected" event (see
 * start_clipboard_monitor in main.rs) with the raw URL string as payload,
 * independent of the app-wide "event-bus" channel everything else here
 * uses - the old renderer's downloadManagerBridge.js confirms this is a
 * separate, simpler mechanism, not an AppEvent variant.
 */
export function ClipboardBanner() {
  const [url, setUrl] = useState<string | null>(null);
  const refresh = useDownloadsStore((s) => s.refresh);

  useEffect(() => {
    const un = listen<string>("clipboard-url-detected", (evt) => {
      if (evt.payload) setUrl(evt.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  if (!url) return null;

  async function addIt() {
    if (!url) return;
    const target = url;
    setUrl(null);
    await ipc.downloadAdd({ url: target, start: true }).catch(() => {});
    refresh();
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-line-soft bg-info-bg px-4 py-2 clipboard-banner-in">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-info">
        <ClipboardCheck size={15} className="flex-shrink-0" />
        <span className="flex-shrink-0 text-[11px] font-bold uppercase tracking-wide">Clipboard link detected</span>
        <span className="truncate font-mono text-[11.5px] text-muted">{url}</span>
      </div>
      <button
        onClick={addIt}
        className="flex-shrink-0 rounded-lg border border-info bg-info px-3 py-1 text-[11.5px] font-semibold text-bg transition-[filter] hover:brightness-110"
      >
        Add download
      </button>
      <button
        onClick={() => setUrl(null)}
        className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-line-soft px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-faint hover:text-ink"
      >
        <X size={12} /> Ignore
      </button>
    </div>
  );
}
