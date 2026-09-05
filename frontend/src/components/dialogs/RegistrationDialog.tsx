import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Modal, DialogHeader, TextInput, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";
import type { LicenseRecord } from "@/lib/types";

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
      <DialogHeader icon={<Star size={16} />} title="Registration" subtitle="Activate your Speusis license" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        {status ? (
          <div className="rounded-lg bg-success-bg px-3 py-3 text-[12.5px] text-success">
            Registered to <span className="font-semibold">{status.name}</span> — {status.plan} plan.
          </div>
        ) : (
          <>
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
