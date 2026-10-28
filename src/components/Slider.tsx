import { useTranslation } from "react-i18next";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label?: string;
  disabled?: boolean;
}

export default function Slider({ value, min, max, onChange, label, disabled }: SliderProps) {
  const { t } = useTranslation();
  return (
    <span className="adp-slider-wrap">
      <input
        className="adp-slider"
        type="range"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={label ?? t("components.slider")}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="adp-slider-value">{value}</span>
    </span>
  );
}
