import { useEffect, useState } from "react";
import { ShieldCheck, Mail, Copy } from "lucide-react";
import { Button } from "./Modal";
import { ipc } from "@/lib/ipc";

const REPO_URL = "https://github.com/Wooinxlkz/Speusis-Downloader-react";
const DEVELOPER_URL = "https://github.com/Wooinxlkz";
const SHARE_TEXT = "Speusis Downloader — a fast, native download manager for HTTP, BitTorrent, and FTP.";

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

async function openUrl(url: string) {
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}

async function copyLink(onCopied: () => void) {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(REPO_URL);
  onCopied();
}

// Same real share-intent logic as Xuro's AboutSettings.tsx (openUrl calls,
// intent URL shapes, and the Instagram copy-link fallback since Instagram
// has no web share-intent for arbitrary links) - just pointed at Speusis's
// own repo and copy instead of Xuro's.
async function share(kind: "x" | "facebook" | "email" | "instagram", onCopied: () => void) {
  if (kind === "x") {
    await openUrl(`https://twitter.com/intent/tweet?url=${encodeURIComponent(REPO_URL)}&text=${encodeURIComponent(SHARE_TEXT)}`);
    return;
  }
  if (kind === "facebook") {
    await openUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(REPO_URL)}`);
    return;
  }
  if (kind === "email") {
    await openUrl(`mailto:?subject=${encodeURIComponent("Check out Speusis Downloader")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${REPO_URL}`)}`);
    return;
  }
  await copyLink(onCopied);
}

/**
 * Shared body used by both the standalone About dialog (toolbar -> About)
 * and the Settings -> About tab, so the two never drift into showing
 * different content again.
 */
export function AboutContent() {
  const [version, setVersion] = useState("…");
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);

  useEffect(() => {
    ipc.appGetVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

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

  function flashCopied(msg: string) {
    setCopiedMsg(msg);
    setTimeout(() => setCopiedMsg(null), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
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

      <div>
        <p className="mb-2 text-[12.5px] font-semibold">Made by</p>
        <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
          <div className="min-w-0 flex-1 text-[12.5px] text-muted">
            Developed by{" "}
            <button
              onClick={() => openUrl(DEVELOPER_URL)}
              className="font-medium text-ink underline decoration-line-soft underline-offset-2 hover:decoration-ink"
            >
              Nulltrace
            </button>
          </div>
          <Button onClick={() => openUrl(REPO_URL)} className="flex flex-shrink-0 items-center gap-1.5">
            <ShieldCheck size={13} /> View source
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12.5px] font-semibold">Recommend Speusis</p>
        <div className="flex flex-col gap-3 rounded-xl border border-line-soft bg-panel p-4">
          <div className="flex items-center gap-3 rounded-lg bg-gradient-to-br from-panel to-bg p-3">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-bg text-[13px] font-black text-accent-ink">
              S
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-ink">github.com/Wooinxlkz</p>
              <p className="mt-0.5 truncate text-[11px] text-faint">{SHARE_TEXT}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <ShareButton label="X" onClick={() => share("x", () => {})}>
              <XLogo />
            </ShareButton>
            <ShareButton label="Facebook" onClick={() => share("facebook", () => {})}>
              <FacebookLogo />
            </ShareButton>
            <ShareButton label="Email" onClick={() => share("email", () => {})}>
              <Mail size={15} strokeWidth={1.8} />
            </ShareButton>
            <ShareButton
              label="Instagram"
              onClick={() => share("instagram", () => flashCopied("Link copied — paste it into a bio or story."))}
            >
              <InstagramLogo />
            </ShareButton>
          </div>
          <button
            onClick={() => copyLink(() => flashCopied("Link copied."))}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-bg py-2 text-[11.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <Copy size={12.5} strokeWidth={1.8} />
            Copy download link
          </button>
          {copiedMsg && <p className="text-center text-[11px] text-faint">{copiedMsg}</p>}
        </div>
      </div>

      {updateMsg && <p className="-mt-1 text-[11.5px] text-faint">{updateMsg}</p>}

      <Button className="justify-center" onClick={checkForUpdates} disabled={checking}>
        {checking ? "Checking…" : "Check for Updates"}
      </Button>
    </div>
  );
}

function ShareButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={`Share on ${label}`}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-bg py-2.5 text-faint transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function XLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.9 2H22l-7.6 8.7L23 22h-6.9l-5.4-6.6L4.5 22H1.4l8.1-9.3L1 2h7l4.9 6.1L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z" />
    </svg>
  );
}
function FacebookLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </svg>
  );
}
function InstagramLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
