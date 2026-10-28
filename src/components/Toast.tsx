import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export interface ToastData {
  id: number;
  message: string;
  showUndo?: boolean;
  shortcutHint?: string;
}

export interface ToastProps {
  toast: ToastData;
  onDismiss: (id: number) => void;
  onUndo?: (id: number) => void;
}

export function Toast({ toast, onDismiss, onUndo }: ToastProps) {
  const { t } = useTranslation();
  const timer = useRef<number | null>(null);

  const start = () => {
    stop();
    timer.current = window.setTimeout(() => onDismiss(toast.id), 8000);
  };
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div
      className="adp-toast"
      role="status"
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
    >
      <span className="adp-toast-message">{toast.message}</span>
      {toast.showUndo && onUndo ? (
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onUndo(toast.id)}>
          <span>{t("common.undo")}</span>
          {toast.shortcutHint ? <span className="adp-toast-hint">{toast.shortcutHint}</span> : null}
        </button>
      ) : null}
      <button
        type="button"
        className="adp-icon-btn"
        aria-label={t("common.dismiss")}
        title={t("common.dismiss")}
        onClick={() => onDismiss(toast.id)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export interface ToastStackProps {
  toasts: ToastData[];
  onDismiss: (id: number) => void;
  onUndo?: (id: number) => void;
}

export default function ToastStack({ toasts, onDismiss, onUndo }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="adp-toast-stack">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} onUndo={onUndo} />
      ))}
    </div>
  );
}
