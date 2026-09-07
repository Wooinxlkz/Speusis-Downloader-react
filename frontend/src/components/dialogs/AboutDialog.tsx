import { useEffect, useState } from "react";
import { Info, ShieldCheck } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

const REPO_URL = "https://github.com/Wooinxlkz/Speusis-Downloader-react";

const FEATURES = [
  "Multi-segment HTTP · BitTorrent + DHT/PEX · FTP/FTPS",
  "Per-file Priority · Sequential Torrent · Seeding Ratio",
  "IP Blocklist · Web Grabber · Download Basket",
  "Auto-start · System Tray · File-type Routing",
  "RSS Auto-Download · Scheduler · Speed Graph",
  "Batch Download · Create .torrent · Site Logins",
];

function platformName() {
  if (navigator.platform.includes("Win")) return "Windows";
  if (navigator.platform.includes("Mac")) return "macOS";
  return "Linux";
}

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

  async function openRepo() {
    const { open: openUrl } = await import("@tauri-apps/plugin-shell");
    await openUrl(REPO_URL);
  }

  return (
    <Modal open={open} onClose={close} width={420}>
      <DialogHeader icon={<Info size={16} />} title="About Speusis" onClose={close} />
      <div className="flex flex-col gap-4 px-5 py-4">
        {/* Xuro-style top card: logo + version header, feature list as a
            divided list rather than a paragraph block. */}
        <div className="overflow-hidden rounded-xl border border-line-soft bg-panel">
          <div className="flex items-center gap-3 border-b border-line-soft p-4">
            <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-bg text-[15px] font-black text-accent-ink">
              S
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-ink">Speusis Downloader</p>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                Version {version} — {platformName()}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-line-soft">
            {FEATURES.map((feature) => (
              <li key={feature} className="px-4 py-2.5 text-[12px] leading-5 text-muted">
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Xuro-style "Made by" card. */}
        <div>
          <p className="mb-2 text-[12.5px] font-semibold">Made by</p>
          <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
            <div className="min-w-0 flex-1 text-[12.5px] text-muted">
              Developed by <span className="font-medium text-ink">Nulltrace</span>
            </div>
            <Button onClick={openRepo} className="flex flex-shrink-0 items-center gap-1.5">
              <ShieldCheck size={13} /> View source
            </Button>
          </div>
        </div>

        {updateMsg && <p className="-mt-1 text-[11.5px] text-faint">{updateMsg}</p>}

        <div className="flex gap-2">
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
