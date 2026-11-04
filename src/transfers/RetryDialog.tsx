import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { displayPath } from "../services/explorer";
import {
  initialAction,
  isActionAllowed,
  type TransferAction,
  type TransferDecision,
  type TransferDecisionRequest,
} from "../services/transferJobs";

function baseName(path: string): string {
  return displayPath(path).split("\\").filter(Boolean).pop() ?? path;
}

export interface RetryDialogProps {
  request: TransferDecisionRequest;
  /** The job generation the request belongs to (bound by the parent). */
  generation?: number;
  onDecision: (decision: TransferDecision) => Promise<void>;
  onClose: () => void;
}

/**
 * The error/retry window of one transfer item (Step 09f).
 *
 * Used for in-use and read errors (Retry file / Skip file / Cancel) and for
 * the one confirmation before a cloud placeholder is downloaded. It reads
 * nothing from disk and calls no native command; the parent binds the answer
 * to the generation it polled.
 */
export default function RetryDialog({
  request,
  generation,
  onDecision,
  onClose,
}: RetryDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(request.decision_id);
  const choices = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    current.current = request.decision_id;
    setBusy(false);
    setError(null);
    const initial = initialAction(request);
    if (initial) {
      choices.current
        ?.querySelector<HTMLButtonElement>(`[data-action="${initial}"]`)
        ?.focus();
    }
  }, [request]);

  const choose = async (action: TransferAction) => {
    const decisionId = request.decision_id;
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDecision({
        decision_id: decisionId,
        generation: generation ?? 0,
        action,
        apply_to_all: false,
      });
      if (current.current === decisionId) setBusy(false);
    } catch (reason) {
      if (current.current === decisionId) {
        setError(typeof reason === "string" ? reason : "ops.decision_stale");
        setBusy(false);
      }
    }
  };

  const code = request.error_code ?? "ops.other";
  const cloud = code === "ops.cloud_placeholder";
  const areaCode = code.startsWith("ops.") ? code : `ops.${code}`;
  const message = t(`errors.${areaCode}`, {
    defaultValue: t("errors.ops.other"),
  });

  return (
    <Dialog
      title={cloud ? t("transferJobs.title") : t("transferJobs.problems")}
      onClose={onClose}
      className="adp-conflict-window"
    >
      <div className="adp-conflict-body">
        <p className="adp-retry-item" title={request.source_path}>
          {baseName(request.source_path)}
        </p>
        <p className="adp-conflict-reason" role="alert">
          {message}
        </p>
        <div className="adp-conflict-choices" ref={choices}>
          {isActionAllowed(request, "retry") ? (
            <Button
              data-action="retry"
              disabled={busy}
              onClick={() => void choose("retry")}
            >
              {cloud ? t("common.retry") : t("transferJobs.retry")}
            </Button>
          ) : null}
          {isActionAllowed(request, "skip") ? (
            <Button
              data-action="skip"
              disabled={busy}
              onClick={() => void choose("skip")}
            >
              {t("transferJobs.skip")}
            </Button>
          ) : null}
          {isActionAllowed(request, "cancel") ? (
            <Button
              data-action="cancel"
              variant="subtle"
              disabled={busy}
              onClick={() => void choose("cancel")}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="adp-conflict-error" role="alert">
            {t(`errors.${error.includes(".") ? error : "ops.io"}`, {
              defaultValue: t("errors.ops.other"),
            })}
          </p>
        ) : null}
        <div className="adp-conflict-footer">
          <Button variant="subtle" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
