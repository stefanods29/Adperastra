import { Pin, type LucideIcon } from "lucide-react";

export interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  pinned?: boolean;
  onClick?: () => void;
  /** Drag-and-drop target folder (Step 03b). */
  dropPath?: string;
  dropName?: string;
}

export default function NavItem({ icon: Icon, label, active, pinned, onClick, dropPath, dropName }: NavItemProps) {
  const cls = ["adp-nav-item", active ? "adp-nav-item--active" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-current={active ? "page" : undefined} onClick={onClick} data-drop-folder={dropPath} data-drop-name={dropName}>
      <Icon size={16} aria-hidden="true" />
      <span className="adp-nav-label">{label}</span>
      {pinned ? <Pin size={12} aria-hidden="true" className="adp-nav-pin" /> : null}
    </button>
  );
}
