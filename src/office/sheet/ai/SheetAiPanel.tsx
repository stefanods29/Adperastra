import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeController } from "../../OfficeController";
import type {
  CellAddress, OfficeProposalCalculation, OfficeSelection,
} from "../../types";
import SheetAiChartPreview from "./SheetAiChartPreview";
import SheetAiCleaningGrid from "./SheetAiCleaningGrid";
import SheetAiFormulaPreview from "./SheetAiFormulaPreview";
import { sheetFormulaCalculated } from "./sheetFormulaSafety";
import {
  type SheetAiAction, type SheetAiOutput, type SheetAiPreparedRequest,
  type SheetAiRequest, type SheetAiSuggestion, type SheetCleanOperation,
} from "./sheetAiTypes";
import {
  acceptSheetSuggestion, generateSheetSuggestion, prepareSheetSuggestion, previewSheetSuggestion,
  releaseSheetSuggestion, sheetSuggestionDiffPage, type SheetDiffPage,
} from "../../../services/sheetAi";
import { AssistantOutboundConsentHost } from "../../../assistant/AssistantOutboundConsentHost";
import { errorCode, errorText } from "../../../services/errors";
import type { JobHandle } from "../../../services/jobs";

/** E4: accessible AI review for one sheet selection.
 *
 * Generate only prepares a typed request; API content needs a separate Send
 * consent. Accept is a third, separate action and is enabled only for a
 * completely reviewed E21 preview with a real calculation or chart render.
 * Explain and Describe never change cells. */

export interface SheetAiPanelProps {
  controller: OfficeController;
  selection: OfficeSelection | null;
  initialAction: SheetAiAction;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

const ACTION_KEYS = {
  formula: "sheetAi.formula",
  explain: "sheetAi.explain",
  clean: "sheetAi.clean",
  chart: "sheetAi.chart",
  describe: "sheetAi.describe",
} as const;

function rectangle(selection: OfficeSelection | null) {
  if (!selection || selection.kind !== "sheet" || selection.ranges.length !== 1) return null;
  return selection.ranges[0];
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function area(error: unknown): string {
  const code = errorCode(error);
  if (code.startsWith("assistant.")) return "assistant";
  if (code.startsWith("ai.")) return "ai";
  return "sheet_ai";
}

export function SheetAiPanel({ controller, selection, initialAction, onClose, onOpenHelp }: SheetAiPanelProps) {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState<SheetAiAction>(initialAction);
  const [state, setState] = useState(() => controller.getState());
  const [text, setText] = useState("");
  const [header, setHeader] = useState(true);
  const [prepared, setPrepared] = useState<SheetAiPreparedRequest | null>(null);
  const [suggestion, setSuggestion] = useState<SheetAiSuggestion | null>(null);
  const [output, setOutput] = useState<SheetAiOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [consentSent, setConsentSent] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [diffPage, setDiffPage] = useState<SheetDiffPage | null>(null);
  const [diffTrail, setDiffTrail] = useState<(string | null)[]>([]);
  const [reviewedAll, setReviewedAll] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const job = useRef<JobHandle<SheetAiSuggestion> | null>(null);
  const liveId = useRef<string | null>(null);

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      void job.current?.cancel().catch(() => undefined);
      if (liveId.current) void releaseSheetSuggestion(liveId.current).catch(() => undefined);
      restoreFocus.current?.focus();
    };
  }, []);

  const range = rectangle(selection);
  const target: CellAddress | null = useMemo(() => {
    if (action !== "formula" || !selection || selection.kind !== "sheet" || !range) return null;
    const active = selection.active;
    return active.sheet_id === range.sheet_id && active.row >= range.first_row &&
      active.row <= range.last_row && active.column >= range.first_column &&
      active.column <= range.last_column ? active : null;
  }, [action, range, selection]);

  const request: SheetAiRequest | null = range && state.ready && !state.busy && text.trim()
    ? {
        action, session_id: controller.session_id,
        expected_revision: state.revision, expected_content_id: state.content_id,
        selection: range, target, header, include_hidden: false, request: text.trim(),
        locale: i18n.language.startsWith("es") ? "es" : "en", request_revision: 0,
      }
    : null;

  const adopt = (next: SheetAiSuggestion) => {
    liveId.current = next.id;
    setSuggestion(next);
    setOutput(next.output);
    setEditing(false);
    setDiffTrail([]);
    if (next.diffs.length > 0) {
      const page = sheetSuggestionDiffPage(next.id, null);
      setDiffPage(page);
      setReviewedAll(page.complete);
    } else {
      setDiffPage(null);
      setReviewedAll(true);
    }
  };

  const start = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    setStatus("sheetAi.progress");
    setPrepared(null);
    setSuggestion(null);
    setOutput(null);
    setConsentSent(false);
    setReviewOpen(false);
    try {
      const next = await prepareSheetSuggestion(controller, request);
      setPrepared(next);
      liveId.current = next.id;
      if (next.outbound_preview.requires_consent) {
        setReviewOpen(true);
        setStatus(null);
        return;
      }
      const handle = await generateSheetSuggestion(next.id, null);
      job.current = handle;
      const generated = await handle.completion;
      adopt(generated);
      const review = await previewSheetSuggestion(controller, generated.id, generated.output);
      job.current = review;
      const reviewed = await review.completion;
      adopt(reviewed);
      setStatus(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const send = async (consentId: string) => {
    if (!prepared || busy || !prepared.outbound_preview.requires_consent) return;
    setBusy(true);
    setError(null);
    try {
      const handle = await generateSheetSuggestion(prepared.id, consentId);
      job.current = handle;
      const generated = await handle.completion;
      adopt(generated);
      const review = await previewSheetSuggestion(controller, generated.id, generated.output);
      job.current = review;
      const reviewed = await review.completion;
      adopt(reviewed);
      setStatus(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const acceptOutbound = (consentId: string) => {
    setReviewOpen(false);
    setConsentSent(true);
    void send(consentId);
  };

  const edit = (next: SheetAiOutput) => {
    setOutput(next);
    setEditing(true);
    setSuggestion((current) => current ? {
      ...current, preview: null, localized_formula: null, status: "previewing",
    } : current);
    setDiffPage(null);
    setReviewedAll(false);
    setStatus(null);
  };

  const preview = async () => {
    if (!suggestion || !output || busy) return;
    setBusy(true);
    setError(null);
    try {
      const handle = await previewSheetSuggestion(controller, suggestion.id, output);
      job.current = handle;
      const reviewed = await handle.completion;
      adopt(reviewed);
      setStatus(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!suggestion || busy || !acceptable()) return;
    setBusy(true);
    setError(null);
    try {
      await acceptSheetSuggestion(controller, suggestion.id);
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
    setBusy(false);
    setStatus(null);
    if (suggestion) setSuggestion({ ...suggestion, status: "cancelled" });
  };

  const discard = async () => {
    await job.current?.cancel().catch(() => undefined);
    job.current = null;
    const id = suggestion?.id ?? prepared?.id ?? null;
    if (id) await releaseSheetSuggestion(id).catch(() => undefined);
    liveId.current = null;
    setPrepared(null);
    setSuggestion(null);
    setOutput(null);
    setConsentSent(false);
    setReviewOpen(false);
    setEditing(false);
    setDiffPage(null);
    setDiffTrail([]);
    setReviewedAll(false);
    setStatus(null);
    setError(null);
  };

  const changeAction = async (next: SheetAiAction) => {
    if (next === action || busy) return;
    await discard();
    setAction(next);
  };

  const loadPage = (cursor: string | null, trail: (string | null)[]) => {
    if (!suggestion) return;
    try {
      const page = sheetSuggestionDiffPage(suggestion.id, cursor);
      setDiffPage(page);
      setDiffTrail(trail);
      if (page.complete) setReviewedAll(true);
    } catch (caught) {
      setError(caught);
    }
  };

  function acceptable(): boolean {
    const preview = suggestion?.preview;
    if (!suggestion || !preview || !preview.complete || preview.next_cursor !== null ||
        !preview.can_apply || preview.expires_unix <= nowUnix() ||
        suggestion.status === "cancelled") return false;
    if (suggestion.action === "clean" && !reviewedAll) return false;
    if (suggestion.action === "chart" && preview.renders.length === 0) return false;
    if (suggestion.action === "formula") {
      if (suggestion.output.schema_id !== "sheet.formula.v1") return false;
      const active = suggestion.context.selection.kind === "sheet" ? suggestion.context.selection.active : null;
      if (!active) return false;
      return sheetFormulaCalculated(preview, active, suggestion.output.canonical, {
        session_id: suggestion.context.session_id, context_id: suggestion.context.context_id,
        revision: suggestion.context.revision, content_id: suggestion.context.content_id,
      }, nowUnix());
    }
    return suggestion.action === "clean" || suggestion.action === "chart";
  }

  const calculation: OfficeProposalCalculation | null = (() => {
    if (!suggestion?.preview || suggestion.output.schema_id !== "sheet.formula.v1") return null;
    const formulaOutput = suggestion.output;
    const active = suggestion.context.selection.kind === "sheet" ? suggestion.context.selection.active : null;
    if (!active) return null;
    return suggestion.preview.calculations.find((entry) =>
      entry.address.sheet_id === active.sheet_id && entry.address.row === active.row &&
      entry.address.column === active.column && entry.canonical === formulaOutput.canonical) ?? null;
  })();

  const cleanOutput = output?.schema_id === "sheet.clean.v1" ? output : null;
  const duplicateOperation = cleanOutput?.operations.find(
    (operation): operation is Extract<SheetCleanOperation, { kind: "mark_duplicates" }> =>
      operation.kind === "mark_duplicates",
  ) ?? null;
  const chartOutput = output?.schema_id === "sheet.chart.v1" ? output : null;
  const formulaOutput = output?.schema_id === "sheet.formula.v1" ? output : null;
  const explainOutput = output?.schema_id === "sheet.explain.v1" ? output : null;
  const render = suggestion?.preview?.renders[0] ?? null;
  const unavailable = action === "describe";

  return (
    <section
      className="sheet-ai-panel"
      aria-label={t("sheetAi.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The consent host owns Escape while its modal review is open.
        if (reviewOpen) return;
        const element = event.target as HTMLElement;
        if (element.closest("input, textarea, select")) {
          event.preventDefault();
          element.blur();
          return;
        }
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2>{t("sheetAi.title")}</h2>
        <button type="button" aria-label={t("help.title")} onClick={() => onOpenHelp("ai-help-in-spreadsheets")}>?</button>
        <button type="button" aria-label={t("common.close")} onClick={onClose}>×</button>
      </header>

      <div role="toolbar" aria-label={t("sheetAi.title")}>
        {(Object.keys(ACTION_KEYS) as SheetAiAction[]).map((item) => (
          <button key={item} type="button" aria-pressed={action === item}
            disabled={item === "describe" || busy}
            title={item === "describe" ? t("errors.sheet_ai.failed") : undefined}
            onClick={() => void changeAction(item)}>
            {t(ACTION_KEYS[item])}
          </button>
        ))}
      </div>

      <label>
        <span>{t("sheetAi.request")}</span>
        <textarea ref={inputRef} value={text} maxLength={2000} disabled={busy}
          onChange={(event) => setText(event.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={header} disabled={busy} onChange={(event) => setHeader(event.target.checked)} />
        {t("sheetAi.header")}
      </label>

      <div>
        <button type="button" onClick={() => void start()} disabled={!request || busy || unavailable}>
          {t("sheetAi.generate")}
        </button>
        {busy ? <button type="button" onClick={() => void cancel()}>{t("sheetAi.cancel")}</button> : null}
        {prepared?.outbound_preview.requires_consent ? (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            disabled={busy || consentSent}
          >
            {t("assistant.send")}
          </button>
        ) : null}
        {suggestion?.preview ? (
          <button type="button" onClick={() => void accept()} disabled={busy || !acceptable()}>
            {t("sheetAi.accept")}
          </button>
        ) : null}
        {suggestion ? (
          <>
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>{t("sheetAi.edit")}</button>
            <button type="button" onClick={() => void preview()} disabled={busy || !output}>{t("sheetAi.retry")}</button>
            <button type="button" onClick={() => void discard()} disabled={busy}>{t("sheetAi.discard")}</button>
          </>
        ) : null}
      </div>

      {reviewOpen && prepared?.outbound_preview.requires_consent ? (
        <AssistantOutboundConsentHost
          key={prepared.outbound_preview.preview_id}
          preview={prepared.outbound_preview}
          onConsent={acceptOutbound}
          onCancel={() => setReviewOpen(false)}
        />
      ) : null}

      {formulaOutput ? (
        <>
          {editing ? (
            <label>
              <span>{t("sheetAi.canonical")}</span>
              <textarea value={formulaOutput.canonical} disabled={busy}
                onChange={(event) => edit({ ...formulaOutput, canonical: event.target.value })} />
            </label>
          ) : null}
          <SheetAiFormulaPreview canonical={formulaOutput.canonical}
            localized={suggestion?.localized_formula ?? null} calculation={calculation} />
        </>
      ) : null}

      {cleanOutput ? (
        <>
          {duplicateOperation ? (
            <>
              <label>
                <input type="checkbox" checked={duplicateOperation.clear_duplicate_values}
                  disabled={busy}
                  onChange={(event) => edit({
                    ...cleanOutput,
                    operations: cleanOutput.operations.map((operation) => operation.kind === "mark_duplicates"
                      ? { ...operation, clear_duplicate_values: event.target.checked } : operation),
                  })} />
                {t("sheetAi.clearDuplicates")}
              </label>
              {duplicateOperation.clear_duplicate_values ? null : <p>{t("sheetAi.duplicatesKept")}</p>}
            </>
          ) : null}
          {suggestion && suggestion.diffs.length > 0 && diffPage ? (
            <>
              <SheetAiCleaningGrid diffs={diffPage.items} />
              <div>
                <button type="button" disabled={busy || diffTrail.length === 0}
                  onClick={() => {
                    const trail = diffTrail.slice(0, -1);
                    loadPage(trail.at(-1) ?? null, trail);
                  }}>{t("extra_view.previous")}</button>
                <button type="button" disabled={busy || !diffPage.next_cursor}
                  onClick={() => loadPage(diffPage.next_cursor, [...diffTrail, diffPage.next_cursor])}>
                  {t("extra_view.next")}
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {chartOutput ? (
        <>
          {editing ? (
            <label>
              <span>{t("sheetAi.chart")}</span>
              <input type="text" maxLength={512} value={chartOutput.title} disabled={busy}
                onChange={(event) => edit({ ...chartOutput, title: event.target.value })} />
            </label>
          ) : null}
          <SheetAiChartPreview render={render} source={chartOutput.source} caption={chartOutput.title} />
        </>
      ) : null}

      {explainOutput ? (
        <section aria-label={t("sheetAi.explain")}>
          <p>{explainOutput.explanation}</p>
          <p>{explainOutput.function_ids.join(", ")}</p>
          <button type="button" onClick={() => {
            if (navigator.clipboard) void navigator.clipboard.writeText(explainOutput.explanation);
          }}>
            {t("sheetAi.copy")}
          </button>
        </section>
      ) : null}

      <p role="status" aria-live="polite">
        {busy ? t("sheetAi.progress") : status ? t(status) : ""}
      </p>
      {error ? <p role="alert">{errorText(t, error, area(error))}</p> : null}
    </section>
  );
}
