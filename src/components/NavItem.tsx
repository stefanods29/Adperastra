import { Pin, type LucideIcon } from "lucide-react";

export interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  pinned?: boolean;
  onClick?: () => void;
}

export default function NavItem({ icon: Icon, label, active, pinned, onClick }: NavItemProps) {
  const cls = ["adp-nav-item", active ? "adp-nav-item--active" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon size={16} aria-hidden="true" />
      <span className="adp-nav-label">{label}</span>
      {pinned ? <Pin size={12} aria-hidden="true" className="adp-nav-pin" /> : null}
    </button>
  );
}
