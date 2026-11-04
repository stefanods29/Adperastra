import { invoke } from "@tauri-apps/api/core";
import type { OfficeController } from "../office/OfficeController";
import type {
  OfficeAiContext, OfficeAiContextRequest, OfficeFamily, OfficeProposalApplyRequest,
  OfficeProposalIntent, OfficeProposalPreview, OfficeProposalRequest, OfficeSelection,
  OfficeTransactionResult,
} from "../office/types";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** AI context and proposal boundary (20a E20-E22, office-ai-proposal-1).
 *
 * These wrappers transport typed requests only. They never generate a
 * proposal, calculate a formula, render a clone or apply an operation in
 * JavaScript: native returns the real result or an error. Without the
 * approved engine every call fails closed with `office_edit.engine_missing`.
 *
 * Every request is rebuilt from its exact canonical fields before `invoke`,
 * so a caller cannot smuggle a path, whole-document flag, trust override or
 * source bytes into the native boundary. AI consumers bind a live
 * revision/content/selection with `bindOfficeAiContext`, preview it with
 * `previewOfficeProposal`, cancel with `cancelOfficeProposal` and apply only
 * the native preview with `applyOfficeProposal`. The native human grant is
 * never minted here. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CONTEXT_SCALARS = 24_000;
const MAX_OPERATIONS = 1_000;
const MAX_WARNINGS = 32;
const MAX_SELECTION_SLIDES = 30;
const MAX_SELECTION_CELLS = 2_000;

const PROPOSAL_INTENTS: readonly OfficeProposalIntent[] = [
  "document_rewrite", "document_insert", "image_alt",
  "sheet_formula", "sheet_clean", "sheet_chart",
  "deck_create", "deck_add", "deck_shorten", "deck_notes", "deck_layout",
];

/** Optional capture limits. The caller cannot widen the native caps. */
export interface OfficeAiCaptureOptions {
  max_scalars?: number;
  include_images?: boolean;
}

function invalid(): never {
  throw new Error("office_edit.invalid");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function only(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).every((key) => keys.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function safeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function offset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

function requireRuntime(): void {
  if (!isTauriRuntime()) throw new Error("office_edit.engine_missing");
}

function position(value: unknown): boolean {
  return exact(value, ["block_id", "offset_utf16"]) &&
    uuid(value.block_id) && offset(value.offset_utf16);
}

function textSpan(value: unknown, revision: number): boolean {
  return exact(value, ["anchor", "focus", "revision"]) &&
    position(value.anchor) && position(value.focus) && value.revision === revision;
}

function sheetRange(value: unknown): boolean {
  if (!exact(value, ["sheet_id", "first_row", "last_row", "first_column", "last_column"])) return false;
  const firstRow = value.first_row;
  const lastRow = value.last_row;
  const firstColumn = value.first_column;
  const lastColumn = value.last_column;
  if (!uuid(value.sheet_id) || !offset(firstRow) || !offset(lastRow) ||
      !offset(firstColumn) || !offset(lastColumn)) return false;
  if (firstRow > lastRow || firstColumn > lastColumn) return false;
  if (lastRow > 1_048_575 || lastColumn > 16_383) return false;
  const rows = lastRow - firstRow + 1;
  const columns = lastColumn - firstColumn + 1;
  return rows <= 500 && columns <= 100 && rows * columns <= MAX_SELECTION_CELLS;
}

function address(value: unknown): boolean {
  if (!exact(value, ["sheet_id", "row", "column"])) return false;
  const row = value.row;
  const column = value.column;
  return uuid(value.sheet_id) && offset(row) && offset(column) &&
    row <= 1_048_575 && column <= 16_383;
}

function insideRange(active: Record<string, unknown>, range: Record<string, unknown>): boolean {
  return active.sheet_id === range.sheet_id &&
    (active.row as number) >= (range.first_row as number) &&
    (active.row as number) <= (range.last_row as number) &&
    (active.column as number) >= (range.first_column as number) &&
    (active.column as number) <= (range.last_column as number);
}

/** Validate the exact live scope of one capture. A missing selection, a
 * selection from another family/revision and an unbounded whole-sheet or
 * whole-deck shortcut are refused before any request exists. */
function validSelection(value: unknown, family: OfficeFamily, revision: number): value is OfficeSelection {
  if (!record(value) || value.kind !== family) return false;
  if (family === "document") {
    return exact(value, ["kind", "span", "page"]) &&
      textSpan(value.span, revision) &&
      offset(value.page) && (value.page as number) >= 1;
  }
  if (family === "sheet") {
    if (!exact(value, ["kind", "ranges", "active"])) return false;
    if (!Array.isArray(value.ranges) || value.ranges.length !== 1 ||
        !sheetRange(value.ranges[0]) || !address(value.active)) return false;
    return insideRange(
      value.active as Record<string, unknown>,
      value.ranges[0] as Record<string, unknown>,
    );
  }
  if (!exact(value, ["kind", "slide_ids", "shape_ids", "text_span"])) return false;
  const slides = value.slide_ids;
  const shapes = value.shape_ids;
  if (!Array.isArray(slides) || slides.length < 1 || slides.length > MAX_SELECTION_SLIDES ||
      slides.some((id) => !uuid(id)) || new Set(slides).size !== slides.length) return false;
  if (!Array.isArray(shapes) || shapes.length > 100 ||
      shapes.some((id) => !uuid(id)) || new Set(shapes).size !== shapes.length) return false;
  return value.text_span === null || textSpan(value.text_span, revision);
}

function familyOfIntent(intent: OfficeProposalIntent): OfficeFamily {
  if (intent === "document_rewrite" || intent === "document_insert" || intent === "image_alt") return "document";
  if (intent === "sheet_formula" || intent === "sheet_clean" || intent === "sheet_chart") return "sheet";
  return "deck";
}

function sanitizeContextRequest(value: unknown): OfficeAiContextRequest {
  if (!exact(value, [
    "expected_revision", "expected_content_id", "selection", "max_scalars",
    "include_images", "cursor",
  ])) invalid();
  const expectedRevision = value.expected_revision;
  const expectedContentId = value.expected_content_id;
  if (!safeRevision(expectedRevision) || !uuid(expectedContentId)) invalid();
  const selection = value.selection;
  if (!record(selection) || !validSelection(
    selection, selection.kind as OfficeFamily, expectedRevision,
  )) invalid();
  if (typeof value.max_scalars !== "number" || !Number.isSafeInteger(value.max_scalars) ||
      value.max_scalars < 1 || value.max_scalars > MAX_CONTEXT_SCALARS) invalid();
  if (typeof value.include_images !== "boolean") invalid();
  if (value.cursor !== null && !uuid(value.cursor)) invalid();
  return structuredClone({
    expected_revision: expectedRevision,
    expected_content_id: expectedContentId,
    selection,
    max_scalars: value.max_scalars,
    include_images: value.include_images,
    cursor: value.cursor,
  }) as OfficeAiContextRequest;
}

function sanitizeProposalRequest(value: unknown): OfficeProposalRequest {
  if (!exact(value, [
    "context_id", "expected_revision", "expected_content_id", "intent",
    "operations", "label_key",
  ])) invalid();
  const intent = value.intent as OfficeProposalIntent;
  if (!uuid(value.context_id) || !safeRevision(value.expected_revision) ||
      !uuid(value.expected_content_id) || !PROPOSAL_INTENTS.includes(intent) ||
      !nonEmpty(value.label_key, 128)) invalid();
  const operations = value.operations;
  if (!Array.isArray(operations) || operations.length < 1 ||
      operations.length > MAX_OPERATIONS) invalid();
  if (operations.some((operation) => !exact(operation, ["family", "operation"]) ||
      operation.family !== familyOfIntent(intent))) invalid();
  return structuredClone(value) as unknown as OfficeProposalRequest;
}

/** Bind the live controller revision/content and one explicit selection into
 * the exact E20 request. No selection is chosen for the caller and no path or
 * source bytes are added. */
export function bindOfficeAiContext(
  controller: OfficeController,
  selection: OfficeSelection,
  options: OfficeAiCaptureOptions = {},
): OfficeAiContextRequest {
  const requestedMax = options.max_scalars;
  const requestedImages = options.include_images;
  if (!only(options, ["max_scalars", "include_images"])) invalid();
  const state = controller.getState();
  if (!state || state.session_id !== controller.session_id || state.family !== controller.family ||
      !state.ready || state.busy || !safeRevision(state.revision) || !uuid(state.content_id)) {
    throw new Error("office_edit.changed");
  }
  if (!validSelection(selection, controller.family, state.revision)) invalid();
  const max = requestedMax ?? 12_000;
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_CONTEXT_SCALARS) invalid();
  if (options.include_images !== undefined && typeof options.include_images !== "boolean") invalid();
  return {
    expected_revision: state.revision,
    expected_content_id: state.content_id,
    selection: structuredClone(selection),
    max_scalars: max,
    include_images: requestedImages ?? false,
    cursor: null,
  };
}

export async function captureOfficeAiContext(
  sessionId: string,
  request: OfficeAiContextRequest,
): Promise<JobHandle<OfficeAiContext>> {
  requireRuntime();
  if (!uuid(sessionId)) invalid();
  const bounded = sanitizeContextRequest(request);
  return runJob("officeai", async (requestId) => {
    await invoke("office_ai_context_start", { requestId, sessionId, request: bounded });
  });
}

export async function releaseOfficeAiContext(contextId: string): Promise<void> {
  requireRuntime();
  if (!nonEmpty(contextId, 128)) invalid();
  await invoke("office_ai_context_release", { contextId });
}

export async function evaluateOfficeProposal(
  sessionId: string,
  request: OfficeProposalRequest,
): Promise<JobHandle<OfficeProposalPreview>> {
  requireRuntime();
  if (!uuid(sessionId)) invalid();
  const bounded = sanitizeProposalRequest(request);
  return runJob("officeprop", async (requestId) => {
    await invoke("office_ai_proposal_evaluate_start", { requestId, sessionId, request: bounded });
  });
}

/** Preview only after the exact bound context still matches the live
 * controller. The immutable context supplies the selection; the request can
 * only add typed operations for that same family. */
export async function previewOfficeProposal(
  controller: OfficeController,
  context: OfficeAiContext,
  request: OfficeProposalRequest,
): Promise<JobHandle<OfficeProposalPreview>> {
  const state = controller.getState();
  if (!state || context.session_id !== controller.session_id ||
      state.session_id !== controller.session_id || state.family !== controller.family ||
      context.family !== controller.family || state.revision !== context.revision ||
      state.content_id !== context.content_id || !safeRevision(context.revision) ||
      !uuid(context.content_id) || !context.complete || context.truncated ||
      context.next_cursor !== null || !Number.isSafeInteger(context.expires_unix) ||
      context.expires_unix <= Math.floor(Date.now() / 1000) ||
      !validSelection(context.selection, controller.family, context.revision)) {
    throw new Error("office_edit.changed");
  }
  const bounded = sanitizeProposalRequest(request);
  if (bounded.context_id !== context.context_id ||
      bounded.expected_revision !== context.revision ||
      bounded.expected_content_id !== context.content_id ||
      familyOfIntent(bounded.intent) !== context.family ||
      bounded.operations.some((operation) => operation.family !== context.family)) {
    invalid();
  }
  return evaluateOfficeProposal(controller.session_id, bounded);
}

export async function officeProposalPage(
  previewId: string,
  cursor: string,
): Promise<OfficeProposalPreview> {
  requireRuntime();
  if (!uuid(previewId) || !uuid(cursor)) invalid();
  return invoke("office_ai_proposal_page", { previewId, cursor });
}

export async function releaseOfficeProposal(previewId: string): Promise<void> {
  requireRuntime();
  if (!nonEmpty(previewId, 128)) invalid();
  await invoke("office_ai_proposal_release", { previewId });
}

/** Explicit cancellation of a retained preview/clone; identical to the
 * idempotent native release and never an apply. */
export async function cancelOfficeProposal(previewId: string): Promise<void> {
  await releaseOfficeProposal(previewId);
}

export async function confirmOfficeProposal(
  previewId: string,
): Promise<{ human_confirmation_id: string; expires_unix: number }> {
  requireRuntime();
  if (!uuid(previewId)) invalid();
  return invoke("office_ai_proposal_confirm", { previewId });
}

export async function applyOfficeProposal(
  request: OfficeProposalApplyRequest,
): Promise<OfficeTransactionResult> {
  requireRuntime();
  if (!exact(request, [
    "preview_id", "transaction_id", "expected_revision", "expected_content_id",
    "acknowledged_warning_ids", "human_confirmation_id",
  ])) invalid();
  const value = request as unknown as Record<string, unknown>;
  if (!uuid(value.preview_id) || !uuid(value.transaction_id) ||
      !safeRevision(value.expected_revision) || !uuid(value.expected_content_id) ||
      !uuid(value.human_confirmation_id)) invalid();
  const warnings = value.acknowledged_warning_ids;
  if (!Array.isArray(warnings) || warnings.length > MAX_WARNINGS ||
      warnings.some((id) => !uuid(id)) || new Set(warnings).size !== warnings.length) invalid();
  // Exact rebuild: a caller cannot add `trusted`, `force`, a path or any
  // other extra field to the native apply request.
  return invoke("office_ai_proposal_apply", {
    request: {
      preview_id: value.preview_id,
      transaction_id: value.transaction_id,
      expected_revision: value.expected_revision,
      expected_content_id: value.expected_content_id,
      acknowledged_warning_ids: [...warnings],
      human_confirmation_id: value.human_confirmation_id,
    },
  });
}
