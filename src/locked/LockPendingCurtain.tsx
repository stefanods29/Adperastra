import { AlertTriangle, KeyRound, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import type { LockedSession } from "../services/lockedFolders";

export interface LockPendingCurtainProps {
  session: LockedSession;
  errorCode?: string | null;
  onRetry: () => void;
  onSaveCopy: () => void;
  onDiscard: () => void;
  onOpenHelp: (slug: string) => void;
}

/** A pending lock obscures the content but does not claim the keys were
 * removed: the dirty bytes and keys stay until recovery is verified or the
 * user explicitly discards. */
export default function LockPendingCurtain({
  session,
  errorCode,
  onRetry,
  onSaveCopy,
  onDiscard,
  onOpenHelp,
}: LockPendingCurtainProps) {
  const { t } = useTranslation();
  return (
    <div className="adp-locked-curtain" role="alertdialog" aria-modal="true" aria-label={t("locked.pending")}>
      <div className="adp-locked-curtain-card">
        <div className="adp-locked-heading-row">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t("locked.pending")}</span>
          <HelpButton onOpenHelp={() => onOpenHelp("locking-protection")} />
        </div>
        <p>{session.pending_recovery ? t("locked.pendingSaved") : t("locked.pending")}</p>
        {errorCode && (
          <p className="adp-locked-error" role="alert">
            {errorCode}
          </p>
        )}
        <div className="adp-locked-curtain-actions">
          <Button variant="primary" onClick={onRetry}>
            <KeyRound size={16} aria-hidden="true" />
            {t("locked.retrySave")}
          </Button>
          <Button onClick={onSaveCopy}>
            <Save size={16} aria-hidden="true" />
            {t("locked.saveCopy")}
          </Button>
          <Button variant="subtle" onClick={onDiscard}>
            <Trash2 size={16} aria-hidden="true" />
            {t("locked.discardChanges")}
          </Button>
        </div>
        <p className="adp-locked-note">{t("locked.pendingKeys")}</p>
      </div>
    </div>
  );
}
