import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import type { TransferChoiceProps } from "./types";

/** Ask which eligible insertion the user means before anything changes
 * (Step 09c E5). Every label and loss key is translated; Escape cancels,
 * and a sensitive envelope shows the safe-copy warning before a choice. */
export function TransferChoiceDialog({
  envelope,
  actions,
  onChoose,
  onCancel,
}: TransferChoiceProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLLIElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    first.current?.focus();
  }, []);

  const choose = async (actionId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onChoose(actionId);
    } catch {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    const target = returnFocus.current;
    onCancel();
    target?.focus?.();
  };

  return (
    <Dialog title={t("transfer.choose")} onClose={close} className="adp-transfer-choice">
      <ul
        className="adp-transfer-actions"
        role="listbox"
        aria-label={t("transfer.choose")}
        aria-busy={busy}
      >
        {actions.map((action, index) => (
          <li
            key={action.id}
            ref={index === 0 ? first : undefined}
            role="option"
            aria-selected={false}
            aria-disabled={busy}
            tabIndex={busy ? -1 : 0}
            className="adp-transfer-action"
            onClick={() => void choose(action.id)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              void choose(action.id);
            }}
          >
            <span className="adp-transfer-action-label">{t(action.label_key)}</span>
            {action.losses.map((loss) => (
              <span key={loss} className="adp-transfer-loss">
                {t(loss)}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {envelope.sensitive ? (
        <p className="adp-transfer-warning" role="status">
          {t("transfer.sensitiveCopy")}
        </p>
      ) : null}
      <div className="adp-dialog-actions">
        <Button onClick={close} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}

export default TransferChoiceDialog;
