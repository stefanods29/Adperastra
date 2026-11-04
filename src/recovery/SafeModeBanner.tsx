import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";

/**
 * Persistent safe-mode banner (Step 09h T6). It uses the caution tokens,
 * stays visible while safe mode is active and offers the one explicit
 * restart. Settings and files remain untouched until the user chooses it.
 */

export interface SafeModeBannerProps {
  onRestart: () => void;
  busy?: boolean;
  /** Additive: the translated restart failure, shown inside the banner. */
  error?: string;
}

export default function SafeModeBanner({ onRestart, busy = false, error }: SafeModeBannerProps) {
  const { t } = useTranslation();
  return (
    <aside className="adp-safe-mode-banner" role="status" aria-live="polite">
      <ShieldAlert size={16} aria-hidden="true" className="adp-safe-mode-icon" />
      <p className="adp-safe-mode-text">{t("safeMode.banner")}</p>
      {error ? (
        <span className="adp-safe-mode-error" role="alert">
          {error}
        </span>
      ) : null}
      <Button variant="primary" disabled={busy} onClick={onRestart}>
        {t("safeMode.restart")}
      </Button>
    </aside>
  );
}
