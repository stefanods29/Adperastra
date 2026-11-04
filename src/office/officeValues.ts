import type { OfficeFormat } from "../services/engineTypes";

/** Canonical engine-neutral Office values (20a E1, office-edit-1).
 *
 * These types mirror `office_edit_values.rs`. They describe data only: no
 * engine API, process handle, file path or executable command is present.
 * Native validation remains authoritative for every bound. */

export type OfficeFamily = "document" | "sheet" | "deck";

export type OfficeMode = "viewing" | "editing" | "reviewing";

export type OfficeStoragePolicy = "ordinary" | "sensitive";
export type OfficeExportFormat = "pdf" | "png" | "jpeg";

export type OfficeCapability =
  | "document_text" | "document_format" | "document_tables" | "document_images"
  | "document_references" | "document_review" | "document_comments" | "spelling"
  | "sheet_cells" | "sheet_formulas" | "sheet_formats" | "sheet_validation"
  | "sheet_charts" | "sheet_pivots" | "sheet_structure"
  | "deck_slides" | "deck_shapes" | "deck_masters" | "deck_themes"
  | "deck_transitions" | "deck_animations" | "deck_present" | "deck_comments"
  | "preserve_unknown" | "save_existing" | "save_copy" | "export_pdf"
  | "export_images" | "print" | "sensitive_memory"
  | "ai_context" | "proposal_clone" | "proposal_apply";

/** A selected value, a genuinely mixed selection, or a refused query. Mixed is
 * never coerced to false or to the first selected value. */
export type OfficeValue<T> =
  | { kind: "value"; value: T }
  | { kind: "mixed" }
  | { kind: "unavailable"; reason_key: string };

/** Optional patch fields become required `OfficeValue` answers in formatting
 * responses; `undefined` never leaks from a native answer. */
export type OfficeValueMap<T> = {
  [K in keyof T]-?: OfficeValue<Exclude<T[K], undefined>>;
};

/** Frozen wire shape: four separate u8 channels in `r`, `g`, `b`, `a` order.
 * Document colors are content, never application UI tokens. */
export interface OfficeColor { r: number; g: number; b: number; a: number; }

export type OfficeFontSource = "bundled" | "installed" | "document";

export interface OfficeFont { family: string; source: OfficeFontSource; embeddable: boolean; }

export interface TextPosition { block_id: string; offset_utf16: number; }

/** Frozen wire name: the live source revision this span belongs to. */
export interface TextSpan { anchor: TextPosition; focus: TextPosition; revision: number; }

export type TextUnderline = "none" | "single" | "double";
export type TextScript = "normal" | "subscript" | "superscript";
export type ParagraphAlign = "left" | "center" | "right" | "justify";
export type ParagraphDirection = "ltr" | "rtl";
export type ParagraphList = "none" | "disc" | "decimal";

export interface TextFormat {
  font: OfficeFont;
  size_pt: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: TextUnderline;
  script: TextScript;
  foreground: OfficeColor;
  highlight: OfficeColor | null;
  language: string;
}

export interface TextFormatPatch {
  font?: OfficeFont;
  size_pt?: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: TextUnderline;
  script?: TextScript;
  foreground?: OfficeColor;
  highlight?: OfficeColor | null;
  language?: string;
}

export interface ParagraphFormat {
  align: ParagraphAlign;
  direction: ParagraphDirection;
  indent_left_pt: number;
  indent_right_pt: number;
  first_line_pt: number;
  line_spacing: number;
  before_pt: number;
  after_pt: number;
  list: ParagraphList;
  outline_level: number;
}

export interface ParagraphFormatPatch {
  align?: ParagraphAlign;
  direction?: ParagraphDirection;
  indent_left_pt?: number;
  indent_right_pt?: number;
  first_line_pt?: number;
  line_spacing?: number;
  before_pt?: number;
  after_pt?: number;
  list?: ParagraphList;
  outline_level?: number;
}

export interface PageMargins { top: number; right: number; bottom: number; left: number; }

export interface PageLayout {
  width_pt: number; height_pt: number; margins: PageMargins;
  columns: number; column_gap_pt: number;
}

export interface CellAddress { sheet_id: string; row: number; column: number; }

export interface CellRange {
  sheet_id: string;
  first_row: number; last_row: number;
  first_column: number; last_column: number;
}

export type CellInput =
  | { kind: "blank" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "formula"; canonical: string }
  | { kind: "date"; iso_date: string };

export type BorderStyle = "none" | "thin" | "medium" | "dashed" | "dotted";

export interface CellBorder { style: BorderStyle; color: OfficeColor; }

export interface CellBorders {
  top: CellBorder; right: CellBorder; bottom: CellBorder; left: CellBorder;
}

export type CellHorizontal = "left" | "center" | "right" | "general";
export type CellVertical = "top" | "middle" | "bottom";

export interface CellFormatPatch {
  text?: TextFormatPatch;
  horizontal?: CellHorizontal;
  vertical?: CellVertical;
  wrap?: boolean;
  rotation?: number;
  number_format?: string;
  fill?: OfficeColor | null;
  borders?: CellBorders;
  locked?: boolean;
}

export interface OfficeRect {
  x_pt: number; y_pt: number; width_pt: number; height_pt: number; rotation_deg: number;
}

export type DocumentSelection = {
  kind: "document";
  span: TextSpan;
  page: number;
};

export type SheetSelection = {
  kind: "sheet";
  ranges: CellRange[];
  active: CellAddress;
};

export type DeckSelection = {
  kind: "deck"; slide_ids: string[]; shape_ids: string[]; text_span: TextSpan | null;
};

export type OfficeSelection = DocumentSelection | SheetSelection | DeckSelection;

export interface OfficeViewport {
  x_px: number; y_px: number; width_px: number; height_px: number;
  zoom_percent: number; device_scale: number; view_revision: number;
}

export type CompatibilityState = "editable" | "preserved_only" | "unsupported" | "blocked";

export interface CompatibilityItem {
  feature_id: string; state: CompatibilityState; count: number; message_key: string;
}

export interface CompatibilityReport {
  format: string; entries: CompatibilityItem[]; next_cursor: string | null;
  can_preserve_unknown: boolean; blocks_save: boolean;
}

export interface OfficeSessionState {
  session_id: string;
  document_id: string;
  family: OfficeFamily;
  format: OfficeFormat;
  revision: number;
  saved_revision: number;
  content_id: string;
  saved_content_id: string;
  ready: boolean;
  mode: OfficeMode;
  dirty: boolean;
  can_undo: boolean;
  can_redo: boolean;
  capabilities: OfficeCapability[];
  selection: OfficeSelection | null;
  compatibility: CompatibilityReport;
  page_count: number;
  sheet_count: number;
  slide_count: number;
  busy: boolean;
  status_key: string | null;
}

export interface OfficeBinaryLease {
  lease_id: string;
  token: string;
  name: string;
  mime: string;
  byte_len: number;
  width?: number;
  height?: number;
  storage_policy: OfficeStoragePolicy;
}

export type AccessibleNodeRole =
  | "document" | "paragraph" | "heading" | "table" | "row" | "cell"
  | "textbox" | "image" | "button";

export interface OfficeAccessibleNode {
  id: string;
  role: AccessibleNodeRole;
  name: string;
  rect: OfficeRect;
  editable: boolean;
  deck_text?: { span: TextSpan; text: string };
  document_text?: { span: TextSpan; text: string };
}

export interface OfficeRenderPage {
  session_id: string;
  view_revision: number;
  page_id: string;
  image: OfficeBinaryLease;
  rect: OfficeRect;
  accessibility: OfficeAccessibleNode[];
  next_cursor: string | null;
}

/** One bounded page of results. `revision` is the single frozen request/source
 * revision the page was computed against; there is no second revision field. */
export interface OfficeResultPage<T> {
  items: T[];
  next_cursor: string | null;
  complete: boolean;
  revision: number;
}

export interface OfficeCommentReply {
  id: string;
  author: string;
  text: string;
  created_unix: number;
}

export interface OfficeEditComment {
  id: string;
  author: string;
  text: string;
  created_unix: number;
  resolved: boolean;
  anchor: OfficeSelection;
  replies: OfficeCommentReply[];
}

export interface OfficeFindRequest {
  query: string;
  match_case: boolean;
  whole_word: boolean;
  scope: "document" | "selection";
}

export interface OfficeFindMatch {
  id: string;
  selection: OfficeSelection;
  excerpt: string;
}

export interface OfficeSpellingIssue {
  id: string;
  span: TextSpan;
  word: string;
  suggestions: string[];
}

export interface DocumentStatistics {
  revision: number;
  page: number;
  page_count: number;
  words: number;
  characters: number;
  language: string;
}

export type OfficeFormulaLocale = "en-US" | "es-419";

export interface ParsedOfficeFormula {
  canonical: string;
  functions: string[];
  valid: boolean;
  error_offset_utf16: number | null;
}

export interface OfficeFunctionArgument {
  name_key: string;
  kind: "number" | "text" | "boolean" | "range" | "any_scalar";
  optional: boolean;
  repeated: boolean;
}

export interface OfficeFunction {
  id: string;
  display_name: string;
  arguments: OfficeFunctionArgument[];
  min_args: number;
  max_args: number;
  description_key: string;
}

export interface OfficeDisplayCell {
  address: CellAddress;
  display: string;
  input: CellInput;
  format: CellFormatPatch;
  error_code: string | null;
  merged_range: CellRange | null;
  editable: boolean;
}

export interface OfficeCellWindow {
  revision: number;
  range: CellRange;
  rows: OfficeDisplayCell[][];
  next_row: number | null;
}

export interface SheetPrintRepeatRows {
  first: number;
  last: number;
}

export interface SheetPrintSettings {
  ranges: CellRange[];
  page_size: "a4" | "letter";
  landscape: boolean;
  margins_mm: PageMargins;
  fit_width_pages: number | null;
  fit_height_pages: number | null;
  repeat_header_rows: SheetPrintRepeatRows | null;
}

export interface OfficeChartSeries {
  name: string;
  values: (number | null)[];
}

export type OfficeChartSource =
  | { kind: "range"; range: CellRange; headers: boolean }
  | { kind: "inline"; categories: string[]; series: OfficeChartSeries[] };

export type OfficeChartKind = "column" | "bar" | "line" | "area" | "pie" | "scatter";

export interface OfficeChart {
  id: string;
  kind: OfficeChartKind;
  source: OfficeChartSource;
  title: string;
  legend: boolean;
  rect: OfficeRect;
}

/** The E6 formatting answer for one selection. Every mapped key is present and
 * is a value, mixed or unavailable; a UI never invents a default. Frozen field
 * names: `selection`, `text`, `paragraph`, `cell`, `style_ids`, `sheet_ids`,
 * `slide_ids`; the three ID arrays are ordered and may be empty. */
export type OfficeFormatting = {
  selection: OfficeSelection;
  text: OfficeValueMap<TextFormat>;
  paragraph: OfficeValueMap<ParagraphFormat>;
  cell: OfficeValueMap<CellFormatPatch>;
  style_ids: string[];
  sheet_ids: string[];
  slide_ids: string[];
};
