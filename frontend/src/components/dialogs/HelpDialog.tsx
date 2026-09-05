import { useEffect, useState } from "react";
import { HelpCircle, Globe, Puzzle } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

export function HelpDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "help";
  const [version, setVersion] = useState("…");
  const [licensed, setLicensed] = useState(false);

  useEffect(() => {
    if (!open) return;
    ipc.appGetVersion().then(setVersion).catch(() => setVersion("unknown"));
    ipc.licenseGetStatus().then((r) => setLicensed(!!r)).catch(() => setLicensed(false));
  }, [open]);

  return (
    <Modal open={open} onClose={close} width={420}>
      <DialogHeader icon={<HelpCircle size={16} />} title="Help & Support" onClose={close} />
      <div className="flex flex-col px-5 py-4">
        <Row label="Website">
          <a href="https://speusis.app" target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
            speusis.app
          </a>
        </Row>
        <Row label="Support Email">
          <a href="mailto:karimsc01t@gmail.com" className="text-accent-ink hover:underline">
            karimsc01t@gmail.com
          </a>
        </Row>
        <Row label="Developer">Nulltrace</Row>
        <Row label="License Type">{licensed ? "Registered" : "Unregistered"}</Row>
        <Row label="Version" mono>{version}</Row>

        <p className="mt-3.5 text-[11.5px] leading-relaxed text-faint">
          For bugs, feature requests, or license issues, reach out by email above. Response time is
          typically 1-2 business days.
        </p>

        <p className="mb-2 mt-4 text-[11.5px] font-medium text-muted">Browser extension</p>
        <div className="flex gap-2">
          <Button className="flex flex-1 items-center justify-center gap-2" onClick={() => ipc.extensionOpenStore("chromium")}>
            <Globe size={14} /> Chromium
          </Button>
          <Button className="flex flex-1 items-center justify-center gap-2" onClick={() => ipc.extensionOpenStore("firefox")}>
            <Puzzle size={14} /> Firefox
          </Button>
        </div>

        <div className="mt-4 flex justify-end">
          <Button primary onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line-soft py-2 text-[12.5px] last:border-b-0">
      <span className="text-faint">{label}</span>
      <span className={mono ? "font-mono" : ""}>{children}</span>
    </div>
  );
}
