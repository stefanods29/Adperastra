import type { AssistantOutboundPreview } from "../../../assistant/types";
import type { AiTaskRequest, AiTaskResult } from "../../../services/localAiTypes";
import { newRequestId, type JobHandle } from "../../../services/jobs";
import type { CellRange, OfficeAiContext } from "../../types";
import { sheetRangeContains, validateSheetAiOutput } from "./sheetAiTypes";
import type { SheetAiAction, SheetAiOutput, SheetAiRequest, SheetAiSuggestion } from "./sheetAiTypes";
import { sheetSelectionExcerpt } from "./sheetAiContext";

/** Provider task and record store for sheet suggestions (ai-sheet-1 T3).
 *
 * The model receives one typed selected-cell excerpt prepared from the E20
 * capture and the user's own request. No workbook input reference, path,
 * whole-sheet snapshot or second backend is attached. The native gateway
 * validates the registered schema and selects local or API; a failure never
 * falls back to another backend. */

export const SHEET_AI_SCHEMA: Readonly<Record<SheetAiAction, string>> = {
  formula: "sheet.formula.v1",
  explain: "sheet.explain.v1",
  clean: "sheet.clean.v1",
  chart: "sheet.chart.v1",
  describe: "sheet.describe.v1",
};

export const SHEET_AI_TTL_SECONDS = 300;

export function sheetAiNow(): number {
  return Math.floor(Date.now() / 1000);
}

export interface SheetAiRecord {
  suggestion: SheetAiSuggestion;
  request: SheetAiRequest;
  task: AiTaskRequest;
  outbound: AssistantOutboundPreview;
  created_unix: number;
}

const records = new Map<string, SheetAiRecord>();

export function putSheetAiRecord(record: SheetAiRecord): void {
  records.set(record.suggestion.id, record);
}

export function getSheetAiRecord(id: string): SheetAiRecord | undefined {
  return records.get(id);
}

export function deleteSheetAiRecord(id: string): void {
  records.delete(id);
}

export function clearSheetAiRecordsForTest(): void {
  records.clear();
}

export function sheetAiRecordCount(): number {
  return records.size;
}

/** A real task for the canonical 17a gateway. `inputs` stays empty: the only
 * sheet data is the bounded excerpt argument built from the E20 capture. */
export function sheetAiTask(request: SheetAiRequest, context: OfficeAiContext): AiTaskRequest {
  const schema = SHEET_AI_SCHEMA[request.action];
  const excerpt = sheetSelectionExcerpt(context, request);
  return {
    request_id: newRequestId("sheetai"),
    task: "structured_text",
    locale: request.locale,
    inputs: [],
    prompt: {
      template_id: schema,
      template_revision: 1,
      arguments: [
        { name: "request", value: request.request, trust: "user" },
        { name: "selection", value: excerpt, trust: "source" },
      ],
      output_schema_id: schema,
    },
    options: { kind: "structured_text", max_output_tokens: 1024, temperature: 0, seed: 0 },
  };
}

function inside(range: CellRange, value: CellRange): boolean {
  return sheetRangeContains(range, value);
}

/** Validate the exact typed output for this action before any diff, clone or
 * apply exists. Model prose is never treated as a calculated value. */
export function validateSheetAiResult(result: AiTaskResult, request: SheetAiRequest): SheetAiOutput {
  if (result.task !== "structured_text" || result.result.kind !== "structured") {
    throw new Error("sheet_ai.failed");
  }
  const schema = SHEET_AI_SCHEMA[request.action];
  if (result.result.schema_id !== schema) throw new Error("sheet_ai.invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.result.canonical_json);
  } catch {
    throw new Error("sheet_ai.invalid");
  }
  const output = validateSheetAiOutput(parsed);
  if (output.schema_id !== schema) throw new Error("sheet_ai.invalid");
  const range = request.selection;
  switch (output.schema_id) {
    case "sheet.formula.v1":
      if (output.referenced_ranges.some((entry) => !inside(range, entry))) throw new Error("sheet_ai.invalid");
      break;
    case "sheet.explain.v1":
      if (output.cited_ranges.some((entry) => !inside(range, entry))) throw new Error("sheet_ai.invalid");
      break;
    case "sheet.clean.v1":
      {
        const width = range.last_column - range.first_column + 1;
        for (const operation of output.operations) {
          const columns = operation.kind === "mark_duplicates" ? operation.key_columns : operation.columns;
          if (columns.some((column) => column < 0 || column >= width)) throw new Error("sheet_ai.invalid");
        }
      }
      break;
    case "sheet.chart.v1":
      if (!inside(range, output.source)) throw new Error("sheet_ai.invalid");
      break;
    case "sheet.describe.v1":
      if (output.cited_ranges.some((entry) => !inside(range, entry)) ||
          output.statistic_ids.length !== 0) {
        // E20 exposes no app-owned statistic IDs; a model must not invent them.
        throw new Error("sheet_ai.invalid");
      }
      break;
  }
  return output;
}

/** Placeholder so an awaiting-send record has the contract's shape. It is
 * never rendered as a suggestion and never passes the output validator. */
export function emptySheetAiOutput(action: SheetAiAction): SheetAiOutput {
  switch (action) {
    case "formula":
      return { schema_id: "sheet.formula.v1", canonical: "", explanation: "", referenced_ranges: [] };
    case "explain":
      return { schema_id: "sheet.explain.v1", explanation: "", function_ids: [], cited_ranges: [] };
    case "clean":
      return { schema_id: "sheet.clean.v1", operations: [], explanation: "" };
    case "chart":
      return {
        schema_id: "sheet.chart.v1", kind: "column",
        source: { sheet_id: "", first_row: 0, last_row: 0, first_column: 0, last_column: 0 },
        headers: true, title: "", explanation: "",
      };
    case "describe":
      return { schema_id: "sheet.describe.v1", text: "", cited_ranges: [], statistic_ids: [] };
  }
}

export function suggestionFromResult(
  id: string,
  request: SheetAiRequest,
  context: OfficeAiContext,
  output: SheetAiOutput,
  result: AiTaskResult,
  expiresUnix: number,
): SheetAiSuggestion {
  return {
    id,
    action: request.action,
    context,
    output,
    diffs: [],
    preview: null,
    localized_formula: null,
    status: "ready",
    model_id: result.model_id,
    model_revision: result.model_revision,
    request_revision: request.request_revision,
    expires_unix: expiresUnix,
  };
}

export function sheetAiJob<T>(id: string, cancel: () => Promise<void>, completion: Promise<T>): JobHandle<T> {
  return { id, cancel, completion };
}
