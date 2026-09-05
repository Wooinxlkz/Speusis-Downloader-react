import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";
import type { LicenseRecord } from "@/lib/types";

// Real sample keys from the original app, used to demo activation without
// a real purchase.
const SAMPLE_LICENSES = {
  lifetime: { name: "Speusis Sample User", email: "sample@speusis.local", key: "SPEUSIS-LIFE-E0D6-551E4FD0" },
  monthly: { name: "Speusis Sample User", email: "sample@speusis.local", key: "SPEUSIS-MTH-2442-100E322A" },
};

export function RegistrationDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "registration";

  const [status, setStatus] = useState<LicenseRecord | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) ipc.licenseGetStatus().then(setStatus).catch(() => setStatus(null));
  }, [open]);

  function fillSample(plan: keyof typeof SAMPLE_LICENSES) {
    const s = SAMPLE_LICENSES[plan];
    setName(s.name);
    setEmail(s.email);
    setKey(s.key);
  }

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const rec = await ipc.licenseActivate(name.trim(), email.trim(), key.trim());
      setStatus(rec);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} width={440}>
      <DialogHeader icon={<Star size={16} />} title="Registration" subtitle="Enter your license details to activate" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        {status ? (
          <div className="rounded-lg bg-success-bg px-3 py-3 text-[12.5px] text-success">
            Registered to <span className="font-semibold">{status.name}</span> — {status.plan} plan.
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-line-soft bg-panel px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              <p className="mb-1 font-semibold text-ink">Sample licenses</p>
              <p>
                Full Name: <span className="font-semibold text-ink">Speusis Sample User</span>
              </p>
              <p>
                Email: <span className="font-semibold text-ink">sample@speusis.local</span>
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => fillSample("lifetime")}
                  className="rounded-md border border-line bg-bg px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-hover"
                >
                  Use Lifetime
                </button>
                <button
                  onClick={() => fillSample("monthly")}
                  className="rounded-md border border-line bg-bg px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-hover"
                >
                  Use Monthly
                </button>
              </div>
            </div>

            <TextInput placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextInput placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextInput placeholder="License key" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" />
            {error && <p className="text-[11.5px] text-danger">{error}</p>}
          </>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={close}>Close</Button>
          {!status && (
            <Button primary onClick={activate} disabled={busy || !name.trim() || !email.trim() || !key.trim()}>
              {busy ? "Activating…" : "Activate"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
