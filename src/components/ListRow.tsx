import type { LucideIcon } from "lucide-react";

export interface ListRowProps {
  icon: LucideIcon;
  name: string;
  meta?: string;
  selected?: boolean;
  onClick?: () => void;
}

export default function ListRow({ icon: Icon, name, meta, selected, onClick }: ListRowProps) {
  const cls = ["adp-list-row", selected ? "adp-list-row--selected" : ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="adp-list-row-name">{name}</span>
      {meta ? <span className="adp-list-row-meta">{meta}</span> : null}
    </button>
  );
}
