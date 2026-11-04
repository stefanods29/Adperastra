import { Pause, Play, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import ProgressBar from "../components/ProgressBar";
import { displayPath } from "../services/explorer";
import { formatSize } from "../services/format";
import {
  transferReportPage,
  type TransferItemResult,
  type TransferReport,
  type TransferState,
} from "../services/transferJobs";
import ConflictDialog from "./ConflictDialog";
import RetryDialog from "./RetryDialog";
import { useTransferState, type UseTransferStateOptions } from "./useTransferState";

/** How many item lines one report page holds (mirrors the native page). */
export const REPORT_PAGE_ITEMS = 200;

export interface TransferWindowProps {
  jobId: string;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
  /**
   * The first page of the report, which is the value the `JobHandle`'s
   * `completion` resolves with. Optional: without it the window shows the
   * live state and loads the report only when a cursor arrives.
   */
  initialReport?: TransferReport;
  /** `visible: false` polls once a second instead of ten times. */
  polling?: UseTransferStateOptions;
}

function baseName(path: string): string {
  return displayPath(path).split("\\").filter(Boolean).pop() ?? path;
}

/** Locale-aware "about 2 minutes" from a whole number of seconds. */
function formatRemaining(seconds: number, locale: string): string {
  const whole = Math.max(1, Math.round(seconds));
  const value = whole < 60 ? whole : Math.round(whole / 60);
  const unit = whole < 60 ? "second" : "minute";
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
}

function percent(state: TransferState): number | undefined {
  const { items_done, items_total, bytes_done, bytes_total } = state.progress;
  if (state.state === "done") return 100;
  if (items_done === 0 && bytes_done === 0) return undefined;
  const byBytes = bytes_total > 0 ? (bytes_done / bytes_total) * 100 : 0;
  const byItems = items_total > 0 ? (items_done / items_total) * 100 : 0;
  return Math.floor(Math.max(byBytes, byItems));
}

/**
 * The transfer window (Step 09f E4): what is running, how far, how fast, how
 * long, and the four controls. Closing it hides the window; it never cancels
 * the job.
 */
export default function TransferWindow({
  jobId,
  onClose,
  onOpenHelp,
  initialReport,
  polling,
}: TransferWindowProps) {
  const { t, i18n } = useTranslation();
  const { state, error, control, decide } = useTransferState(jobId, polling);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [items, setItems] = useState<TransferItemResult[]>(initialReport?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initialReport?.next_cursor ?? null);
  const [pageError, setPageError] = useState<string | null>(null);
  // Closing a question only hides this dialog: the question stays open in
  // Rust and a new decision_id shows a fresh one with fresh focus.
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialReport?.items ?? []);
    setCursor(initialReport?.next_cursor ?? null);
    setPageError(null);
  }, [jobId, initialReport]);

  const decision = state?.decision ?? null;
  const decisionVisible = decision !== null && decision.decision_id !== dismissed;

  const report = useMemo(() => items.filter((item) => item.status !== "done"), [items]);
  const done = state?.state === "done";
  const paused = state?.state === "paused";

  const loadMore = async () => {
    if (!cursor) return;
    try {
      const page = await transferReportPage(cursor);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor ?? null);
      setPageError(null);
    } catch (reason) {
      setPageError(typeof reason === "string" ? reason : "ops.io");
    }
  };

  // Cancel stops the job and leaves the window (the job stays listed and can
  // be reopened); closing with X still only hides it.
  const cancelJob = async () => {
    await control("cancel");
    onClose();
  };

  return (
    <>
    <Dialog
      title={t("transferJobs.title")}
      onClose={onClose}
      className="adp-transfer-window"
    >
      <div className="adp-transfer-body">
        <div className="adp-transfer-head">
          <span className="adp-transfer-current" title={state?.progress.current ?? ""}>
            {state?.progress.current ? baseName(state.progress.current) : t("transferJobs.title")}
          </span>
          <div className="adp-transfer-head-actions">
            <HelpButton onOpenHelp={() => onOpenHelp("copying-and-conflicts")} />
            <button
              type="button"
              className="adp-icon-btn"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <ProgressBar value={state ? percent(state) : undefined} label={t("transferJobs.title")} />

        <div className="adp-transfer-metrics">
          <span>
            {state?.state === "queued"
              ? t("transferJobs.queued")
              : t("transferJobs.speed", {
                  speed:
                    state?.bytes_per_second && state.bytes_per_second > 0
                      ? `${formatSize(state.bytes_per_second, i18n.language)}/s`
                      : "—",
                })}
          </span>
          <span>
            {state?.eta_seconds !== null && state?.eta_seconds !== undefined
              ? t("transferJobs.eta", {
                  time: formatRemaining(state.eta_seconds, i18n.language),
                })
              : t("transferJobs.unknownEta")}
          </span>
        </div>

        <div className="adp-transfer-controls">
          {paused ? (
            <Button onClick={() => void control("resume")} disabled={done}>
              <Play size={16} aria-hidden="true" /> {t("transferJobs.resume")}
            </Button>
          ) : (
            <Button onClick={() => void control("pause")} disabled={done || paused}>
              <Pause size={16} aria-hidden="true" /> {t("transferJobs.pause")}
            </Button>
          )}
          <Button onClick={() => void control("skip_current")} disabled={done}>
            <SkipForward size={16} aria-hidden="true" /> {t("transferJobs.skip")}
          </Button>
          <Button variant="subtle" onClick={() => void cancelJob()} disabled={done}>
            {t("common.cancel")}
          </Button>
        </div>

        {error ? (
          <p className="adp-transfer-error" role="alert">
            {t(`errors.${error.includes(".") ? error : "ops.io"}`, {
              defaultValue: t("errors.ops.other"),
            })}
          </p>
        ) : null}

        <section className="adp-transfer-report">
          <div className="adp-transfer-report-head">
            <span>{t("transferJobs.report")}</span>
            <button
              type="button"
              className="adp-btn adp-btn--subtle"
              aria-expanded={problemsOpen}
              onClick={() => setProblemsOpen((open) => !open)}
            >
              {t("transferJobs.problems")}
              {report.length > 0 ? ` (${report.length})` : ""}
            </button>
          </div>
          {problemsOpen ? (
            <ul className="adp-transfer-problems">
              {items.length === 0 ? (
                <li className="adp-transfer-row">
                  <span>{state?.state === "done" ? t("jobs.done") : t("transferJobs.unknownEta")}</span>
                </li>
              ) : null}
              {items.map((item) => (
                <li key={item.item_id} className="adp-transfer-row">
                  <span className="adp-transfer-name" title={item.from}>
                    {baseName(item.from)}
                  </span>
                  <span className="adp-transfer-reason">
                    {item.verified ? t("transferJobs.verified") : null}
                    {item.reason
                      ? t(`errors.ops.${item.reason.replace(/^ops\./, "")}`, {
                          defaultValue: t("errors.ops.other"),
                        })
                      : null}
                  </span>
                </li>
              ))}
              {cursor ? (
                <li className="adp-transfer-row">
                  <Button variant="subtle" onClick={() => void loadMore()}>
                    {t("transferJobs.more")}
                  </Button>
                </li>
              ) : null}
            </ul>
          ) : null}
          {pageError ? (
            <p className="adp-transfer-error" role="alert">
              {t(`errors.ops.${pageError.replace(/^ops\./, "")}`, {
                defaultValue: t("errors.ops.other"),
              })}
            </p>
          ) : null}
        </section>
      </div>
    </Dialog>
    {decisionVisible && decision ? (
      decision.kind === "conflict" ? (
        <ConflictDialog
          key={decision.decision_id}
          request={decision}
          generation={state?.generation ?? 0}
          onDecision={(answer) => decide(answer)}
          onClose={() => setDismissed(decision.decision_id)}
        />
      ) : (
        <RetryDialog
          key={decision.decision_id}
          request={decision}
          generation={state?.generation ?? 0}
          onDecision={(answer) => decide(answer)}
          onClose={() => setDismissed(decision.decision_id)}
        />
      )
    ) : null}
    </>
  );
}
