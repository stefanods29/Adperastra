import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import KeyTip from "./KeyTip";

export interface IconButtonProps {
  icon: LucideIcon;
  labelKey: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  keyTip?: string;
  /** Shown in the tooltip after the label, e.g. "Copy (Ctrl+C)". */
  shortcut?: string;
  showKeyTip?: boolean;
  className?: string;
}

export default function IconButton({
  icon: Icon,
  labelKey,
  onClick,
  disabled,
  pressed,
  keyTip,
  shortcut,
  showKeyTip,
  className,
}: IconButtonProps) {
  const { t } = useTranslation();
  const label = t(labelKey);
  const cls = ["adp-icon-btn", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <Icon size={16} aria-hidden="true" />
      {keyTip ? <KeyTip letter={keyTip} visible={showKeyTip} /> : null}
    </button>
  );
}
