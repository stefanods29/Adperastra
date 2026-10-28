import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Dialog({ title, onClose, children }: DialogProps) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="adp-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="adp-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="adp-dialog-header">
          <span className="adp-dialog-title">{title}</span>
          <button
            type="button"
            className="adp-icon-btn"
            aria-label={t("components.closeDialog")}
            title={t("components.closeDialog")}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="adp-dialog-body">{children}</div>
      </div>
    </div>
  );
}
