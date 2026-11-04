import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import { errorCode, errorText } from "../services/errors";
import {
  inspectFileLocks,
  requestProcessClose,
  type CloseLockProcessResult,
  type FileLockReport,
  type LockProcess,
} from "../services/fileLocks";
import type { JobHandle } from "../services/jobs";
import CloseProgramDialog from "./CloseProgramDialog";

/** Files in use (Step 09g E3). It lists what Windows reports, offers a
 * normal close only for eligible programs, and never forces a program or
 * retries the original action with an old authorization. */
export interface FilesInUseDialogProps {
  paths: readonly string[];
  onRetry: () => Promise<void>;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

export default function FilesInUseDialog({
  paths,
  onRetry,
  onClose,
  onOpenHelp,
}: FilesInUseDialogProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<FileLockReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<unknown>(null);
  const [confirmProcess, setConfirmProcess] = useState<LockProcess | null>(null);
  const [closingPid, setClosingPid] = useState<number | null>(null);
  const [closeResult, setCloseResult] = useState<CloseLockProcessResult | null>(null);
  const [closeError, setCloseError] = useState<unknown>(null);
  const jobRef = useRef<JobHandle<FileLockReport> | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      restoreFocus.current?.focus?.();
    };
  }, []);

  const load = () => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setLoading(true);
    setShowSkeleton(false);
    setError(null);
    setCloseResult(null);
    setCloseError(null);
    const timer = window.setTimeout(() => {
      if (generationRef.current === generation) setShowSkeleton(true);
    }, 100);
    void (async () => {
      try {
        const job = await inspectFileLocks(paths);
        if (generationRef.current !== generation) {
          await job.cancel();
          return;
        }
        jobRef.current = job;
        const next = await job.completion;
        if (generationRef.current !== generation) return;
        setReport(next);
      } catch (caught) {
        if (generationRef.current !== generation) return;
        if (errorCode(caught) !== "locks.cancelled") setError(caught);
      } finally {
        window.clearTimeout(timer);
        if (generationRef.current === generation) {
          setLoading(false);
          setShowSkeleton(false);
          jobRef.current = null;
        }
      }
    })();
  };

  useEffect(() => {
    load();
    return () => {
      generationRef.current += 1;
      void jobRef.current?.cancel();
    };
    // `paths` is a fixed inspection target for one dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join("\u0000")]);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetry();
      onClose();
    } catch (caught) {
      setRetryError(caught);
    } finally {
      setRetrying(false);
    }
  };

  const closeProgram = async (process: LockProcess) => {
    setClosingPid(process.pid);
    setCloseError(null);
    try {
      const job = await requestProcessClose({
        pid: process.pid,
        start_ticks: process.start_ticks,
        confirmed: true,
      });
      const result = await job.completion;
      setCloseResult(result);
      if (result.status === "refused") {
        setCloseError(result.reason ?? "locks.denied");
      }
      setConfirmProcess(null);
    } catch (caught) {
      setCloseError(caught);
      setConfirmProcess(null);
    } finally {
      setClosingPid(null);
    }
  };

  const resultText = closeResult
    ? closeResult.status === "requested"
      ? t("locks.requested")
      : closeResult.status === "already_closed"
        ? t("locks.alreadyClosed")
        : errorText(t, closeResult.reason ?? "locks.denied", "locks")
    : null;

  return (
    <>
      <Dialog
        title={t("locks.title")}
        onClose={() => {
          if (!confirmProcess) onClose();
        }}
        className="adp-locks-dialog"
      >
        <div className="adp-locks-heading">
          <p className="adp-locks-subtitle">{t("locks.inspect")}</p>
          <HelpButton onOpenHelp={() => onOpenHelp("files-in-use")} />
        </div>
        {showSkeleton && loading ? <Skeleton variant="rows" count={3} /> : null}
        {error ? (
          <div className="adp-locks-error" role="alert">
            <span>{errorText(t, error, "locks")}</span>
            <Button onClick={load}>{t("common.retry")}</Button>
          </div>
        ) : null}
        {report ? (
          <>
            {report.folder_nonrecursive ? (
              <p className="adp-locks-note">{t("locks.folderNote")}</p>
            ) : null}
            {report.processes.length === 0 ? (
              <p className="adp-locks-none">{t("locks.none")}</p>
            ) : (
              <div className="adp-locks-list" role="list" aria-label={t("locks.title")}>
                {report.processes.map((process) => (
                  <div className="adp-locks-row" role="listitem" key={`${process.pid}-${process.start_ticks}`}>
                    <div className="adp-locks-person">
                      <span className="adp-locks-name">
                        {process.name || process.application || String(process.pid)}
                      </span>
                      <span className="adp-locks-app">
                        {process.application && process.application !== process.name
                          ? process.application
                          : `PID ${process.pid}`}
                      </span>
                    </div>
                    <Button
                      onClick={() => setConfirmProcess(process)}
                      disabled={!process.can_close || closingPid !== null}
                      title={!process.can_close ? t("locks.protected") : undefined}
                    >
                      {t("locks.close")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {report.processes.some((process) => !process.can_close) ? (
              <p className="adp-locks-note">{t("locks.protected")}</p>
            ) : null}
            {report.complete ? null : (
              <p className="adp-locks-note" role="alert">
                {errorText(t, report.error_code ?? "locks.failed", "locks")}
              </p>
            )}
          </>
        ) : null}
        {resultText ? (
          <p className="adp-locks-result" role="status">
            {resultText}
          </p>
        ) : null}
        {closeError ? (
          <p className="adp-locks-error" role="alert">
            {errorText(t, closeError, "locks")}
          </p>
        ) : null}
        {retryError ? (
          <p className="adp-locks-error" role="alert">
            {errorText(t, retryError, "locks")}
          </p>
        ) : null}
        <div className="adp-dialog-actions">
          <Button variant="primary" onClick={() => void retry()} disabled={retrying || loading}>
            {t("locks.retry")}
          </Button>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      </Dialog>
      {confirmProcess ? (
        <CloseProgramDialog
          process={confirmProcess}
          onCancel={() => setConfirmProcess(null)}
          onConfirm={() => closeProgram(confirmProcess)}
        />
      ) : null}
    </>
  );
}
