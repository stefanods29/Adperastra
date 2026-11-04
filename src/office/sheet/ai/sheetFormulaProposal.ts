import type { OfficeController } from "../../OfficeController";
import type { OfficeAiContext, OfficeProposalPreview, OfficeProposalRequest } from "../../types";
import type { JobHandle } from "../../../services/jobs";
import { parseOfficeFormula, formatOfficeFormula, officeFunctions } from "../../../services/officeEdit";
import { evaluateOfficeProposal } from "../../../services/officeAi";
import { checkSheetFormulaFunctions } from "./sheetFormulaSafety";
import { validateSheetAiOutput, validateSheetAiRequest } from "./sheetAiTypes";
import type { SheetAiRequest, SheetFormulaOutput } from "./sheetAiTypes";

/** Preflight plus E21 only. Does not grant Apply or claim that parsing calculated anything. */
export async function sheetFormulaProposal(
  controller: OfficeController, request: SheetAiRequest, context: OfficeAiContext,
  output: SheetFormulaOutput, labelKey: OfficeProposalRequest["label_key"],
): Promise<{ localized_formula: string; job: JobHandle<OfficeProposalPreview> }> {
  request = validateSheetAiRequest(request);
  const checkedOutput = validateSheetAiOutput(output);
  if (checkedOutput.schema_id !== "sheet.formula.v1") throw new Error("sheet_ai.invalid");
  output = checkedOutput;
  const current = controller.getState();
  if (request.action !== "formula" || !request.target || context.family !== "sheet" || !context.complete ||
      context.truncated || context.next_cursor !== null || context.expires_unix <= Date.now() / 1000 ||
      current.session_id !== request.session_id || context.session_id !== request.session_id ||
      context.revision !== request.expected_revision || context.content_id !== request.expected_content_id ||
      current.revision !== context.revision || current.content_id !== context.content_id) throw new Error("sheet_ai.changed");
  const target = request.target;
  if (context.selection.kind !== "sheet" || context.selection.ranges.length !== 1) throw new Error("sheet_ai.invalid");
  const captured = context.selection.ranges[0];
  if (captured.sheet_id !== request.selection.sheet_id || captured.first_row !== request.selection.first_row ||
      captured.last_row !== request.selection.last_row || captured.first_column !== request.selection.first_column ||
      captured.last_column !== request.selection.last_column) throw new Error("sheet_ai.changed");
  const targetCell = context.cells.find(c => c.address.sheet_id === target.sheet_id &&
    c.address.row === target.row && c.address.column === target.column);
  if (!targetCell?.editable) throw new Error("sheet_ai.invalid");
  const parsed = await parseOfficeFormula(request.session_id, output.canonical, "en-US");
  if (!parsed.valid || parsed.canonical !== output.canonical) throw new Error("sheet_ai.unsafe_formula");
  const supported = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await officeFunctions(request.session_id, "en-US", cursor);
    page.items.forEach(fn => supported.add(fn.id));
    if (page.complete) break;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error("sheet_ai.failed");
    cursor = page.next_cursor;
    cursors.add(cursor);
  }
  checkSheetFormulaFunctions(parsed.functions, supported);
  const locale = request.locale === "es" ? "es-419" : "en-US";
  const localized_formula = await formatOfficeFormula(request.session_id, parsed.canonical, locale);
  const roundtrip = await parseOfficeFormula(request.session_id, localized_formula, locale);
  if (!roundtrip.valid || roundtrip.canonical !== parsed.canonical) throw new Error("sheet_ai.unsafe_formula");
  const state = controller.getState();
  if (state.revision !== context.revision || state.content_id !== context.content_id || context.expires_unix <= Date.now() / 1000)
    throw new Error("sheet_ai.changed");
  // Native E21 validates the parsed reference/dependency closure independently of model-provided ranges.
  const job = await evaluateOfficeProposal(request.session_id, { context_id: context.context_id,
    expected_revision: context.revision, expected_content_id: context.content_id, intent: "sheet_formula", label_key: labelKey,
    operations: [{ family: "sheet", operation: { kind: "set_cells", mode: "formulas",
      range: { sheet_id: target.sheet_id, first_row: target.row, last_row: target.row,
        first_column: target.column, last_column: target.column }, values: [[{ kind: "formula", canonical: parsed.canonical }]] } }] });
  return { localized_formula, job };
}
