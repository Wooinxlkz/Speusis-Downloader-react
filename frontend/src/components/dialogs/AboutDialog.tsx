import { Info } from "lucide-react";
import { Modal, DialogHeader } from "./Modal";
import { useUIStore } from "@/stores/ui";
import { AboutContent } from "./AboutContent";

export function AboutDialog() {
  const dialog = useUIStore((s) => s.dialog);
  const close = useUIStore((s) => s.close);
  const open = dialog === "about";

  return (
    <Modal open={open} onClose={close} width={420}>
      <DialogHeader icon={<Info size={16} />} title="About Speusis" onClose={close} />
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <AboutContent />
      </div>
    </Modal>
  );
}
