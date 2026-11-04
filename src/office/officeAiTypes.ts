import type { AiInputRef } from "../services/localAiTypes";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  CellAddress, CellInput, CellRange, OfficeChartKind, OfficeRenderPage, OfficeSelection,
  ParagraphFormat, TextFormat, TextSpan,
} from "./officeValues";
import type { OfficeOperation } from "./officeOperations";

/** AI context/proposal boundary (office-ai-proposal-1, 20a T6/T7).
 *
 * These are neutral data contracts. They never authorize a model call, a
 * clone, a render or an apply; both the context and the proposal services
 * fail closed until the approved engine and capability exist. No source
 * path, whole-document upload, caller trust flag or executable command is
 * part of any request. */

export interface OfficeAiContextRequest {
  expected_revision: number;
  expected_content_id: string;
  selection: OfficeSelection;
  max_scalars: number;
  include_images: boolean;
  cursor: string | null;
}

export interface OfficeAiTextRun {
  id: string;
  span: TextSpan;
  text: string;
  format: TextFormat;
  paragraph: ParagraphFormat;
  style_id: string | null;
  semantic_role: "body" | "heading" | "list" | "caption";
}

export interface OfficeAiImage {
  id: string;
  selection: OfficeSelection;
  snapshot: ExportSnapshot;
  alt: string;
  width_pt: number;
  height_pt: number;
}

export interface OfficeAiSlideSummary {
  slide_id: string;
  layout_id: string;
  title: string;
  notes: string;
}

export interface OfficeAiContext {
  context_id: string;
  session_id: string;
  revision: number;
  content_id: string;
  selection: OfficeSelection;
  family: "document" | "sheet" | "deck";
  text_runs: OfficeAiTextRun[];
  cells: import("./officeValues").OfficeDisplayCell[];
  slides: OfficeAiSlideSummary[];
  images: OfficeAiImage[];
  next_cursor: string | null;
  complete: boolean;
  truncated: boolean;
  expires_unix: number;
}

export type OfficeProposalIntent =
  | "document_rewrite" | "document_insert" | "image_alt"
  | "sheet_formula" | "sheet_clean" | "sheet_chart"
  | "deck_create" | "deck_add" | "deck_shorten" | "deck_notes" | "deck_layout";

export interface OfficeProposalRequest {
  context_id: string;
  expected_revision: number;
  expected_content_id: string;
  intent: OfficeProposalIntent;
  operations: OfficeOperation[];
  label_key: string;
}

/** Proposal difference (office-ai-proposal-1).
 *
 * Resolved discriminant rule: every variant uses `kind` for the diff tag.
 * A chart diff therefore carries `kind: "chart"` and names the chart's own
 * family in the separate `chart_kind` field. No second `kind` or nested chart
 * object is allowed, so text/cell/slide/chart tags stay unambiguous. */
export type OfficeProposalDiff =
  | {
      kind: "text";
      span: TextSpan;
      before: string;
      after: string;
      format_preserved: boolean;
      tracked: boolean;
    }
  | { kind: "image_alt"; image_id: string; before: string; after: string }
  | {
      kind: "cell";
      address: CellAddress;
      before: CellInput;
      after: CellInput;
      before_display: string;
      after_display: string;
    }
  | {
      kind: "slide";
      slide_id: string;
      change: "added" | "text" | "notes" | "layout";
      before_summary: string;
      after_summary: string;
    }
  | {
      kind: "chart";
      chart_id: string;
      source: CellRange;
      chart_kind: OfficeChartKind;
    };

export type ProposalWarningKind =
  | "overflow" | "formatting_loss" | "unsupported" | "truncated_context"
  | "formula_error" | "stale";

export type OfficeProposalWarning =
  | { id: string; message_key: string; kind: "overflow"; object_id: string }
  | { id: string; message_key: string; kind: "formatting_loss"; object_id: string }
  | { id: string; message_key: string; kind: "unsupported"; feature_id: string }
  | { id: string; message_key: string; kind: "truncated_context" }
  | {
      id: string;
      message_key: string;
      kind: "formula_error";
      address: CellAddress;
      error_code: string;
    }
  | { id: string; message_key: string; kind: "stale" };

export type OfficeCellResult = Exclude<CellInput, { kind: "formula" }>;

export interface OfficeProposalCalculation {
  address: CellAddress;
  canonical: string;
  localized: string;
  result: OfficeCellResult;
  display: string;
  error_code:
    | "formula_error" | "function_unsupported" | "external_reference"
    | "volatile_function" | "circular_reference" | null;
  deterministic: boolean;
}

export interface OfficeProposalPreview {
  preview_id: string;
  context_id: string;
  session_id: string;
  revision: number;
  content_id: string;
  intent: OfficeProposalIntent;
  diffs: OfficeProposalDiff[];
  calculations: OfficeProposalCalculation[];
  renders: OfficeRenderPage[];
  warnings: OfficeProposalWarning[];
  next_cursor: string | null;
  complete: boolean;
  can_apply: boolean;
  expires_unix: number;
}

export interface OfficeProposalApplyRequest {
  preview_id: string;
  transaction_id: string;
  expected_revision: number;
  expected_content_id: string;
  acknowledged_warning_ids: string[];
  human_confirmation_id: string;
}

/** Additive 09a draft sources (20a E23). Only native-issued live IDs resolve;
 * the UI never supplies bytes, a path or a sensitivity flag. Native accepts at
 * most 32 references, retains every source lease through blank creation and
 * classifies the draft by the most restrictive source. */
export type OfficeDraftSourceRef =
  | { kind: "office_context"; context_id: string }
  | { kind: "ai_input"; input: AiInputRef };
