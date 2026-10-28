import { ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface DropdownItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  label?: string;
  ariaLabel: string;
  icon?: LucideIcon;
  items: DropdownItem[];
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export default function DropdownMenu({
  label,
  ariaLabel,
  icon: Icon,
  items,
  onSelect,
  disabled,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <div className="adp-dropdown" ref={rootRef}>
      <button
        type="button"
        className="adp-btn adp-btn--default adp-dropdown-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {Icon ? <Icon size={16} aria-hidden="true" /> : null}
        {label ? <span>{label}</span> : null}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="adp-menu" role="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="adp-menu-item"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  onSelect(item.id);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
