import type { AssistantOutboundPreview } from "../assistant/types";
import type { ConversionWarningCode } from "../convert/types";
import type { AiInputRef } from "./localAiTypes";
import type { PdfSourceIdentity } from "./pdf";

/** Canonical extraction data shapes (Step 17d T1, `ai-extraction-1`).
 *
 * The Rust mirror is `src-tauri/src/ai_extraction_types.rs`. Imported types
 * come from their producers and are never redefined here: `AiInputRef` from
 * 14c, `PdfSourceIdentity` from 07d and `AssistantOutboundPreview` from 17a.
 * Validators and confidence rules live in `aiExtractionValidation.ts`.
 * All fields are snake_case on the wire.
 */

/** MIME of the immutable captured model snapshot (08a `ExportSnapshot`). */
export const EXTRACTION_SNAPSHOT_MIME = "application/vnd.adperastra.extraction+json";
/** Schema version stored inside that snapshot (D7). */
export const EXTRACTION_SNAPSHOT_SCHEMA = 1;

/** One explicit extraction covers 1 to 100 selected inputs (D1). */
export const MAX_EXTRACTION_INPUTS = 100;
/** Most pages one batch may read (D1). */
export const MAX_EXTRACTION_PAGES = 200;
/** Largest single input (D1). */
export const MAX_EXTRACTION_INPUT_BYTES = 50 * 1024 * 1024;
/** Largest whole batch (D1). */
export const MAX_EXTRACTION_BATCH_BYTES = 512 * 1024 * 1024;
/** OCR words kept per page (D1, same as 07e). */
export const MAX_OCR_WORDS_PER_PAGE = 20_000;
/** Cells one reviewed document may hold (D1). */
export const MAX_TABLE_CELLS = 100_000;
/** Unicode scalars of one reviewed document (D1). */
export const MAX_EXTRACTION_SCALARS = 10_000_000;
/** Full native review bound (D1). */
export const MAX_REVIEW_BYTES = 16 * 1024 * 1024;
/** One paginated UI answer stays under 768 KiB. */
export const MAX_REVIEW_PAGE_BYTES = 768 * 1024;
/** Model structured payload bound (D1). */
export const MAX_MODEL_PAYLOAD_BYTES = 256 * 1024;
/** A prepared request is valid for five minutes. */
export const PREPARED_TTL_SECONDS = 300;
/** A review is valid for thirty minutes. */
export const REVIEW_TTL_SECONDS = 1800;
/** Fields below this heuristic certainty are shown as uncertain (D4). */
export const UNCERTAIN_BELOW = 0.85;
/** Certainty used when the OCR layer cannot report any (D4). */
export const OCR_UNKNOWN_CERTAINTY = 0.5;
/** One field keeps at most eight anchors. */
export const MAX_FIELD_ANCHORS = 8;
/** One anchor cites at most 256 OCR words. */
export const MAX_ANCHOR_WORDS = 256;

export type ExtractionKind = "document" | "tables" | "receipts";
export type ExtractionLocale = "en" | "es";
export type ExtractionOutputFormat = "docx" | "md" | "txt" | "xlsx" | "csv";

export interface ExtractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractionSource {
  id: string;
  input: AiInputRef;
  identity: PdfSourceIdentity;
  display_name: string;
  page_count: number;
  sensitive: boolean;
}

export interface ExtractionAnchor {
  source_id: string;
  page: number;
  word_ids: number[];
  /** Normalized 0..1 in oriented source pixels (D2/D4). */
  rect: ExtractionRect;
  quote: string;
}

export type ExtractionValueStatus = "certain" | "uncertain" | "missing" | "inconsistent" | "corrected";

export interface ExtractionValue {
  /** Stable identity a typed field correction names (D4). */
  id: string;
  original: string;
  value: string;
  /** Heuristic provenance certainty, never a factual probability (D4). */
  confidence: number;
  status: ExtractionValueStatus;
  anchors: ExtractionAnchor[];
  correction_revision: number;
}

export type ExtractionBlockKind = "heading" | "paragraph" | "list" | "table";

export interface ExtractionBlock {
  id: string;
  kind: ExtractionBlockKind;
  order: number;
  heading_level: number | null;
  text: ExtractionValue | null;
  list_items: ExtractionValue[];
  table_id: string | null;
}

export type ExtractionColumnType = "text" | "number" | "date";

export interface ExtractionColumn {
  id: string;
  name: ExtractionValue;
  type: ExtractionColumnType;
}

export interface ExtractionRow {
  id: string;
  cells: ExtractionValue[];
}

export interface ExtractionTable {
  id: string;
  source_ids: string[];
  columns: ExtractionColumn[];
  rows: ExtractionRow[];
  header: boolean;
}

export interface ReceiptRecord {
  id: string;
  source_id: string;
  vendor: ExtractionValue;
  tax_id: ExtractionValue;
  date: ExtractionValue;
  currency: ExtractionValue;
  subtotal: ExtractionValue;
  tax: ExtractionValue;
  total: ExtractionValue;
  line_items: ExtractionTable;
  date_iso: string | null;
  currency_code: string | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  total_minor: number | null;
  arithmetic_ok: boolean | null;
}

export interface ExtractionReview {
  id: string;
  revision: number;
  content_id: string;
  sources: ExtractionSource[];
  blocks: ExtractionBlock[];
  tables: ExtractionTable[];
  receipts: ReceiptRecord[];
  complete: boolean;
  warnings: string[];
  next_cursor: string | null;
  expires_unix: number;
  sensitive: boolean;
}

export interface ExtractionRequest {
  inputs: AiInputRef[];
  kind: ExtractionKind;
  locale: ExtractionLocale;
  /** `auto` or one installed BCP47 tag; never a guessed fallback (07e). */
  ocr_language: string;
  request_revision: number;
}

/** What the local preparation returned without any network access (T3). */
export interface ExtractionPreparedRequest {
  id: string;
  request: ExtractionRequest;
  sources: ExtractionSource[];
  outbound_preview: AssistantOutboundPreview;
  expires_unix: number;
}

export type ExtractionCorrection =
  | { kind: "field"; id: string; expected: string; value: string }
  | { kind: "table_cell"; table_id: string; row_id: string; column_id: string; expected: string; value: string }
  | { kind: "split_column"; table_id: string; column_id: string; separator: string }
  | { kind: "merge_columns"; table_id: string; column_ids: string[]; separator: string };

export interface ExtractionPublish {
  review_id: string;
  expected_revision: number;
  expected_content_id: string;
  format: ExtractionOutputFormat;
  table_id: string | null;
  dest_dir: string;
  name: string;
  accepted_warning_codes: ConversionWarningCode[];
  include_source_labels: boolean;
}

/** One model block cites existing OCR word IDs only (D3, T3). */
export interface ExtractionModelBlock {
  kind: ExtractionBlockKind;
  heading_level?: number | null;
  word_ids: number[];
  /** Must equal the cited words joined in reading order; never new text. */
  text?: string;
}

export interface ExtractionModelReply {
  blocks: ExtractionModelBlock[];
}

