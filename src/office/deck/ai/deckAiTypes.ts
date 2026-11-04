import type { AssistantOutboundPreview } from "../../../assistant/types";
import type { AiCitation, AiInputRef } from "../../../services/localAiTypes";
import type { DeckStyle } from "../styles/styleTypes";
import { DECK_STYLE_SUFFIXES, type DeckStyleSuffix } from "../styles/stylePalettes";
import { DECK_STYLE_BUILTIN_IDS } from "../styles/styleTypes";
import type {
  OfficeAiContext,
  OfficeProposalPreview,
  OfficeSelection,
} from "../../types";

/** Structured deck AI contract (ai-deck-1). The model returns outline data;
 * it never returns coordinates, fonts, colors, XML, HTML, scripts or images.
 * Boundary validation lives in `deckAiValidation.ts` (both files stay under
 * the 400-line limit). */

export const DECK_AI_SCHEMA_ID = "deck.outline.v1";
export const DECK_AI_SCHEMA_REVISION = 1;
export const DECK_AI_PREVIEW_TTL_SECONDS = 300;
export const MAX_DECK_AI_SOURCE_SCALARS = 24_000;
export const MAX_DECK_AI_SLIDES = 30;
export const MAX_DECK_AI_CHUNK_PARAGRAPHS = 32;
export const MAX_DECK_AI_IMAGES = 8;
export const MAX_DECK_AI_SLIDE_TEXT = 4_000;
export const MAX_DECK_AI_NOTES = 8_000;
export const MAX_DECK_AI_OUTLINE_BYTES = 128 * 1024;
export const MAX_DECK_AI_CITATIONS = 64;
export const MAX_DECK_AI_OPERATIONS = 1_000;
export const MAX_DECK_AI_WARNINGS = 64;
export const MAX_DECK_AI_TOPIC = 2_000;
export const MIN_DECK_AI_TEXT_PT = 16;
export const MAX_DECK_AI_TEXT_PT = 96;

export const DECK_AI_ACTIONS = ["create", "add", "shorten", "notes", "layout", "style"] as const;
export type DeckAiAction = (typeof DECK_AI_ACTIONS)[number];

export const DECK_AI_LAYOUT_KINDS = [
  "title",
  "title_body",
  "two_column",
  "section",
  "image_caption",
  "chart",
  "quote",
  "blank",
] as const;
export type DeckAiLayoutKind = (typeof DECK_AI_LAYOUT_KINDS)[number];

export const DECK_AI_STATUSES = [
  "awaiting_send",
  "generating",
  "editing",
  "previewing",
  "ready",
  "applying",
  "applied",
  "error",
  "cancelled",
] as const;
export type DeckAiStatus = (typeof DECK_AI_STATUSES)[number];

export type DeckAiSource =
  | { kind: "document"; input: AiInputRef; selection: OfficeSelection | null }
  | { kind: "outline"; text: string }
  | { kind: "notes"; text: string }
  | {
      kind: "selected_slides";
      session_id: string;
      slide_ids: string[];
      expected_revision: number;
      expected_content_id: string;
    };

export interface DeckAiRequest {
  action: DeckAiAction;
  source: DeckAiSource;
  style_id: string | null;
  topic: string;
  locale: "en" | "es";
  slide_count: number;
  include_speaker_notes: boolean;
  request_revision: number;
}

export interface DeckAiImageSuggestion {
  id: string;
  prompt: string;
  purpose: string;
  local_input_id: string | null;
  alt: string;
}

export interface DeckAiSlide {
  outline_id: string;
  layout_kind: DeckAiLayoutKind;
  title: string;
  bullets: string[];
  right_bullets: string[];
  caption: string;
  quote: string;
  speaker_notes: string;
  images: DeckAiImageSuggestion[];
  citations: AiCitation[];
  chart_data_id: string | null;
}

export interface DeckAiOutline {
  schema_id: typeof DECK_AI_SCHEMA_ID;
  action: DeckAiAction;
  suggested_style_id: string | null;
  rationale: string;
  slides: DeckAiSlide[];
  layout_choices: { slide_id: string; layout_kind: DeckAiLayoutKind; rationale: string }[];
}

export const DECK_AI_WARNING_KINDS = [
  "density",
  "overflow",
  "unverified_fact",
  "protected_fact",
  "image_unavailable",
  "layout_unsupported",
] as const;
export type DeckAiWarningKind = (typeof DECK_AI_WARNING_KINDS)[number];

export interface DeckAiWarning {
  id: string;
  kind: DeckAiWarningKind;
  outline_id: string | null;
  source_id: string | null;
  text_key: string;
  argument: string;
  accepted: false;
}

export interface DeckAiSuggestion {
  id: string;
  request: DeckAiRequest;
  source_context_id: string | null;
  target_context: OfficeAiContext | null;
  outline: DeckAiOutline;
  warnings: DeckAiWarning[];
  preview: OfficeProposalPreview | null;
  draft_id: string | null;
  model_id: string;
  model_revision: string;
  prompt_revision: number;
  status: DeckAiStatus;
  expires_unix: number;
}

export interface DeckAiSettings {
  enabled: boolean;
  experimental_actions: DeckAiAction[];
}

export interface DeckAiPreparedRequest {
  id: string;
  request: DeckAiRequest;
  outbound_preview: AssistantOutboundPreview;
  expires_unix: number;
}

export const DECK_AI_PROMPT_ACTIONS = ["create", "add", "shorten", "notes", "layout", "style"] as const;

export function deckAiPromptId(action: DeckAiAction, style: DeckStyleSuffix, locale: "en" | "es"): string {
  return `deck.${action}.${style}.${locale}.v1`;
}

export function deckAiPromptIds(): string[] {
  const ids: string[] = [];
  for (const action of DECK_AI_PROMPT_ACTIONS) {
    for (const style of DECK_STYLE_SUFFIXES) {
      for (const locale of ["en", "es"] as const) ids.push(deckAiPromptId(action, style, locale));
    }
  }
  return ids;
}

export function builtinStyleOrNull(id: string | null): DeckStyle["id"] | null {
  return id !== null && (DECK_STYLE_BUILTIN_IDS as readonly string[]).includes(id) ? id : null;
}
