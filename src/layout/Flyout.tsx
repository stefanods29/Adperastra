/** A small panel of lists that opens beside its button (Step 05c). On a
 * side toolbar the ribbon's lists live here instead of in the column. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface FlyoutProps {
  icon: LucideIcon;
  label: string;
  /** Which way the panel opens: away from the window edge. */
  opensTo: "right" | "left";
  children: ReactNode;
}

interface Box {
  top: number;
  left: number | null;
  right: number | null;
  maxHeight: number;
}

export default function Flyout({ icon: Icon, label, opensTo, children }: FlyoutProps) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.top;
    setBox({
      top,
      left: opensTo === "right" ? rect.right + 4 : null,
      right: opensTo === "left" ? window.innerWidth - rect.left + 4 : null,
      maxHeight: Math.max(0, window.innerHeight - top - 8),
    });
    setOpen(true);
  };

  // Escape closes and gives the focus back; a click elsewhere closes too.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // The first control takes the focus, so the keyboard can use the panel.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("select, button, input")?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="adp-icon-btn adp-flyout-btn"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) setOpen(false);
          else show();
        }}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
      {open && box ? (
        <div
          ref={panelRef}
          className="adp-flyout"
          role="dialog"
          aria-label={label}
          style={{
            top: box.top,
            left: box.left ?? undefined,
            right: box.right ?? undefined,
            maxHeight: box.maxHeight,
          }}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
