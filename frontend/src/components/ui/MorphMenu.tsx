import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/** Same spring physics as Xuro's SPRING_PANEL (lib/ease.ts) - stiffness 420,
 *  damping 40, mass 0.5. Overdamped at these numbers (critical damping is
 *  ~29 here), so it settles smoothly with no bounce - not a plain ease
 *  curve, a real spring, just one that doesn't overshoot. */
const SPRING_PANEL = { type: "spring" as const, stiffness: 420, damping: 40, mass: 0.5 };

type Align = "start" | "end";

// Clip-path that hides everything but the corner nearest the trigger, so
// the panel appears to grow out of it (top-right corner for align="end").
function clipHidden(align: Align, radius: number) {
  const right = align === "end" ? "0%" : "92%";
  const left = align === "end" ? "92%" : "0%";
  return `inset(0% ${right} 92% ${left} round ${radius}px)`;
}
const clipShown = (radius: number) => `inset(0% 0% 0% 0% round ${radius}px)`;

export function MorphMenu({
  open,
  onClose,
  align = "end",
  radius = 12,
  width = 224,
  anchorClassName = "top-8",
  fixed,
  style,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: Align;
  radius?: number;
  width?: number;
  anchorClassName?: string;
  /** Render as a viewport-fixed element (for cursor-anchored context menus)
   *  instead of absolute-within-parent (for button-anchored dropdowns). */
  fixed?: boolean;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const originClass = align === "end" ? "origin-top-right" : "origin-top-left";
  const posClass = align === "end" ? "right-0" : "left-0";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, clipPath: clipHidden(align, radius) }}
          animate={{ opacity: 1, scale: 1, clipPath: clipShown(radius), transition: SPRING_PANEL }}
          exit={{ opacity: 0, scale: 0.96, clipPath: clipHidden(align, radius), transition: SPRING_PANEL }}
          style={{ width, borderRadius: radius, filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.28))", ...style }}
          className={`${fixed ? "fixed" : `absolute ${anchorClassName} ${posClass}`} ${originClass} z-30 overflow-hidden border border-line bg-bg p-1`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
