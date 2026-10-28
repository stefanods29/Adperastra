import { useTranslation } from "react-i18next";
import Button, { type ButtonVariant } from "./Button";
import DropdownMenu, { type DropdownItem } from "./DropdownMenu";

export interface SplitButtonProps {
  label: string;
  onClick?: () => void;
  items: DropdownItem[];
  onSelect: (id: string) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}

export default function SplitButton({
  label,
  onClick,
  items,
  onSelect,
  variant = "default",
  disabled,
}: SplitButtonProps) {
  const { t } = useTranslation();
  return (
    <div className="adp-split">
      <Button variant={variant} disabled={disabled} onClick={onClick}>
        {label}
      </Button>
      <DropdownMenu
        ariaLabel={t("common.moreOptions")}
        items={items}
        onSelect={onSelect}
        disabled={disabled}
      />
    </div>
  );
}
