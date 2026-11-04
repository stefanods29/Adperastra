import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import { cancelDictation, startDictation, stopDictation, transcriptPage } from "../services/speech";
import { DICTATION_MAX_SECONDS, type DictationSession } from "../services/speechTypes";

/**
 * Explicit dictation dialog (Step 17b D9).
 *
 * Start opens the native microphone permission owned by the same recording;
 * the indicator and elapsed time stay visible, Stop transcribes locally, and
 * the recognized text is a preview for the consumer's own Apply. Closing,
 * cancelling or changing the tab releases the microphone and inserts nothing.
 */

export interface DictationDialogProps {
  documentId: string;
  expectedRevision: number;
  expectedContentId: string;
  language: "en" | "es";
  onClose: () => void;
  /** The consumer decides how (and whether) to use the reviewed text. */
  onReviewed: (info: { transcriptId: string; text: string; contentId: string }) => void;
  onOpenHelp: (slug: string) => void;
}

type Phase = "idle" | "recording" | "processing" | "review" | "failed";

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.min(DICTATION_MAX_SECONDS, Math.floor(seconds)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function DictationDialog({
  documentId,
  expectedRevision,
  expectedContentId,
  language,
  onClose,
  onReviewed,
  onOpenHelp,
}: DictationDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [review, setReview] = useState<{ transcriptId: string; text: string } | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  const timer = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const cancel = useCallback(async () => {
    stopTimer();
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await cancelDictation(session.id).catch(() => undefined);
  }, [stopTimer]);

  useEffect(() => {
    return () => {
      void cancel();
    };
  }, [cancel]);

  const start = async () => {
    setErrorCode(null);
    setPhase("processing");
    try {
      const session = await startDictation({
        document_id: documentId,
        expected_revision: expectedRevision,
        expected_content_id: expectedContentId,
        language,
        max_seconds: DICTATION_MAX_SECONDS,
      });
      sessionRef.current = session;
      setElapsed(0);
      setPhase("recording");
      timer.current = window.setInterval(() => {
        setElapsed((value) => {
          const next = value + 1;
          if (next >= DICTATION_MAX_SECONDS) {
            stopTimer();
            setPhase("review");
          }
          return Math.min(next, DICTATION_MAX_SECONDS);
        });
      }, 1000);
    } catch (error) {
      const code = error instanceof Error ? error.message : "errors.speech.failed";
      setErrorCode(code);
      setPhase("failed");
    }
  };

  const stop = async () => {
    stopTimer();
    const session = sessionRef.current;
    if (!session) return;
    setPhase("processing");
    try {
      const info = await stopDictation(session.id);
      sessionRef.current = null;
      const page = await transcriptPage(info.id, 0);
      const text = page.segments.map((segment) => segment.text).join("\n");
      setReview({ transcriptId: info.id, text });
      setPhase("review");
    } catch (error) {
      setErrorCode(error instanceof Error ? error.message : "errors.speech.failed");
      setPhase("failed");
    }
  };

  const close = () => {
    void cancel();
    onClose();
  };

  const remaining = useMemo(() => DICTATION_MAX_SECONDS - elapsed, [elapsed]);

  return (
    <Dialog title={t("speech.dictation")} onClose={close} className="adp-dictation">
      <div className="adp-dictation-body">
        <p className="adp-dictation-local">{t("speech.local")}</p>
        <p className="adp-dictation-limit">{t("speech.limit")}</p>
        <p className="adp-dictation-note">{t("speech.noInsert")}</p>

        {phase === "recording" ? (
          <div className="adp-dictation-indicator" role="status" aria-live="polite">
            <span className="adp-dictation-dot" aria-hidden="true" />
            <span>{t("speech.recording", { time: formatElapsed(elapsed) })}</span>
            <span className="adp-dictation-remaining">{formatElapsed(remaining)}</span>
          </div>
        ) : null}

        {phase === "processing" ? <p role="status">{t("speech.preparing")}</p> : null}
        {phase === "failed" ? (
          <p role="alert">
            {errorCode === "speech.permission_denied"
              ? t("errors.speech.permission_denied")
              : errorCode === "speech.device_unavailable"
                ? t("errors.speech.device_unavailable")
                : t("errors.speech.failed")}
          </p>
        ) : null}

        {phase === "review" && review ? (
          <section className="adp-dictation-review" aria-label={t("speech.review")}>
            <h3>{t("speech.review")}</h3>
            <pre className="adp-dictation-text">{review.text}</pre>
            <button
              type="button"
              onClick={() => onReviewed({ ...review, contentId: expectedContentId })}
            >
              {t("speech.review")}
            </button>
          </section>
        ) : null}
      </div>

      <footer className="adp-dictation-footer">
        {phase === "idle" || phase === "failed" ? (
          <button type="button" onClick={() => void start()}>
            {t("speech.start")}
          </button>
        ) : null}
        {phase === "recording" ? (
          <button type="button" onClick={() => void stop()}>
            {t("speech.stop")}
          </button>
        ) : null}
        <button type="button" onClick={close}>
          {t("speech.cancel")}
        </button>
        <HelpButton onOpenHelp={() => onOpenHelp("automatic-captions")} />
      </footer>
    </Dialog>
  );
}
