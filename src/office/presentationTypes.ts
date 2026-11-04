import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  OfficeChart, OfficeColor, OfficeFont, OfficeRect, ParagraphFormat, TextFormat,
} from "./officeValues";

/** Presentation and slide values (20a E16/E1, office-edit-1).
 *
 * Display IDs are opaque native strings; nothing here is a window handle or
 * an engine command. Shapes carry inert data only (text, table cells, chart
 * series); no HTML, script or external media reference is represented. */

export interface PresentationDisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PresentationDisplay {
  id: string;
  name: string;
  rect: PresentationDisplayRect;
  primary: boolean;
}

export interface PresentationRequest {
  slide_id: string;
  start_from: "first" | "current";
  output_display_id: string;
  presenter_display_id: string | null;
  show_presenter: boolean;
}

export interface PresentationState {
  presentation_id: string;
  session_id: string;
  slide_id: string;
  slide_index: number;
  slide_count: number;
  step_index: number;
  elapsed_ms: number;
  paused: boolean;
  black: boolean;
  ended: boolean;
  output_display_id: string;
}

export type PresentationIntent =
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "end" }
  | { kind: "toggle_black" }
  | { kind: "toggle_pause" }
  | { kind: "reset_timer" }
  | { kind: "go_to"; slide_id: string };

export interface DeckTextRun {
  text: string;
  format: TextFormat;
}

export interface DeckTextParagraph {
  id: string;
  runs: DeckTextRun[];
  paragraph: ParagraphFormat;
}

export interface DeckShapeStroke {
  color: OfficeColor;
  width_pt: number;
}

export type DeckShapeKind = DeckShape["kind"];
export type DeckGeometryKind = "rectangle" | "ellipse" | "line" | "arrow" | "triangle";

/** Exactly one payload matches `kind`. */
interface DeckShapeBase {
  id: string;
  rect: OfficeRect;
  z: number;
  alt: string;
  fill: OfficeColor | null;
  stroke: DeckShapeStroke;
}

export type DeckShape =
  | (DeckShapeBase & { kind: "text"; paragraphs: DeckTextParagraph[] })
  | (DeckShapeBase & { kind: "image"; image: ExportSnapshot })
  | (DeckShapeBase & { kind: "geometry"; geometry: DeckGeometryKind })
  | (DeckShapeBase & { kind: "table"; cells: string[][] })
  | (DeckShapeBase & { kind: "chart"; chart: OfficeChart });

export interface DeckShapePatch {
  id: string;
  rect?: OfficeRect;
  z?: number;
  alt?: string;
  fill?: OfficeColor | null;
  stroke?: DeckShapeStroke;
  paragraphs?: DeckTextParagraph[];
}

export type DeckPlaceholderRole =
  | "title" | "subtitle" | "body" | "body_left" | "body_right"
  | "image" | "caption" | "chart" | "quote" | "footer";

export interface DeckPlaceholder {
  id: string;
  role: DeckPlaceholderRole;
  rect: OfficeRect;
  text: TextFormat;
  paragraph: ParagraphFormat;
}

export type DeckLayoutKind =
  | "title" | "title_body" | "two_column" | "section"
  | "image_caption" | "chart" | "quote" | "blank";

export interface DeckLayout {
  id: string;
  name: string;
  kind: DeckLayoutKind;
  placeholders: DeckPlaceholder[];
}

export interface DeckThemeColors {
  background: OfficeColor;
  text: OfficeColor;
  muted: OfficeColor;
  accent: OfficeColor;
  accent2: OfficeColor;
  surface: OfficeColor;
}

export interface DeckTheme {
  id: string;
  name: string;
  slide_width_pt: number;
  slide_height_pt: number;
  colors: DeckThemeColors;
  heading_font: OfficeFont;
  body_font: OfficeFont;
  layouts: DeckLayout[];
  default_layout_id: string;
  density: "comfortable" | "compact";
  version: 1;
}

/** Template inspection and import values (20a E15). Both mirror
 * `office_edit_presentation.rs`; an inspection is source-bound and expires. */
export interface OfficeFontMapping {
  from_family: string;
  to_font: OfficeFont;
}

export interface DeckTemplateInspection {
  inspection_id: string;
  themes: DeckTheme[];
  warnings: string[];
  source_revision: number;
  expires_unix: number;
}

export interface DeckTransition {
  kind: "none" | "fade" | "push" | "wipe";
  duration_ms: number;
  advance_on_click: boolean;
  advance_after_ms: number | null;
}

export type DeckAnimationKind = "appear" | "fade" | "fly" | "spin";
export type DeckAnimationStart = "on_click" | "with_previous" | "after_previous";
export type DeckAnimationDirection = "left" | "right" | "up" | "down";

export interface DeckAnimation {
  kind: DeckAnimationKind;
  start: DeckAnimationStart;
  duration_ms: number;
  delay_ms: number;
  direction: DeckAnimationDirection;
}
