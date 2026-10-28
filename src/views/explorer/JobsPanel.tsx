import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ProgressBar from "../../components/ProgressBar";
import { displayPath } from "../../services/explorer";
import type { OpProgress, SkippedItem } from "../../services/fileops";

export type JobStatus = "running" | "done" | "cancelled" | "failed";

export interface JobView {
  id: string;
  /** i18n verb key under `jobs` (copying, moving, ...). */
  verbKey: string;
  count: number;
  progress: OpProgress | null;
  status: JobStatus;
  skipped: SkippedItem[];
  onCancel: () => void;
}

export interface JobsPanelProps {
  jobs: JobView[];
  onDismiss: (id: string) => void;
  onClose: () => void;
}

function baseName(path: string): string {
  return displayPath(path).split("\\").filter(Boolean).pop() ?? path;
}

function percent(progress: OpProgress | null): number | undefined {
  if (!progress) return undefined;
  // Whichever measure is actually advancing: bytes say nothing for a
  // job copying many empty files, items say nothing inside one big file.
  // Nothing has landed yet (the engine is still walking the source):
  // an indeterminate bar says "working" better than a stuck 0%.
  if (progress.items_done === 0 && progress.bytes_done === 0) return undefined;
  const byBytes = progress.bytes_total > 0 ? (progress.bytes_done / progress.bytes_total) * 100 : 0;
  const byItems = progress.items_total > 0 ? (progress.items_done / progress.items_total) * 100 : 0;
  if (byBytes === 0 && byItems === 0 && progress.items_total === 0 && progress.bytes_total === 0) return undefined;
  return Math.floor(Math.max(byBytes, byItems));
}

/** Background-job progress (contract 10): what's running, how far, and
 * Cancel; finished jobs stay until dismissed so skips can be read. */
export default function JobsPanel({ jobs, onDismiss, onClose }: JobsPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (jobs.length === 0) return null;
  return (
    <div className="adp-jobs-panel" role="region" aria-label={t("jobs.title")}>
      <div className="adp-jobs-header">
        <span className="adp-jobs-title">{t("jobs.title")}</span>
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {jobs.map((job) => {
        const value = job.status === "done" ? 100 : percent(job.progress);
        const isOpen = expanded === job.id;
        return (
          <div key={job.id} className="adp-job-row">
            <div className="adp-job-main">
              <span className="adp-job-label">{t(`jobs.${job.verbKey}`, { count: job.count })}</span>
              {job.status === "running" ? (
                <button type="button" className="adp-btn adp-btn--subtle" onClick={job.onCancel}>
                  {t("common.cancel")}
                </button>
              ) : (
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("common.dismiss")}
                  title={t("common.dismiss")}
                  onClick={() => onDismiss(job.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            {job.status === "running" && job.progress?.current ? (
              <span className="adp-job-current">{baseName(job.progress.current)}</span>
            ) : null}
            {job.status === "running" || job.status === "done" ? (
              <ProgressBar value={value} label={t(`jobs.${job.verbKey}`, { count: job.count })} />
            ) : null}
            <div className="adp-job-meta">
              {job.status === "running" && value !== undefined ? <span>{`${value}%`}</span> : null}
              {job.status === "done" ? <span>{t("jobs.done")}</span> : null}
              {job.status === "cancelled" ? <span>{t("jobs.cancelled")}</span> : null}
              {job.skipped.length > 0 ? (
                <button
                  type="button"
                  className="adp-btn adp-btn--subtle"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : job.id)}
                >
                  {t("jobs.skippedItems", { count: job.skipped.length })}
                </button>
              ) : null}
            </div>
            {isOpen ? (
              <ul className="adp-job-skipped">
                {job.skipped.map((item) => (
                  <li key={item.path}>
                    <span>{baseName(item.path)}</span>
                    <span className="adp-job-reason">
                      {t(`errors.ops.${item.reason}`, { defaultValue: t("errors.ops.other") })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
