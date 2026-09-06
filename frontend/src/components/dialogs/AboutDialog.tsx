import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

const FEATURES = [
  "Multi-segment HTTP · BitTorrent + DHT/PEX · FTP/FTPS",
  "Per-file Priority · Sequential Torrent · Seeding Ratio",
  "IP Blocklist · Web Grabber · Download Basket",
  "Auto-start · System Tray · File-type Routing",
  "RSS Auto-Download · Scheduler · Speed Graph",
  "Batch Download · Create .torrent · Site Logins",
];

export function AboutDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "about";
  const [version, setVersion] = useState("…");
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) ipc.appGetVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, [open]);

  async function checkForUpdates() {
    setChecking(true);
    setUpdateMsg(null);
    try {
      const res = await ipc.updateCheck();
      setUpdateMsg(res.info ? `Update available: v${res.info.version}` : res.error ?? "You're up to date.");
    } catch (e) {
      setUpdateMsg(String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={400}>
      <DialogHeader icon={<Info size={16} />} title="About Speusis" onClose={close} />
      <div className="flex flex-col items-center gap-1 px-5 py-6 text-center">
        <p className="text-[22px] font-black text-accent-ink">Speusis Downloader</p>
        <p className="text-[13px] font-semibold">
          Version {version} — {navigator.platform.includes("Win") ? "Windows" : navigator.platform.includes("Mac") ? "macOS" : "Linux"}
        </p>
        <p className="text-[12px] text-muted">Multi-segment, resumable download manager.</p>
        <p className="mt-1 text-[11.5px] font-semibold tracking-wide text-accent-ink">DEVELOPED BY NULLTRACE</p>

        <div className="mt-3 w-full rounded-xl bg-panel px-3.5 py-3 text-left text-[11px] leading-[1.9] text-muted">
          {FEATURES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {updateMsg && <p className="mt-2 text-[11.5px] text-faint">{updateMsg}</p>}

        <div className="mt-3 flex w-full gap-2">
          <Button className="flex-1 justify-center" onClick={checkForUpdates} disabled={checking}>
            {checking ? "Checking…" : "Check for Updates"}
          </Button>
          <Button primary className="flex-1 justify-center" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
