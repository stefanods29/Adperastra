import type { CellAddress, OfficeProposalPreview } from "../../types";

const blocked = new Set(["DDE", "WEBSERVICE", "RTD", "HYPERLINK", "RAND", "RANDBETWEEN", "NOW", "TODAY"]);
/** Supplement only: E21 must independently inspect AST references and dependency closure. */
export function checkSheetFormulaFunctions(functions: readonly string[], supported: ReadonlySet<string>): void {
  for (const id of functions) {
    if (blocked.has(id) || !supported.has(id)) throw new Error("sheet_ai.unsafe_formula");
  }
}
export function sheetFormulaCalculated(
  preview: OfficeProposalPreview, target: CellAddress, canonical: string,
  expected: { session_id: string; context_id: string; revision: number; content_id: string }, nowUnix: number,
): boolean {
  if (!Number.isFinite(nowUnix) || preview.session_id !== expected.session_id || preview.context_id !== expected.context_id ||
      preview.revision !== expected.revision || preview.content_id !== expected.content_id ||
      preview.intent !== "sheet_formula" || !preview.complete || preview.next_cursor !== null || !preview.can_apply ||
      preview.expires_unix <= nowUnix) return false;
  const results = preview.calculations.filter(c => c.address.sheet_id === target.sheet_id &&
    c.address.row === target.row && c.address.column === target.column && c.canonical === canonical);
  return results.length === 1 && results[0].deterministic && results[0].error_code === null &&
    (results[0].result as { kind: string }).kind !== "formula" &&
    (results[0].result.kind !== "number" || Number.isFinite(results[0].result.value));
}
