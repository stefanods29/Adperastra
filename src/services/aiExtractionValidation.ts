import { isUuid } from "../documents/types";
import type { ConversionWarningCode } from "../convert/types";
import type { AiInputRef } from "./localAiTypes";
import type { PdfSourceIdentity } from "./pdf";
import type { ExportSnapshot } from "./exportSnapshots";
import {
  MAX_ANCHOR_WORDS,
  MAX_EXTRACTION_INPUTS,
  MAX_EXTRACTION_PAGES,
  MAX_EXTRACTION_SCALARS,
  MAX_FIELD_ANCHORS,
  MAX_REVIEW_BYTES,
  MAX_TABLE_CELLS,
  OCR_UNKNOWN_CERTAINTY,
  UNCERTAIN_BELOW,
  type ExtractionAnchor,
  type ExtractionCorrection,
  type ExtractionPublish,
  type ExtractionRect,
  type ExtractionRequest,
  type ExtractionReview,
  type ExtractionValue,
  type ExtractionValueStatus,
} from "./aiExtractionTypes";

/** Validation for extraction DTOs (Step 17d T1). Mirrors `src-tauri/src/ai_extraction_validation.rs`; unknown fields are refused. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BCP47 = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code = "ai_extract.invalid"): never {
  throw new Error(code);
}

function scalars(value: string): number {
  return Array.from(value).length;
}

function text(value: unknown, max: number, code = "ai_extract.invalid"): string {
  if (typeof value !== "string" || scalars(value) > max) fail(code);
  return value;
}

function integer(value: unknown, min: number, max: number, code = "ai_extract.invalid"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}

function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail();
  return value;
}

function uuid(value: unknown): string {
  if (!isUuid(value)) fail();
  return value;
}

/** Strict key check: unknown model or script fields are refused (T1 trap). */
function keys(object: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail();
  }
  for (const key of allowed) {
    if (!(key in object)) fail();
  }
}

export function isExtractionRect(value: unknown): value is ExtractionRect {
  if (!isRecord(value)) return false;
  const allowed = ["x", "y", "width", "height"];
  if (Object.keys(value).length !== allowed.length) return false;
  if (!allowed.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))) return false;
  const rect = value as unknown as ExtractionRect;
  return (
    rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 &&
    rect.x + rect.width <= 1 && rect.y + rect.height <= 1
  );
}

/** Keep a PDF source identity exactly; a snapshot never gains a stamp (D2). */
export function normalizeSourceIdentity(identity: PdfSourceIdentity): PdfSourceIdentity {
  if (identity.kind === "disk") return { kind: "disk", stamp: { ...identity.stamp } };
  return {
    kind: "snapshot",
    document_id: identity.document_id,
    revision: identity.revision,
    content_id: identity.content_id,
    sensitive: identity.sensitive,
  };
}

/** Heuristic certainty (D4): the model's own claim is ignored on purpose. */
export function extractionConfidence(input: {
  ocr_certainty: number | null;
  layout_alignment: number;
  parser_agreement: number;
  model_claim?: number;
}): number {
  const ocr =
    typeof input.ocr_certainty === "number" && Number.isFinite(input.ocr_certainty)
      ? Math.min(1, Math.max(0, input.ocr_certainty))
      : OCR_UNKNOWN_CERTAINTY;
  const layout = Number.isFinite(input.layout_alignment) ? Math.min(1, Math.max(0, input.layout_alignment)) : 0;
  const parser = Number.isFinite(input.parser_agreement) ? Math.min(1, Math.max(0, input.parser_agreement)) : 0;
  return Math.min(ocr, layout, parser);
}

export function statusForConfidence(confidence: number): ExtractionValueStatus {
  return confidence < UNCERTAIN_BELOW ? "uncertain" : "certain";
}

/** The immutable identity a capture is bound to (T1 test oracle). */
export function extractionCaptureIdentity(review: ExtractionReview): {
  content_id: string;
  revision: number;
  source_ids: string[];
  identity_keys: string[];
} {
  return {
    content_id: review.content_id,
    revision: review.revision,
    source_ids: review.sources.map((source) => source.id),
    identity_keys: review.sources.map((source) => {
      const identity = normalizeSourceIdentity(source.identity);
      return identity.kind === "disk"
        ? `disk:${identity.stamp.volume_id}:${identity.stamp.file_id}:${identity.stamp.modified_ticks}`
        : `snapshot:${identity.document_id}:${identity.revision}:${identity.content_id}`;
    }),
  };
}

function validateInputRef(value: unknown): AiInputRef {
  if (!isRecord(value)) fail();
  keys(value, ["kind", "id", "expected_revision"]);
  const kind = value.kind;
  if (kind !== "document" && kind !== "snapshot" && kind !== "artifact") fail();
  return {
    kind,
    id: uuid(value.id),
    expected_revision: integer(value.expected_revision, 1, Number.MAX_SAFE_INTEGER),
  };
}

export function validateExtractionRequest(value: unknown): ExtractionRequest {
  if (!isRecord(value)) fail();
  keys(value, ["inputs", "kind", "locale", "ocr_language", "request_revision"]);
  if (!Array.isArray(value.inputs) || value.inputs.length < 1 || value.inputs.length > MAX_EXTRACTION_INPUTS) fail();
  const inputs = value.inputs.map(validateInputRef);
  const kind = value.kind;
  if (kind !== "document" && kind !== "tables" && kind !== "receipts") fail();
  const locale = value.locale;
  if (locale !== "en" && locale !== "es") fail();
  const ocrLanguage = text(value.ocr_language, 64);
  if (ocrLanguage !== "auto" && !BCP47.test(ocrLanguage)) fail();
  return {
    inputs,
    kind,
    locale,
    ocr_language: ocrLanguage,
    request_revision: integer(value.request_revision, 1, 4_294_967_295),
  };
}

export function validateExtractionPublish(value: unknown): ExtractionPublish {
  if (!isRecord(value)) fail();
  keys(value, [
    "review_id",
    "expected_revision",
    "expected_content_id",
    "format",
    "table_id",
    "dest_dir",
    "name",
    "accepted_warning_codes",
    "include_source_labels",
  ]);
  const format = value.format;
  if (format !== "docx" && format !== "md" && format !== "txt" && format !== "xlsx" && format !== "csv") fail();
  const name = text(value.name, 180);
  if (name === "." || name === ".." || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) fail();
  if (typeof value.dest_dir !== "string" || value.dest_dir === "" || value.dest_dir.length > 32768) fail();
  if (value.table_id !== null) uuid(value.table_id);
  if (typeof value.include_source_labels !== "boolean") fail();
  if (!Array.isArray(value.accepted_warning_codes)) fail();
  return {
    review_id: uuid(value.review_id),
    expected_revision: integer(value.expected_revision, 1, Number.MAX_SAFE_INTEGER),
    expected_content_id: uuid(value.expected_content_id),
    format,
    table_id: value.table_id as string | null,
    dest_dir: value.dest_dir,
    name,
    accepted_warning_codes: value.accepted_warning_codes as ConversionWarningCode[],
    include_source_labels: value.include_source_labels,
  };
}

export function validateExtractionCorrection(value: unknown): ExtractionCorrection {
  if (!isRecord(value)) fail();
  if (value.kind === "field") {
    keys(value, ["kind", "id", "expected", "value"]);
    return {
      kind: "field",
      id: uuid(value.id),
      expected: text(value.expected, 16384),
      value: text(value.value, 16384),
    };
  }
  if (value.kind === "table_cell") {
    keys(value, ["kind", "table_id", "row_id", "column_id", "expected", "value"]);
    return {
      kind: "table_cell",
      table_id: uuid(value.table_id),
      row_id: uuid(value.row_id),
      column_id: uuid(value.column_id),
      expected: text(value.expected, 16384),
      value: text(value.value, 16384),
    };
  }
  if (value.kind === "split_column") {
    keys(value, ["kind", "table_id", "column_id", "separator"]);
    const separator = text(value.separator, 8);
    if (separator === "") fail();
    return { kind: "split_column", table_id: uuid(value.table_id), column_id: uuid(value.column_id), separator };
  }
  if (value.kind === "merge_columns") {
    keys(value, ["kind", "table_id", "column_ids", "separator"]);
    if (!Array.isArray(value.column_ids) || value.column_ids.length < 2 || value.column_ids.length > 10) fail();
    return {
      kind: "merge_columns",
      table_id: uuid(value.table_id),
      column_ids: value.column_ids.map(uuid),
      separator: text(value.separator, 8),
    };
  }
  return fail();
}

function validateValue(value: unknown): ExtractionValue {
  if (!isRecord(value)) fail();
  keys(value, ["id", "original", "value", "confidence", "status", "anchors", "correction_revision"]);
  const status = value.status;
  if (status !== "certain" && status !== "uncertain" && status !== "missing" && status !== "inconsistent" && status !== "corrected") {
    fail();
  }
  if (!Array.isArray(value.anchors) || value.anchors.length > MAX_FIELD_ANCHORS) fail();
  return {
    id: uuid(value.id),
    original: text(value.original, 16384),
    value: text(value.value, 16384),
    confidence: finite(value.confidence, 0, 1),
    status,
    anchors: value.anchors.map((anchor) => {
      if (!isRecord(anchor)) fail();
      keys(anchor, ["source_id", "page", "word_ids", "rect", "quote"]);
      if (!Array.isArray(anchor.word_ids) || anchor.word_ids.length < 1 || anchor.word_ids.length > MAX_ANCHOR_WORDS) fail();
      if (!isExtractionRect(anchor.rect)) fail();
      return {
        source_id: uuid(anchor.source_id),
        page: integer(anchor.page, 1, MAX_EXTRACTION_PAGES),
        word_ids: anchor.word_ids.map((id) => integer(id, 1, 4_294_967_295)),
        rect: { ...anchor.rect },
        quote: text(anchor.quote, 512),
      };
    }),
    correction_revision: integer(value.correction_revision, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** Bounded review validation: counts, rectangular tables and 16 MiB native cap. */
export function validateExtractionReview(value: unknown): ExtractionReview {
  if (!isRecord(value)) fail();
  if (JSON.stringify(value).length > MAX_REVIEW_BYTES) fail("ai_extract.too_large");
  keys(value, [
    "id",
    "revision",
    "content_id",
    "sources",
    "blocks",
    "tables",
    "receipts",
    "complete",
    "warnings",
    "next_cursor",
    "expires_unix",
    "sensitive",
  ]);
  if (!Array.isArray(value.sources) || value.sources.length > 100) fail();
  if (!Array.isArray(value.blocks) || value.blocks.length > 10_000) fail();
  if (!Array.isArray(value.tables) || value.tables.length > 100) fail();
  if (!Array.isArray(value.receipts) || value.receipts.length > 100) fail();
  if (!Array.isArray(value.warnings) || value.warnings.length > 32) fail();
  let cells = 0;
  for (const table of value.tables) {
    if (!isRecord(table) || !Array.isArray(table.rows) || !Array.isArray(table.columns)) fail();
    if (table.rows.length > 10_000 || table.columns.length < 1 || table.columns.length > 100) fail();
    for (const row of table.rows) {
      if (!isRecord(row) || !Array.isArray(row.cells) || row.cells.length !== table.columns.length) fail();
      cells += row.cells.length;
    }
    if (cells > MAX_TABLE_CELLS) fail("ai_extract.too_large");
  }
  if (value.next_cursor !== null) uuid(value.next_cursor);
  return value as unknown as ExtractionReview;
}

/** Reject invented anchors or text: the model may only cite known OCR words. */
import type { ExtractionModelBlock, ExtractionModelReply } from "./aiExtractionTypes";

export function validateExtractionModelReply(
  value: unknown,
  knownWords: ReadonlyMap<number, string>,
): ExtractionModelReply {
  if (!isRecord(value) || !Array.isArray(value.blocks) || value.blocks.length > 10_000) fail();
  const blocks: ExtractionModelBlock[] = [];
  for (const block of value.blocks) {
    if (!isRecord(block)) fail();
    for (const key of Object.keys(block)) {
      if (!["kind", "heading_level", "word_ids", "text"].includes(key)) fail();
    }
    if (!Array.isArray(block.word_ids) || block.word_ids.length < 1 || block.word_ids.length > MAX_ANCHOR_WORDS) fail();
    const wordIds = block.word_ids.map((id) => integer(id, 1, 4_294_967_295));
    const words: string[] = [];
    for (const id of wordIds) {
      const word = knownWords.get(id);
      if (word === undefined) fail();
      words.push(word);
    }
    if (block.text !== undefined) {
      const joined = words.join(" ").replace(/\s+/g, " ").trim();
      const claimed = text(block.text, 16384).replace(/\s+/g, " ").trim();
      if (claimed !== joined) fail();
    }
    const kind = block.kind;
    if (kind !== "heading" && kind !== "paragraph" && kind !== "list" && kind !== "table") fail();
    blocks.push({
      kind,
      word_ids: wordIds,
      ...(block.text === undefined ? {} : { text: block.text as string }),
    });
  }
  return { blocks };
}

/** A capture never performs destination publication (D7). */
export function captureIsPending(snapshot: ExportSnapshot | null): boolean {
  return snapshot === null;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export { UUID };
