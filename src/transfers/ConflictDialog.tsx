import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { displayPath } from "../services/explorer";
import { formatDate, formatSize } from "../services/format";
import {
  initialAction,
  isActionAllowed,
  type TransferAction,
  type TransferDecision,
  type TransferDecisionRequest,
} from "../services/transferJobs";

/** Windows 100 ns ticks to Unix seconds (for the date line only). */
function ticksToSeconds(ticks: string | undefined): number {
  if (!ticks) return 0;
  const value = Number(ticks);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round((value - 116_444_736_000_000_000) / 10_000_000));
}

function baseName(path: string): string {
  return displayPath(path).split("\\").filter(Boolean).pop() ?? path;
}

export interface ConflictDialogProps {
  request: TransferDecisionRequest;
  /** The job generation the request belongs to (bound by the parent). */
  generation?: number;
  onDecision: (decision: TransferDecision) => Promise<void>;
  onClose: () => void;
}

function Side({
  heading,
  path,
  stamp,
  kind,
  locale,
}: {
  heading: string;
  path: string;
  stamp: TransferDecisionRequest["source"];
  kind: string | null | undefined;
  locale: string;
}) {
  const size = stamp ? formatSize(stamp.size_bytes, locale) : "";
  const date = stamp ? formatDate(ticksToSeconds(stamp.modified_ticks), locale) : "";
  return (
    <div className="adp-conflict-side">
      <span className="adp-conflict-heading">{heading}</span>
      {/* An inert frame: a conflict preview never reads the file and never
          asks a thumbnail provider that would download a cloud placeholder. */}
      <div className="adp-conflict-preview" aria-hidden="true">
        {kind === "folder" ? "⊞" : "▤"}
      </div>
      <span className="adp-conflict-name" title={path}>
        {baseName(path)}
      </span>
      <span className="adp-conflict-meta">{size}</span>
      <span className="adp-conflict-meta">{date}</span>
    </div>
  );
}

/**
 * The conflict window (Step 09f E5).
 *
 * A name is already in use. Compare both items and choose Skip, Keep both or
 * Merge. Replace is shown disabled with the reason: replacing existing files
 * is unavailable until the exact existing file can be protected.
 *
 * The dialog reads nothing from disk and calls no native command: it only
 * reports the answer, and the parent binds it to the generation it polled.
 */
export default function ConflictDialog({
  request,
  generation,
  onDecision,
  onClose,
}: ConflictDialogProps) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(request.decision_id);
  const choices = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    current.current = request.decision_id;
    setBusy(false);
    setApplyAll(false);
    setError(null);
    // Exactly one initial action takes focus — the first safe one, never
    // Cancel and never a disabled Replace.
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
        apply_to_all: applyAll,
      });
      // Only a reply that belongs to the question this window is showing may
      // change it; a stale acknowledgement leaves the new question alone.
      if (current.current === decisionId) setBusy(false);
    } catch (reason) {
      if (current.current === decisionId) {
        setError(typeof reason === "string" ? reason : "ops.decision_stale");
        setBusy(false);
      }
    }
  };

  const replaceReason = t("conflicts.replaceReason");

  return (
    <Dialog title={t("conflicts.title")} onClose={onClose} className="adp-conflict-window">
      <div className="adp-conflict-body">
        <div className="adp-conflict-columns">
          <Side
            heading={t("conflicts.source")}
            path={request.source_path}
            stamp={request.source}
            kind={request.source_kind}
            locale={i18n.language}
          />
          <Side
            heading={t("conflicts.target")}
            path={request.target_path ?? request.source_path}
            stamp={request.target}
            kind={request.target_kind}
            locale={i18n.language}
          />
        </div>

        <div className="adp-conflict-choices" ref={choices}>
          <Button
            data-action="skip"
            disabled={busy || !isActionAllowed(request, "skip")}
            onClick={() => void choose("skip")}
          >
            {t("conflicts.skip")}
          </Button>
          <Button
            data-action="keepBoth"
            disabled={busy || !isActionAllowed(request, "keepBoth")}
            onClick={() => void choose("keepBoth")}
          >
            {t("conflicts.keepBoth")}
          </Button>
          {isActionAllowed(request, "merge") ? (
            <Button data-action="merge" disabled={busy} onClick={() => void choose("merge")}>
              {t("conflicts.merge")}
            </Button>
          ) : null}
        </div>

        <div className="adp-conflict-replace">
          <Button disabled aria-disabled="true" title={replaceReason}>
            {t("conflicts.replace")}
          </Button>
          <Button disabled aria-disabled="true" title={replaceReason}>
            {t("conflicts.replaceNewer")}
          </Button>
          <p className="adp-conflict-reason">{replaceReason}</p>
        </div>

        <div className="adp-conflict-footer">
          <label className="adp-conflict-apply">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(event) => setApplyAll(event.target.checked)}
            />
            <span>{t("conflicts.applyAll")}</span>
          </label>
          {error ? (
            <p className="adp-conflict-error" role="alert">
              {t(`errors.${error.includes(".") ? error : "ops.io"}`, {
                defaultValue: t("errors.ops.other"),
              })}
            </p>
          ) : null}
          <Button variant="subtle" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
