import { HelpCircle, Globe, Puzzle } from "lucide-react";
import { Modal, DialogHeader, Button } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { ipc } from "@/lib/ipc";

export function HelpDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "help";

  return (
    <Modal open={open} onClose={close} width={420}>
      <DialogHeader icon={<HelpCircle size={16} />} title="Help & support" onClose={close} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[12.5px] text-muted">
          Get the browser extension so links download straight into Speusis, or check for a newer version.
        </p>
        <div className="flex gap-2">
          <Button className="flex flex-1 items-center justify-center gap-2" onClick={() => ipc.extensionOpenStore("chromium")}>
            <Globe size={14} /> Chromium
          </Button>
          <Button className="flex flex-1 items-center justify-center gap-2" onClick={() => ipc.extensionOpenStore("firefox")}>
            <Puzzle size={14} /> Firefox
          </Button>
        </div>
        <div className="mt-1 flex justify-end">
          <Button primary onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
