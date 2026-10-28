import { useTranslation } from "react-i18next";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export default function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? t("components.switch")}
      className="adp-switch-wrap"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={checked ? "adp-switch adp-switch--on" : "adp-switch"}>
        <span className="adp-switch-knob" />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}
