import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { OfficeController } from "../OfficeController";
import type { OfficeSelection } from "../types";
import { canDocumentMutate } from "./documentController";
import { createDocumentDictation } from "./documentDictationSession";

export function DocumentDictation({ controller, selection, speechReady, language, previewOnly = false }: {
  controller: OfficeController; selection: OfficeSelection | null; speechReady: boolean;
  language: "en" | "es"; previewOnly?: boolean;
}) {
  const { t } = useTranslation();
  const currentSelection = useRef(selection); currentSelection.current = selection;
  const dictation = useMemo(() => createDocumentDictation(controller, () => currentSelection.current), [controller]);
  const [phase, setPhase] = useState<"idle" | "recording" | "review">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void dictation.cancel().catch(() => undefined); };
  }, [dictation]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(false);
    try { await action(); } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setBusy(false); }
  };
  const enabled = speechReady && selection?.kind === "document" &&
    canDocumentMutate(controller.getState(), "document_text", previewOnly).enabled;
  return <section aria-label={t("document.dictation")} aria-busy={busy} className="adp-office-document-dictation">
    <Button disabled={busy || phase !== "idle" || !enabled} onClick={() => void run(async () => {
      await dictation.start(language, speechReady, previewOnly); if (mounted.current) setPhase("recording");
    })}>{t("document.dictation")}</Button>
    <Button disabled={busy || phase !== "recording"} onClick={() => void run(async () => {
      const transcript = await dictation.stop();
      if (mounted.current) { setText(transcript); setPhase("review"); }
    })}>{t("document.stopDictation")}</Button>
    {phase === "review" ? <>
      <textarea readOnly aria-label={t("officeDoc.transcript")} value={text} />
      <Button disabled={busy || !enabled || !text} onClick={() => void run(async () => {
        await dictation.apply(); if (mounted.current) { setText(""); setPhase("idle"); }
      })}>{t("officeDoc.apply")}</Button>
    </> : null}
    <Button disabled={busy || phase === "idle"} onClick={() => void run(async () => {
      await dictation.cancel(); if (mounted.current) { setText(""); setPhase("idle"); }
    })}>{t("office.cancel")}</Button>
    {error ? <p role="alert">{t("errors.office_edit.failed")}</p> : null}
  </section>;
}
