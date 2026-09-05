import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

export function AboutDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "about";
  const [version, setVersion] = useState("…");

  useEffect(() => {
    if (open) ipc.appGetVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, [open]);

  return (
    <Modal open={open} onClose={close} width={400}>
      <DialogHeader icon={<Info size={16} />} title="About Speusis" onClose={close} />
      <div className="flex flex-col items-center gap-2 px-5 py-6 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-panel text-lg font-bold">S</div>
        <p className="text-[14px] font-semibold">Speusis Downloader</p>
        <p className="font-mono text-[12px] text-faint">Version {version}</p>
        <p className="mt-2 max-w-[280px] text-[12px] text-muted">
          Native desktop download manager — HTTP, FTP, and BitTorrent in one app.
        </p>
        <Button primary onClick={close} className="mt-3">
          Close
        </Button>
      </div>
    </Modal>
  );
}
