import { useTranslation } from "react-i18next";

export interface ProgressBarProps {
  value?: number;
  label?: string;
}

export default function ProgressBar({ value, label }: ProgressBarProps) {
  const { t } = useTranslation();
  const indeterminate = value === undefined;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div
      className={indeterminate ? "adp-progress adp-progress--indeterminate" : "adp-progress"}
      role="progressbar"
      aria-label={label ?? t("components.progress")}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : clamped}
    >
      <div className="adp-progress-fill" style={indeterminate ? undefined : { width: `${clamped}%` }} />
    </div>
  );
}
