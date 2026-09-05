import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}

/** Backdrop blur + scale(.96)->1 entrance. Same easing/duration as Xuro's
 *  Modal.tsx (SPRING_SOFT is overdamped at these constants, i.e. no
 *  bounce - a plain ease-out curve is the correct match, not a bouncy one). */
export function Modal({ open, onClose, width = 480, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-[6px] transition-opacity duration-200 ease-out ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        style={{ width, maxWidth: "calc(100vw - 48px)" }}
        className={`flex max-h-[calc(100vh-48px)] flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl transition-all duration-300 ease-out ${
          open ? "scale-100 translate-y-0 opacity-100" : "scale-[.96] translate-y-2.5 opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

interface DialogHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

/** Header pattern shared by every small dialog (mirrors PublishNoteModal.tsx). */
export function DialogHeader({ icon, title, subtitle, onClose }: DialogHeaderProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-line-soft px-5 py-4">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-panel text-muted">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-faint">{subtitle}</p>}
      </div>
      <button
        onClick={onClose}
        className="ml-auto flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function FieldRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <div className="text-[13px] text-ink">{label}</div>
        {desc && <div className="mt-0.5 text-[11.5px] text-faint">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative h-5 w-[34px] flex-shrink-0 rounded-full transition-colors duration-150 ease-out ${
        on ? "bg-invert" : "bg-sunken"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-all duration-150 ease-out ${
          on ? "left-[16px] bg-invert-ink" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-ink transition-colors focus:border-faint focus:outline-none ${className}`}
    />
  );
}

export function Button({
  children,
  primary,
  danger,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  const base = "h-8 rounded-lg px-3.5 text-[12.5px] font-medium transition-colors";
  const style = primary
    ? "border border-invert bg-invert text-invert-ink hover:opacity-90"
    : danger
      ? "border border-line text-danger hover:bg-danger/10"
      : "border border-line bg-bg text-ink hover:bg-hover";
  return (
    <button {...rest} className={`${base} ${style} ${rest.className ?? ""}`}>
      {children}
    </button>
  );
}
