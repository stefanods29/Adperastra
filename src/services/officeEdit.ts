import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PageRange } from "../convert/types";
import type { ExportSnapshot } from "./exportSnapshots";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";
import type {
  DocumentStatistics, OfficeDiscardSavedResult, OfficeFamily, OfficeFindMatch,
  OfficeFindRequest, OfficeFormatting, OfficeFormulaLocale, OfficeFunction,
  OfficeItemKind, OfficeItemPage, OfficeMode, OfficeRenderPage, OfficeResultPage,
  OfficeSelection, OfficeSessionState, OfficeSpellingIssue, OfficeTransaction,
  OfficeTransactionResult, OfficeViewport, ParsedOfficeFormula,
  SheetPrintSettings, TextSpan,
} from "../office/types";

function requireRuntime(): void {
  if (!isTauriRuntime()) throw new Error("office_edit.engine_missing");
}

/** Frozen native command names consumed by this service (20a E2-E19).
 * `office_edit_state`, `office_edit_items`, `office_edit_formatting` and
 * `office_edit_discard_saved` close the command-name gaps in the original
 * guide. Registration/allowlisting stays with the coordinator; without an
 * approved binding every command fails closed, never with a fake result. */

export async function openOfficeEdit(documentId: string, family: OfficeFamily): Promise<JobHandle<OfficeSessionState>> {
  requireRuntime();
  return runJob("officeopen", (requestId) => invoke("office_edit_open_start", { requestId, documentId, family }));
}

export async function closeOfficeEdit(sessionId: string): Promise<void> {
  requireRuntime();
  await invoke("office_edit_close", { sessionId });
}

export async function transactOffice(sessionId: string, transaction: OfficeTransaction): Promise<OfficeTransactionResult> {
  requireRuntime();
  return invoke("office_edit_transact", { sessionId, transaction });
}

export async function undoOffice(sessionId: string, expectedRevision: number, transactionId: string): Promise<OfficeTransactionResult> {
  requireRuntime();
  return invoke("office_edit_undo", { sessionId, expectedRevision, transactionId });
}

export async function redoOffice(sessionId: string, expectedRevision: number, transactionId: string): Promise<OfficeTransactionResult> {
  requireRuntime();
  return invoke("office_edit_redo", { sessionId, expectedRevision, transactionId });
}

export async function setOfficeMode(sessionId: string, mode: OfficeMode): Promise<OfficeSessionState> {
  requireRuntime();
  return invoke("office_edit_mode", { sessionId, mode });
}

/** Typed atomic saved-content restore. The exact current identity and public
 * revision are sent so a stale tab cannot discard a newer model; native
 * restores the saved content or refuses with `office_edit.changed`. */
export async function discardOfficeSaved(
  sessionId: string,
  savedContentId: string,
  expectedRevision: number,
  expectedContentId: string,
): Promise<OfficeDiscardSavedResult> {
  requireRuntime();
  return invoke("office_edit_discard_saved", {
    sessionId, savedContentId, expectedRevision, expectedContentId,
  });
}

export async function officeState(sessionId: string): Promise<OfficeSessionState> {
  requireRuntime();
  return invoke("office_edit_state", { sessionId });
}

export async function officeItems(
  sessionId: string, kind: OfficeItemKind, cursor?: string,
): Promise<OfficeItemPage> {
  requireRuntime();
  return invoke("office_edit_items", { sessionId, kind, cursor });
}

export async function officeFormatting(
  sessionId: string, selection: OfficeSelection,
): Promise<OfficeFormatting> {
  requireRuntime();
  return invoke("office_edit_formatting", { sessionId, selection });
}

export async function onOfficeState(listener: (state: OfficeSessionState) => void): Promise<UnlistenFn> {
  requireRuntime();
  return listen<OfficeSessionState>("office-edit-state", (event) => listener(event.payload));
}

export async function renderOffice(sessionId: string, viewport: OfficeViewport): Promise<JobHandle<OfficeResultPage<OfficeRenderPage>>> {
  requireRuntime();
  return runJob("officerender", (requestId) => invoke("office_edit_render_start", { requestId, sessionId, viewport }));
}

export async function captureOffice(sessionId: string, expectedRevision: number): Promise<JobHandle<ExportSnapshot>> {
  requireRuntime();
  return runJob("officecap", (requestId) => invoke("office_edit_capture_start", { requestId, sessionId, expectedRevision }));
}

export async function exportOffice(
  sessionId: string, expectedRevision: number, format: "pdf" | "png" | "jpeg", ranges: PageRange[],
): Promise<JobHandle<ExportSnapshot>> {
  requireRuntime();
  return runJob("officeexport", (requestId) => invoke("office_edit_export_start", { requestId, sessionId, expectedRevision, format, ranges }));
}

export async function parseOfficeFormula(sessionId: string, text: string, locale: OfficeFormulaLocale): Promise<ParsedOfficeFormula> {
  requireRuntime();
  return invoke("office_edit_formula_parse", { sessionId, text, locale });
}

export async function formatOfficeFormula(sessionId: string, canonical: string, locale: OfficeFormulaLocale): Promise<string> {
  requireRuntime();
  return invoke("office_edit_formula_format", { sessionId, canonical, locale });
}

export async function findOffice(sessionId: string, query: OfficeFindRequest, cursor?: string): Promise<OfficeResultPage<OfficeFindMatch>> {
  requireRuntime();
  return invoke("office_edit_find", { sessionId, query, cursor });
}

export async function officeSpelling(sessionId: string, span: TextSpan, cursor?: string): Promise<OfficeResultPage<OfficeSpellingIssue>> {
  requireRuntime();
  return invoke("office_edit_spelling", { sessionId, span, cursor });
}

export async function readDocumentStatistics(sessionId: string): Promise<DocumentStatistics> {
  requireRuntime();
  return invoke("office_edit_document_stats", { sessionId });
}

export async function officeFunctions(sessionId: string, locale: OfficeFormulaLocale, cursor?: string): Promise<OfficeResultPage<OfficeFunction>> {
  requireRuntime();
  return invoke("office_edit_functions", { sessionId, locale, cursor });
}

export async function releaseOfficeLease(leaseId: string): Promise<void> {
  requireRuntime();
  await invoke("office_edit_release_lease", { leaseId });
}

export async function printOffice(
  sessionId: string, expectedRevision: number, ranges: readonly PageRange[], sheetSettings?: SheetPrintSettings,
): Promise<JobHandle<void>> {
  requireRuntime();
  return runJob("officeprint", (requestId) => invoke("office_edit_print_start", { requestId, sessionId, expectedRevision, ranges, sheetSettings }));
}
