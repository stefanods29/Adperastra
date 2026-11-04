import type { AiSchemaDescriptor } from "../../../assistant/schemaRegistry";
import { registerAiSchema } from "../../../assistant/schemaRegistry";
import type { AiCitation, AiInputRef } from "../../../services/localAiTypes";
import type { OfficeSelection } from "../../types";
import { isBuiltinDeckStyleId } from "../styles/styleTypes";
import {
  DECK_AI_ACTIONS,
  DECK_AI_LAYOUT_KINDS,
  DECK_AI_SCHEMA_ID,
  DECK_AI_SCHEMA_REVISION,
  MAX_DECK_AI_NOTES,
  MAX_DECK_AI_OUTLINE_BYTES,
  MAX_DECK_AI_SLIDES,
  MAX_DECK_AI_SOURCE_SCALARS,
  MAX_DECK_AI_TOPIC,
  type DeckAiAction,
  type DeckAiLayoutKind,
  type DeckAiOutline,
  type DeckAiRequest,
  type DeckAiSlide,
  type DeckAiSource,
} from "./deckAiTypes";

/** Boundary validation for model output and requests (T8). Unknown keys,
 * geometry, XML and functions are refused; public payloads are typed after
 * this boundary. Split from deckAiTypes.ts to keep both files under 400
 * lines. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GEOMETRY_KEYS = new Set([
  "x",
  "y",
  "x_pt",
  "y_pt",
  "width",
  "height",
  "width_pt",
  "height_pt",
  "rotation",
  "rotation_deg",
  "coordinates",
  "xml",
  "svg",
  "html",
  "script",
  "style",
  "css",
  "color",
  "font",
  "font_family",
  "font_size",
]);

function invalid(): never {
  throw new Error("deck_ai.invalid");
}

function exact(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(record)) if (!keys.includes(key)) invalid();
}

function aiInput(value: unknown): AiInputRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  exact(record, ["kind", "id", "expected_revision"]);
  if (record.kind !== "document" && record.kind !== "snapshot" && record.kind !== "artifact") invalid();
  return {
    kind: record.kind,
    id: uuid(record.id),
    expected_revision: safeInt(record.expected_revision, 1, Number.MAX_SAFE_INTEGER),
  };
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}

function safeInt(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

function string(value: unknown, max: number, min = 0): string {
  if (typeof value !== "string") invalid();
  const length = [...value].length;
  if (length < min || length > max) invalid();
  if (value.includes("\0") || /<\s*[a-z!/]/i.test(value)) invalid();
  return value;
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}

function rejectGeometry(value: unknown, depth = 0): void {
  if (depth > 16) invalid();
  if (Array.isArray(value)) {
    for (const item of value) rejectGeometry(item, depth + 1);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (GEOMETRY_KEYS.has(key.toLowerCase())) invalid();
    rejectGeometry(item, depth + 1);
  }
}

function styleId(value: unknown, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !isBuiltinDeckStyleId(value)) invalid();
  return value;
}

export function validateDeckAiRequest(input: unknown): DeckAiRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input)) invalid();
  const record = input as Record<string, unknown>;
  exact(record, [
    "action",
    "source",
    "style_id",
    "topic",
    "locale",
    "slide_count",
    "include_speaker_notes",
    "request_revision",
  ]);
  const action = string(record.action, 16, 1) as DeckAiAction;
  if (!(DECK_AI_ACTIONS as readonly string[]).includes(action)) invalid();
  const source = record.source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) invalid();
  const sourceRecord = source as Record<string, unknown>;
  const kind = sourceRecord.kind;
  let validatedSource: DeckAiSource;
  if (kind === "document") {
    exact(sourceRecord, ["kind", "input", "selection"]);
    validatedSource = {
      kind: "document",
      input: aiInput(sourceRecord.input),
      selection: (sourceRecord.selection ?? null) as OfficeSelection | null,
    };
  } else if (kind === "outline" || kind === "notes") {
    exact(sourceRecord, ["kind", "text"]);
    validatedSource = { kind, text: string(sourceRecord.text, MAX_DECK_AI_SOURCE_SCALARS, 1) };
  } else if (kind === "selected_slides") {
    exact(sourceRecord, ["kind", "session_id", "slide_ids", "expected_revision", "expected_content_id"]);
    const ids = array(sourceRecord.slide_ids, 30).map(uuid);
    if (ids.length < 1 || new Set(ids).size !== ids.length) invalid();
    validatedSource = {
      kind: "selected_slides",
      session_id: uuid(sourceRecord.session_id),
      slide_ids: ids,
      expected_revision: safeInt(sourceRecord.expected_revision, 0, Number.MAX_SAFE_INTEGER),
      expected_content_id: uuid(sourceRecord.expected_content_id),
    };
  } else {
    invalid();
  }
  if ((action === "shorten" || action === "layout") && validatedSource.kind !== "selected_slides") {
    invalid();
  }
  if (action === "create" && validatedSource.kind === "selected_slides") invalid();
  const style = styleId(record.style_id, true);
  const topic = string(record.topic, MAX_DECK_AI_TOPIC);
  if (action === "add" && topic.length === 0) invalid();
  if (action === "style" && style !== null) invalid();
  if (action !== "style" && style === null) invalid();
  const locale = record.locale;
  if (locale !== "en" && locale !== "es") invalid();
  return {
    action,
    source: validatedSource,
    style_id: style,
    topic,
    locale,
    slide_count: safeInt(record.slide_count ?? 8, 1, MAX_DECK_AI_SLIDES),
    include_speaker_notes: record.include_speaker_notes !== false,
    request_revision: safeInt(record.request_revision, 0, Number.MAX_SAFE_INTEGER),
  };
}

function citation(value: unknown): AiCitation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  exact(record, ["input_id", "revision", "location", "quote"]);
  return {
    input_id: uuid(record.input_id),
    revision: safeInt(record.revision, 1, Number.MAX_SAFE_INTEGER),
    location: record.location as AiCitation["location"],
    quote: string(record.quote, 500),
  };
}

function slide(value: unknown): DeckAiSlide {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  exact(record, [
    "outline_id",
    "layout_kind",
    "title",
    "bullets",
    "right_bullets",
    "caption",
    "quote",
    "speaker_notes",
    "images",
    "citations",
    "chart_data_id",
  ]);
  const layoutKind = record.layout_kind;
  if (!(DECK_AI_LAYOUT_KINDS as readonly string[]).includes(layoutKind as string)) invalid();
  const kind = layoutKind as DeckAiLayoutKind;
  const bullets = array(record.bullets ?? [], 10).map((item) => string(item, 240));
  const right = array(record.right_bullets ?? [], 10).map((item) => string(item, 240));
  if (right.length > 0 && kind !== "two_column") invalid();
  const quote = string(record.quote ?? "", 1000);
  if (quote.length > 0 && kind !== "quote") invalid();
  if (kind === "quote" && quote.length === 0) invalid();
  const caption = string(record.caption ?? "", 1000);
  if (caption.length > 0 && kind !== "image_caption") invalid();
  const images = array(record.images ?? [], 2).map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) invalid();
    const image = item as Record<string, unknown>;
    exact(image, ["id", "prompt", "purpose", "local_input_id", "alt"]);
    return {
      id: uuid(image.id),
      prompt: string(image.prompt, 512, 1),
      purpose: string(image.purpose ?? "", 256),
      local_input_id:
        image.local_input_id === null || image.local_input_id === undefined
          ? null
          : uuid(image.local_input_id),
      alt: string(image.alt ?? "", 1024),
    };
  });
  if (kind !== "image_caption" && images.length > 0) invalid();
  const chart = record.chart_data_id ?? null;
  if (kind === "chart" && chart === null) invalid();
  if (kind !== "chart" && chart !== null) invalid();
  const title = string(record.title ?? "", 160);
  if (kind === "blank" && (title || bullets.length || right.length || caption || quote || images.length || chart)) {
    invalid();
  }
  return {
    outline_id: uuid(record.outline_id),
    layout_kind: kind,
    title,
    bullets,
    right_bullets: right,
    caption,
    quote,
    speaker_notes: string(record.speaker_notes ?? "", MAX_DECK_AI_NOTES),
    images,
    citations: array(record.citations ?? [], 8).map(citation),
    chart_data_id: chart === null ? null : uuid(chart),
  };
}

export function validateDeckAiOutline(input: unknown): DeckAiOutline {
  rejectGeometry(input);
  if (input === null || typeof input !== "object" || Array.isArray(input)) invalid();
  const record = input as Record<string, unknown>;
  exact(record, ["schema_id", "action", "suggested_style_id", "rationale", "slides", "layout_choices"]);
  if (record.schema_id !== DECK_AI_SCHEMA_ID) invalid();
  const action = record.action as DeckAiAction;
  if (!(DECK_AI_ACTIONS as readonly string[]).includes(action)) invalid();
  const suggested = styleId(record.suggested_style_id, true);
  if (!Array.isArray(record.slides) || record.slides.length > MAX_DECK_AI_SLIDES) {
    throw new Error("deck_ai.too_large");
  }
  if (!Array.isArray(record.layout_choices ?? []) || (record.layout_choices as unknown[]).length > MAX_DECK_AI_SLIDES) {
    throw new Error("deck_ai.too_large");
  }
  const slides = array(record.slides, MAX_DECK_AI_SLIDES).map(slide);
  const choices = array(record.layout_choices ?? [], MAX_DECK_AI_SLIDES).map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) invalid();
    const choice = item as Record<string, unknown>;
    exact(choice, ["slide_id", "layout_kind", "rationale"]);
    if (!(DECK_AI_LAYOUT_KINDS as readonly string[]).includes(choice.layout_kind as string)) invalid();
    return {
      slide_id: uuid(choice.slide_id),
      layout_kind: choice.layout_kind as DeckAiLayoutKind,
      rationale: string(choice.rationale ?? "", 512),
    };
  });
  if (action === "layout") {
    if (slides.length > 0 || choices.length === 0) invalid();
  } else if (action === "style") {
    if (slides.length > 0 || suggested === null) invalid();
  } else if (slides.length < 1) {
    invalid();
  }
  const outline: DeckAiOutline = {
    schema_id: DECK_AI_SCHEMA_ID,
    action,
    suggested_style_id: suggested,
    rationale: string(record.rationale ?? "", 1024),
    slides,
    layout_choices: choices,
  };
  if (new TextEncoder().encode(JSON.stringify(outline)).length > MAX_DECK_AI_OUTLINE_BYTES) invalid();
  return outline;
}

/** 17a schema registration (E2 exact export). */
export function registerDeckAiOutlineSchema(): void {
  const descriptor: AiSchemaDescriptor = {
    id: DECK_AI_SCHEMA_ID,
    revision: DECK_AI_SCHEMA_REVISION,
    task: "structured_text",
    max_output_bytes: MAX_DECK_AI_OUTLINE_BYTES,
    validate(value) {
      try {
        return { ok: true, value: validateDeckAiOutline(value) };
      } catch {
        return { ok: false, error_code: "ai.schema_invalid" };
      }
    },
  };
  registerAiSchema(descriptor);
}
