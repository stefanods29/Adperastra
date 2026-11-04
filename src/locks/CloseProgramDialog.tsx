import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { errorText } from "../services/errors";
import type { LockProcess } from "../services/fileLocks";

/** The second confirmation before a normal close (Step 09g E3/D3).
 * It warns about unsaved work, never offers a force button, and Escape
 * cancels without asking any program to close. */
export interface CloseProgramDialogProps {
  process: LockProcess;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function CloseProgramDialog({
  process,
  onConfirm,
  onCancel,
}: CloseProgramDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const name = process.name || process.application || String(process.pid);
  return (
    <Dialog title={t("locks.close")} onClose={onCancel} className="adp-locks-confirm">
      <p className="adp-locks-warning">{t("locks.confirm", { name })}</p>
      {error ? (
        <p className="adp-locks-error" role="alert">
          {errorText(t, error, "locks")}
        </p>
      ) : null}
      <div className="adp-dialog-actions">
        <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
          {t("locks.close")}
        </Button>
        <button
          ref={cancelRef}
          type="button"
          className="adp-btn adp-btn--default"
          onClick={onCancel}
          disabled={busy}
        >
          {t("common.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
