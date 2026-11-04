import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode, errorText } from "../../../services/errors";
import type { JobHandle } from "../../../services/jobs";
import {
  applyOfficeProposal, bindOfficeAiContext, cancelOfficeProposal, captureOfficeAiContext,
  confirmOfficeProposal, officeProposalPage, previewOfficeProposal, releaseOfficeAiContext,
} from "../../../services/officeAi";
import type { OfficeController } from "../../OfficeController";
import type {
  DocumentSelection, OfficeAiContext, OfficeProposalPreview, OfficeProposalRequest, OfficeSelection,
} from "../../types";
import { validateDocumentAiContext } from "./documentAiContext";
import { DocumentAiDiff } from "./DocumentAiDiff";
import { DocumentAiOptions } from "./DocumentAiOptions";
import {
  DOCUMENT_AI_ACTIONS, DOCUMENT_AI_LIMITS, type DocumentAiAction,
  type DocumentAiOptions as Options,
} from "./documentAiTypes";

/** Step 20c review panel. Generate captures the exact E20 context through the
 * canonical officeAi service; a proposal can only be previewed/applied if a
 * real E21 preview exists. Model generation (`services/documentAi.ts`) and the
 * selected-image authority are not integrated yet, so no suggestion or image
 * action is invented here. */

export interface DocumentAiPanelProps {
  controller: OfficeController;
  selection: OfficeSelection | null;
  initialAction: DocumentAiAction;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function area(error: unknown): string {
  return errorCode(error).startsWith("document_ai.") ? "document_ai" : "office_edit";
}

function liveDocument(selection: OfficeSelection | null, state: ReturnType<OfficeController["getState"]>): DocumentSelection | null {
  if (!selection || selection.kind !== "document" || !state.ready || state.busy ||
      state.mode === "viewing" || selection.span.revision !== state.revision) return null;
  return selection;
}

function eligible(selection: DocumentSelection | null, action: DocumentAiAction): boolean {
  if (!selection) return false;
  // No canonical selected-image authority exists yet (step-20c gap 2), so
  // alt text stays unavailable instead of guessing an image from the context.
  if (action === "alt_text") return false;
  const empty = selection.span.anchor.block_id === selection.span.focus.block_id &&
    selection.span.anchor.offset_utf16 === selection.span.focus.offset_utf16;
  return action === "draft" ? true : !empty;
}

function sourceText(context: OfficeAiContext): string {
  return context.text_runs.map((run) => run.text).join("\n\n");
}

export function DocumentAiPanel({ controller, selection, initialAction, onClose, onOpenHelp }: DocumentAiPanelProps) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState(() => controller.getState());
  const [options, setOptions] = useState<Options>(() => ({
    action: initialAction, tone: null, target_language: null,
    topic: initialAction === "draft" ? "" : null,
    locale: i18n.language.startsWith("es") ? "es" : "en",
  }));
  const [context, setContext] = useState<OfficeAiContext | null>(null);
  const [preview, setPreview] = useState<OfficeProposalPreview | null>(null);
  // No suggestion service may synthesize a proposal from options alone; the
  // canonical prepare/generate pipeline is a recorded step-20c gap, so Send
  // stays disabled until a real typed proposal exists.
  const [proposal] = useState<OfficeProposalRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const actionRef = useRef<HTMLSelectElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const job = useRef<JobHandle<unknown> | null>(null);
  const contextRef = useRef<OfficeAiContext | null>(context);
  const previewRef = useRef<OfficeProposalPreview | null>(preview);
  contextRef.current = context;
  previewRef.current = preview;

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionRef.current?.focus();
    return () => {
      void job.current?.cancel().catch(() => undefined);
      const livePreview = previewRef.current;
      const liveContext = contextRef.current;
      if (livePreview) void cancelOfficeProposal(livePreview.preview_id).catch(() => undefined);
      if (liveContext) void releaseOfficeAiContext(liveContext.context_id).catch(() => undefined);
      restoreFocus.current?.focus();
    };
  }, []);

  const target = liveDocument(selection, state);
  const source = context ? sourceText(context) : null;
  const optionsReady = options.action === "tone" ? options.tone !== null
    : options.action === "draft" ? (options.topic ?? "").trim().length > 0
      : true;
  const currentPreview = preview;
  const currentContext = context;
  const canCapture = Boolean(target) && !busy && optionsReady && options.action !== "translate" &&
    eligible(target, options.action) && state.capabilities.includes("ai_context");
  const canSend = Boolean(proposal && currentContext && target) && !busy &&
    state.capabilities.includes("proposal_clone");
  const canAccept = currentPreview !== null && currentContext !== null && target !== null && !busy &&
    currentPreview.complete && currentPreview.next_cursor === null && currentPreview.can_apply &&
    currentPreview.expires_unix > nowUnix() &&
    currentPreview.session_id === controller.session_id &&
    currentPreview.context_id === currentContext.context_id &&
    currentPreview.revision === state.revision && currentPreview.content_id === state.content_id &&
    currentPreview.warnings.every((warning) => acknowledged.includes(warning.id)) &&
    state.capabilities.includes("proposal_apply");

  const unavailableActions = DOCUMENT_AI_ACTIONS.filter((action) =>
    action === "alt_text" || action === "translate" || !eligible(target, action));

  const generate = async () => {
    if (!target || !canCapture) return;
    setBusy(true);
    setError(null);
    setStatus("documentAi.progress");
    setPreview(null);
    setAcknowledged([]);
    if (preview) void cancelOfficeProposal(preview.preview_id).catch(() => undefined);
    if (context) {
      void releaseOfficeAiContext(context.context_id).catch(() => undefined);
      setContext(null);
    }
    try {
      const request = bindOfficeAiContext(controller, target, { max_scalars: DOCUMENT_AI_LIMITS.source_scalars });
      const handle = await captureOfficeAiContext(controller.session_id, request);
      job.current = handle;
      const captured = await handle.completion;
      validateDocumentAiContext(captured, controller.session_id,
        request.expected_revision, request.expected_content_id, nowUnix());
      setContext(captured);
      // Capture is the canonical E20 half that exists today. No suggestion is
      // invented: services/documentAi.ts (prepare/generate) is still missing.
      setStatus(null);
    } catch (caught) {
      setError(caught);
      setStatus(null);
    } finally {
      job.current = null;
      setBusy(false);
    }
  };

  const send = async () => {
    if (!proposal || !context || !target || !canSend) return;
    setBusy(true);
    setError(null);
    setStatus("documentAi.progress");
    try {
      const handle = await previewOfficeProposal(controller, context, proposal);
      job.current = handle;
      const next = await handle.completion;
      setPreview(next);
      setAcknowledged([]);
      setStatus(null);
    } catch (caught) {
      setError(caught);
      setStatus(null);
    } finally {
      job.current = null;
      setBusy(false);
    }
  };

  const nextPage = async () => {
    if (!preview || !preview.next_cursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await officeProposalPage(preview.preview_id, preview.next_cursor);
      setPreview({
        ...next,
        diffs: [...preview.diffs, ...next.diffs],
        warnings: [...preview.warnings, ...next.warnings.filter((warning) =>
          !preview.warnings.some((seen) => seen.id === warning.id))],
        calculations: [...preview.calculations, ...next.calculations],
        renders: [...preview.renders, ...next.renders],
      });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!preview || !context || !canAccept) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await confirmOfficeProposal(preview.preview_id);
      await applyOfficeProposal({
        preview_id: preview.preview_id,
        transaction_id: crypto.randomUUID(),
        expected_revision: preview.revision,
        expected_content_id: preview.content_id,
        acknowledged_warning_ids: preview.warnings.map((warning) => warning.id),
        human_confirmation_id: grant.human_confirmation_id,
      });
      await releaseOfficeAiContext(context.context_id).catch(() => undefined);
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await job.current?.cancel().catch(() => undefined);
    job.current = null;
    if (preview) await cancelOfficeProposal(preview.preview_id).catch(() => undefined);
    if (context) await releaseOfficeAiContext(context.context_id).catch(() => undefined);
    setContext(null);
    setPreview(null);
    setAcknowledged([]);
    setStatus(null);
    setError(null);
    setBusy(false);
  };

  const diffs = preview?.diffs.flatMap((diff) =>
    diff.kind === "text" || diff.kind === "image_alt"
      ? [{ before: diff.before, after: diff.after }] : []) ?? [];

  return (
    <section className="document-ai-panel" aria-label={t("documentAi.title")} aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const element = event.target as HTMLElement;
        if (element.closest("input, textarea, select")) {
          event.preventDefault();
          element.blur();
          return;
        }
        event.stopPropagation();
        onClose();
      }}>
      <header>
        <h2>{t("documentAi.title")}</h2>
        <button type="button" aria-label={t("help.title")}
          onClick={() => onOpenHelp("ai-writing-in-documents")}>?</button>
        <button type="button" aria-label={t("common.close")} onClick={onClose}>×</button>
      </header>

      <DocumentAiOptions value={options} supportedLanguages={[]} disabled={busy || !target}
        unavailableActions={unavailableActions} actionRef={actionRef}
        onChange={(next) => {
          setOptions(next);
          setPreview(null);
          setAcknowledged([]);
        }} />

      {source ? (
        <section aria-label={t("documentAi.source")}>
          <h3>{t("documentAi.source")}</h3>
          <p>{source}</p>
        </section>
      ) : null}

      {diffs.length > 0 ? (
        <section aria-label={t("documentAi.suggestion")}>
          <h3>{t("documentAi.suggestion")}</h3>
          {diffs.map((diff, index) => <DocumentAiDiff key={index} before={diff.before} after={diff.after} />)}
        </section>
      ) : null}

      {preview?.warnings.length ? (
        <section aria-label={t("documentAi.suggestion")}>
          {preview.warnings.map((warning) => (
            <label key={warning.id} className="document-ai-warning">
              <input type="checkbox" checked={acknowledged.includes(warning.id)} disabled={busy}
                onChange={(event) => setAcknowledged((current) => event.target.checked
                  ? [...new Set([...current, warning.id])] : current.filter((id) => id !== warning.id))} />
              <span>{t(warning.message_key)}</span>
            </label>
          ))}
        </section>
      ) : null}

      {preview?.next_cursor ? (
        <button type="button" disabled={busy} onClick={() => void nextPage()}>
          {t("extra_view.next")}
        </button>
      ) : null}

      <footer>
        <button type="button" disabled={!canCapture} title={canCapture ? undefined : t("office.unsupported")}
          onClick={() => void generate()}>
          {t("sheetAi.generate")}
        </button>
        <button type="button" disabled={!canSend} title={canSend ? undefined : t("office.unsupported")}
          onClick={() => void send()}>
          {t("assistant.send")}
        </button>
        <button type="button" disabled={!canAccept} title={canAccept ? undefined : t("office.unsupported")}
          onClick={() => void accept()}>
          {t("documentAi.accept")}
        </button>
        <button type="button" onClick={() => void cancel()}>
          {t("documentAi.cancel")}
        </button>
      </footer>

      <p role="status" aria-live="polite">
        {busy ? t("documentAi.progress") : status ? t(status) : ""}
      </p>
      {error ? <p role="alert">{errorText(t, error, area(error))}</p> : null}
    </section>
  );
}
