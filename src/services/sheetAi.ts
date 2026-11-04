import type { OfficeController } from "../office/OfficeController";
import type {
  OfficeAiContext, OfficeChart, OfficeProposalPreview, OfficeProposalRequest,
  OfficeTransactionResult,
} from "../office/types";
import {
  applyOfficeProposal, confirmOfficeProposal, previewOfficeProposal,
  releaseOfficeProposal,
} from "./officeAi";
import { prepareAssistantInference, startAssistantInference } from "./assistantInference";
import { parseOfficeFormula, officeFunctions } from "./officeEdit";
import { sheetFormulaCalculated } from "../office/sheet/ai/sheetFormulaSafety";
import { sheetFormulaProposal } from "../office/sheet/ai/sheetFormulaProposal";
import { applyTypedCleaning } from "../office/sheet/ai/cleaningTransforms";
import { sheetCleaningOperations } from "../office/sheet/ai/sheetCleaningProposal";
import { validateSheetChartSource } from "../office/sheet/ai/sheetChartProposal";
import { validateSheetExplanation } from "../office/sheet/ai/sheetDescription";
import { captureSheetSelection, releaseSheetSelection, sheetCellAt } from "../office/sheet/ai/sheetAiContext";
import {
  SHEET_AI_SCHEMA, SHEET_AI_TTL_SECONDS, deleteSheetAiRecord, emptySheetAiOutput,
  getSheetAiRecord, putSheetAiRecord, sheetAiJob, sheetAiNow, sheetAiTask,
  suggestionFromResult, validateSheetAiResult,
} from "../office/sheet/ai/sheetAiGeneration";
import type {
  SheetAiOutput, SheetAiPreparedRequest, SheetAiRequest, SheetAiSuggestion, SheetCleanDiff,
} from "../office/sheet/ai/sheetAiTypes";
import { validateSheetAiOutput, validateSheetAiRequest } from "../office/sheet/ai/sheetAiTypes";
import type { JobHandle } from "./jobs";

/** E2: prepare, generate, preview, accept and release one sheet suggestion.
 *
 * Generation uses the 17a selected backend through the native gateway; the
 * panel cannot mint consent and a local failure never retries on API. Every
 * proposal is evaluated by E21 and every apply needs the E22 foreground grant.
 * Describe stays unavailable until native-owned statistics exist: the model
 * may not invent totals. */

function sameState(controller: OfficeController, request: SheetAiRequest): void {
  const state = controller.getState();
  if (!state || controller.family !== "sheet" || state.family !== "sheet" ||
      !state.ready || state.busy || state.session_id !== request.session_id ||
      state.revision !== request.expected_revision ||
      state.content_id !== request.expected_content_id) {
    throw new Error("sheet_ai.changed");
  }
}

function liveContext(controller: OfficeController, request: SheetAiRequest): void {
  sameState(controller, request);
}

function requireRecord(id: string) {
  const record = getSheetAiRecord(id);
  if (!record) throw new Error("sheet_ai.changed");
  const now = sheetAiNow();
  if (record.suggestion.expires_unix <= now || record.suggestion.context.expires_unix <= now) {
    record.suggestion.status = "cancelled";
    throw new Error("sheet_ai.changed");
  }
  return record;
}

function requestFor(
  context: OfficeAiContext, intent: OfficeProposalRequest["intent"],
  operations: OfficeProposalRequest["operations"],
): OfficeProposalRequest {
  return {
    context_id: context.context_id,
    expected_revision: context.revision,
    expected_content_id: context.content_id,
    intent,
    operations,
    label_key: "office.transaction",
  };
}

async function supportedFunctions(controller: OfficeController): Promise<Set<string>> {
  const supported = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await officeFunctions(controller.session_id, "en-US", cursor);
    page.items.forEach((fn) => supported.add(fn.id));
    if (page.complete) break;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error("sheet_ai.failed");
    cursor = page.next_cursor;
    cursors.add(cursor);
  }
  return supported;
}

/** Capture the exact E20 selection and describe the outbound payload. API
 * mode still needs a separate one-shot Send; nothing is sent here. */
export async function prepareSheetSuggestion(
  controller: OfficeController,
  request: SheetAiRequest,
): Promise<SheetAiPreparedRequest> {
  const validated = validateSheetAiRequest(request);
  if (validated.action === "describe") {
    // E20 has no app-owned statistic IDs/values; refusing avoids a plausible
    // but ungrounded description.
    throw new Error("sheet_ai.failed");
  }
  sameState(controller, validated);
  const context = await captureSheetSelection(controller, validated);
  try {
    const range = validated.selection;
    if (validated.action === "formula") {
      const target = validated.target;
      const cell = target ? sheetCellAt(context, target.row, target.column) : null;
      if (!target || !cell?.editable) throw new Error("sheet_ai.invalid");
    }
    if (validated.action === "explain") {
      const single = range.first_row === range.last_row && range.first_column === range.last_column;
      const cell = single ? sheetCellAt(context, range.first_row, range.first_column) : null;
      if (!single || cell?.input.kind !== "formula") throw new Error("sheet_ai.invalid");
    }
    const task = sheetAiTask(validated, context);
    const outbound = await prepareAssistantInference(task);
    if (outbound.requires_consent && outbound.sources.length === 0) {
      // The selected cells live in a bounded prompt excerpt, not in an
      // AiInputRef, so native cannot show them in the exact outbound review.
      // Without that review an API/local-server send is refused.
      await releaseSheetSelection(context.context_id);
      throw new Error("sheet_ai.failed");
    }
    const expires = Math.min(
      sheetAiNow() + SHEET_AI_TTL_SECONDS, context.expires_unix, outbound.expires_unix,
    );
    const id = crypto.randomUUID();
    const suggestion: SheetAiSuggestion = {
      id, action: validated.action, context, output: emptySheetAiOutput(validated.action),
      diffs: [], preview: null, localized_formula: null, status: "awaiting_send",
      model_id: outbound.model_id, model_revision: "",
      request_revision: validated.request_revision, expires_unix: expires,
    };
    putSheetAiRecord({ suggestion, request: validated, task, outbound, created_unix: sheetAiNow() });
    return { id, request: validated, context_id: context.context_id, outbound_preview: outbound, expires_unix: expires };
  } catch (error) {
    await releaseSheetSelection(context.context_id);
    throw error;
  }
}

/** Start the selected backend. A missing provider or disabled assistant fails
 * closed; this function never fabricates a result or tries the other backend. */
export async function generateSheetSuggestion(
  preparedId: string,
  outboundConsentId: string | null,
): Promise<JobHandle<SheetAiSuggestion>> {
  const record = requireRecord(preparedId);
  if (record.outbound.requires_consent && !outboundConsentId) {
    throw new Error("sheet_ai.invalid");
  }
  if (!record.outbound.requires_consent && outboundConsentId !== null) {
    throw new Error("sheet_ai.invalid");
  }
  record.suggestion.status = "generating";
  const handle = await startAssistantInference(record.task, outboundConsentId);
  const completion = (async (): Promise<SheetAiSuggestion> => {
    try {
      const result = await handle.completion;
      const output = validateSheetAiResult(result, record.request);
      record.suggestion = suggestionFromResult(
        record.suggestion.id, record.request, record.suggestion.context,
        output, result, record.suggestion.expires_unix,
      );
      return record.suggestion;
    } catch (error) {
      record.suggestion.status = "error";
      throw error;
    }
  })();
  return sheetAiJob(handle.id, handle.cancel, completion);
}

function formulaCalculation(
  request: SheetAiRequest, suggestion: SheetAiSuggestion, preview: OfficeProposalPreview, canonical: string,
): boolean {
  const target = request.target;
  if (!target) return false;
  return sheetFormulaCalculated(preview, target, canonical, {
    session_id: suggestion.context.session_id,
    context_id: suggestion.context.context_id,
    revision: suggestion.context.revision,
    content_id: suggestion.context.content_id,
  }, sheetAiNow());
}

/** Rebuild every derived artifact from the edited typed output. Editing any
 * value invalidates the old preview and requires this call again. */
export async function previewSheetSuggestion(
  controller: OfficeController,
  suggestionId: string,
  edited: SheetAiOutput,
): Promise<JobHandle<SheetAiSuggestion>> {
  const record = requireRecord(suggestionId);
  const suggestion = record.suggestion;
  liveContext(controller, record.request);
  const output = validateSheetAiOutput(edited);
  if (output.schema_id !== SHEET_AI_SCHEMA[suggestion.action]) throw new Error("sheet_ai.invalid");
  suggestion.output = output;
  suggestion.diffs = [];
  suggestion.preview = null;
  suggestion.localized_formula = null;
  suggestion.status = "previewing";

  let inner: JobHandle<OfficeProposalPreview> | null = null;
  const settle = (updated: SheetAiSuggestion) => {
    record.suggestion = updated;
    return updated;
  };
  const completion = (async (): Promise<SheetAiSuggestion> => {
    if (output.schema_id === "sheet.formula.v1" && suggestion.action === "formula") {
      const result = await sheetFormulaProposal(
        controller, record.request, suggestion.context, output, "office.transaction",
      );
      inner = result.job;
      const preview = await result.job.completion;
      const calculated = formulaCalculation(record.request, suggestion, preview, output.canonical);
      return settle({
        ...suggestion, localized_formula: result.localized_formula, preview,
        status: calculated ? "ready" : "previewing",
      });
    }
    if (output.schema_id === "sheet.clean.v1" && suggestion.action === "clean") {
      const diffs = applyTypedCleaning(suggestion.context.cells, record.request.selection, output.operations);
      const operations = sheetCleaningOperations(diffs);
      if (operations.length === 0) {
        return settle({ ...suggestion, diffs, preview: null, status: "ready" });
      }
      const job = await previewOfficeProposal(
        controller, suggestion.context, requestFor(suggestion.context, "sheet_clean", operations),
      );
      inner = job;
      const preview = await job.completion;
      return settle({
        ...suggestion, diffs, preview, status: preview.can_apply ? "ready" : "previewing",
      });
    }
    if (output.schema_id === "sheet.chart.v1" && suggestion.action === "chart") {
      validateSheetChartSource(output, record.request.selection, suggestion.context.cells);
      const chart: OfficeChart = {
        id: crypto.randomUUID(), kind: output.kind,
        source: { kind: "range", range: { ...output.source }, headers: output.headers },
        title: output.title, legend: false,
        rect: { x_pt: 0, y_pt: 0, width_pt: 480, height_pt: 300, rotation_deg: 0 },
      };
      const job = await previewOfficeProposal(controller, suggestion.context, requestFor(
        suggestion.context, "sheet_chart",
        [{ family: "sheet", operation: { kind: "upsert_chart", chart } }],
      ));
      inner = job;
      const preview = await job.completion;
      const rendered = preview.renders.length > 0;
      return settle({
        ...suggestion, preview, status: rendered && preview.can_apply ? "ready" : "previewing",
      });
    }
    if (output.schema_id === "sheet.explain.v1" && suggestion.action === "explain") {
      const cell = sheetCellAt(
        suggestion.context, record.request.selection.first_row, record.request.selection.first_column,
      );
      if (cell?.input.kind !== "formula") throw new Error("sheet_ai.changed");
      const parsed = await parseOfficeFormula(controller.session_id, cell.input.canonical, "en-US");
      if (!parsed.valid) throw new Error("sheet_ai.changed");
      validateSheetExplanation(output, [record.request.selection], new Set(parsed.functions));
      const supported = await supportedFunctions(controller);
      if (output.function_ids.some((id) => !supported.has(id))) throw new Error("sheet_ai.invalid");
      return settle({ ...suggestion, preview: null, status: "ready" });
    }
    throw new Error("sheet_ai.invalid");
  })();
  return {
    id: suggestion.id,
    cancel: async () => {
      await inner?.cancel().catch(() => undefined);
    },
    completion,
  };
}

/** E22: only the explicit foreground Accept reaches this function. One grant,
 * one atomic transaction and one Undo. Read-only outputs have no apply path. */
export async function acceptSheetSuggestion(
  controller: OfficeController,
  suggestionId: string,
): Promise<OfficeTransactionResult> {
  const record = requireRecord(suggestionId);
  const suggestion = record.suggestion;
  if (suggestion.action === "explain" || suggestion.action === "describe") {
    throw new Error("sheet_ai.invalid");
  }
  const preview = suggestion.preview;
  liveContext(controller, record.request);
  if (!preview || !preview.complete || preview.next_cursor !== null || !preview.can_apply ||
      preview.expires_unix <= sheetAiNow() || preview.session_id !== controller.session_id ||
      preview.revision !== suggestion.context.revision ||
      preview.content_id !== suggestion.context.content_id ||
      preview.context_id !== suggestion.context.context_id ||
      preview.intent !== (suggestion.action === "formula" ? "sheet_formula" :
        suggestion.action === "clean" ? "sheet_clean" : "sheet_chart")) {
    throw new Error("sheet_ai.changed");
  }
  if (suggestion.action === "formula") {
    if (suggestion.output.schema_id !== "sheet.formula.v1" ||
        !formulaCalculation(record.request, suggestion, preview, suggestion.output.canonical)) {
      throw new Error("sheet_ai.calculation");
    }
  }
  if (suggestion.action === "chart" && preview.renders.length === 0) {
    throw new Error("sheet_ai.failed");
  }
  suggestion.status = "applying";
  const grant = await confirmOfficeProposal(preview.preview_id);
  const result = await applyOfficeProposal({
    preview_id: preview.preview_id,
    transaction_id: crypto.randomUUID(),
    expected_revision: preview.revision,
    expected_content_id: preview.content_id,
    acknowledged_warning_ids: preview.warnings.map((warning) => warning.id),
    human_confirmation_id: grant.human_confirmation_id,
  });
  suggestion.status = "applied";
  await releaseOfficeProposal(preview.preview_id).catch(() => undefined);
  return result;
}

/** Idempotent release; no cell values are saved, logged or uploaded. */
export async function releaseSheetSuggestion(id: string): Promise<void> {
  const record = getSheetAiRecord(id);
  if (!record) return;
  if (record.suggestion.preview) {
    await releaseOfficeProposal(record.suggestion.preview.preview_id).catch(() => undefined);
  }
  await releaseSheetSelection(record.suggestion.context.context_id);
  deleteSheetAiRecord(id);
}

export interface SheetDiffPage {
  items: SheetCleanDiff[];
  next_cursor: string | null;
  complete: boolean;
  total: number;
}

/** Local, bounded paging of the reviewed cleaning diffs. It is not an IPC
 * page; the full set is retained in the suggestion and never truncated. */
export function sheetSuggestionDiffPage(
  id: string, cursor: string | null, limit = 100,
): SheetDiffPage {
  const record = getSheetAiRecord(id);
  if (!record) throw new Error("sheet_ai.changed");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("sheet_ai.invalid");
  const start = cursor === null ? 0 : Number(cursor);
  if (!Number.isSafeInteger(start) || start < 0 || String(start) !== cursor) throw new Error("sheet_ai.invalid");
  const diffs = record.suggestion.diffs;
  if (diffs.length > 2000 || start > diffs.length) throw new Error("sheet_ai.invalid");
  const end = Math.min(start + limit, diffs.length);
  return {
    items: diffs.slice(start, end).map((diff) => structuredClone(diff)),
    next_cursor: end < diffs.length ? String(end) : null,
    complete: end === diffs.length,
    total: diffs.length,
  };
}
