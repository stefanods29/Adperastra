import type { AiCitation } from "../../../services/localAiTypes";
import {
  DOCUMENT_AI_ACTIONS, DOCUMENT_AI_LIMITS as L, DOCUMENT_AI_SCHEMA, DOCUMENT_AI_TONES,
  type DocumentAiAction, type DocumentAiOptions, type DocumentAiOutput,
} from "./documentAiTypes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw new Error("document_ai.invalid"); }
function unsafe(): never { throw new Error("document_ai.unsafe"); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }

/** Reject unpaired UTF-16 surrogates; JS iteration alone counts them as scalars. */
export function documentAiScalarLength(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++, count++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = text.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid();
  }
  return count;
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && documentAiScalarLength(value) <= max;
}

/** supportedLanguages must come from the selected producer's real capability. */
export function validateDocumentAiOptions(value: unknown, supportedLanguages: readonly string[]): DocumentAiOptions {
  if (!record(value) || !exact(value, ["action", "tone", "target_language", "topic", "locale"])) invalid();
  if (!DOCUMENT_AI_ACTIONS.includes(value.action as DocumentAiAction)) invalid();
  if (value.locale !== "en" && value.locale !== "es") invalid();
  if (value.action === "tone") {
    if (!DOCUMENT_AI_TONES.includes(value.tone as typeof DOCUMENT_AI_TONES[number])) invalid();
  } else if (value.tone !== null) invalid();
  if (value.action === "translate") {
    if (typeof value.target_language !== "string" || value.target_language.length > 64 ||
        !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.target_language) ||
        !supportedLanguages.includes(value.target_language)) invalid();
  } else if (value.target_language !== null) invalid();
  if (value.action === "draft") {
    if (!bounded(value.topic, L.topic_scalars) || value.topic.trim().length === 0) invalid();
  } else if (value.topic !== null) invalid();
  return structuredClone(value) as unknown as DocumentAiOptions;
}

function locationValid(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value.kind) {
    case "text": return exact(value, ["kind", "start", "end"]) && integer(value.start) && integer(value.end) && value.end > value.start;
    case "page": return exact(value, ["kind", "page"]) && integer(value.page, 1, 0xffffffff);
    case "time": return exact(value, ["kind", "start_us", "end_us"]) && integer(value.start_us) && integer(value.end_us) && value.end_us > value.start_us;
    case "sheet": return exact(value, ["kind", "sheet_id", "range"]) && bounded(value.sheet_id, 128) && bounded(value.range, 64);
    case "slide": return exact(value, ["kind", "slide_id"]) && bounded(value.slide_id, 128);
    case "image": {
      if (!exact(value, ["kind", "region"])) return false;
      if (value.region === null) return true;
      const rect = value.region;
      return record(rect) && exact(rect, ["x", "y", "width", "height"]) &&
        integer(rect.x, 0, 0xffffffff) && integer(rect.y, 0, 0xffffffff) &&
        integer(rect.width, 1, 0xffffffff) && integer(rect.height, 1, 0xffffffff) &&
        rect.x + rect.width <= 0xffffffff && rect.y + rect.height <= 0xffffffff;
    }
    default: return false;
  }
}
function citationValid(value: unknown): value is AiCitation {
  return record(value) && exact(value, ["input_id", "revision", "location", "quote"]) &&
    uuid(value.input_id) && integer(value.revision, 1) && bounded(value.quote, 500) && locationValid(value.location);
}

/** Structural validation only. Native citation, visual-fact and anchor checks
 * remain mandatory before this can become an applicable suggestion. */
export function validateDocumentAiOutput(value: unknown, action: DocumentAiAction): DocumentAiOutput {
  if (!record(value) || !exact(value, ["schema_id", "action", "paragraphs", "alt", "citations", "cautions"])) unsafe();
  if (value.schema_id !== DOCUMENT_AI_SCHEMA || value.action !== action || !DOCUMENT_AI_ACTIONS.includes(action)) unsafe();
  if (!Array.isArray(value.paragraphs) || value.paragraphs.length > L.paragraphs) unsafe();
  const insertion = action === "draft" || action === "continue";
  let total = 0;
  for (const paragraph of value.paragraphs) {
    if (!record(paragraph) || !exact(paragraph, ["source_run_ids", "text"]) || typeof paragraph.text !== "string") unsafe();
    total += documentAiScalarLength(paragraph.text);
    if (total > L.output_scalars) throw new Error("document_ai.too_large");
    if (!Array.isArray(paragraph.source_run_ids) || paragraph.source_run_ids.length > L.runs_per_paragraph ||
        paragraph.source_run_ids.some((id) => !uuid(id)) || new Set(paragraph.source_run_ids).size !== paragraph.source_run_ids.length) unsafe();
    if (insertion ? paragraph.source_run_ids.length !== 0 : action !== "alt_text" && paragraph.source_run_ids.length === 0) unsafe();
    // D2: a rewrite may not silently delete the selected text.
    if (!insertion && paragraph.text.length === 0) unsafe();
    if (/[\r\n\u2028\u2029]/u.test(paragraph.text) || /<\/?[A-Za-z][^>]*>/u.test(paragraph.text)) unsafe();
  }
  if (action === "alt_text") {
    if (value.paragraphs.length !== 0 || !bounded(value.alt, L.alt_scalars)) unsafe();
  } else if (value.alt !== null) unsafe();
  if (!Array.isArray(value.citations) || value.citations.length > L.citations || !value.citations.every(citationValid)) unsafe();
  const cautions = ["protected_token_changed", "meaning_uncertain", "unverified_draft"];
  if (!Array.isArray(value.cautions) || value.cautions.length > L.cautions ||
      value.cautions.some((caution) => typeof caution !== "string" || !cautions.includes(caution))) unsafe();
  return structuredClone(value) as unknown as DocumentAiOutput;
}
