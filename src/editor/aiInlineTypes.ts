import type { AssistantBackend } from "../assistant/types";
import { isUuid } from "../documents/types";

/** Inline writing-suggestion contracts (Step 17d T1/T6, `ai-inline-1`).
 *
 * Inline suggestions are opt-in, local-only and never change the document by
 * themselves (D8/D9). Settings live under `ai.writing` (schema 46 -> 47).
 */

/** Wait for a real typing pause before asking for a suggestion (D8). */
export const INLINE_PAUSE_MS = 750;
/** Unicode scalars taken before the cursor. */
export const INLINE_MAX_BEFORE = 2048;
/** Unicode scalars taken after the cursor. */
export const INLINE_MAX_AFTER = 512;
/** Longest suggestion, in Unicode scalars. */
export const INLINE_MAX_SUGGESTION = 256;
/** A suggestion is usable for thirty seconds. */
export const INLINE_TTL_SECONDS = 30;
/** Longest language identifier (for example `text`, `typescript`). */
export const INLINE_MAX_LANGUAGE = 32;
/** Longest context a native request may carry, in UTF-16 units. */
export const INLINE_MAX_CONTEXT_UNITS = 8192;

export type InlineFileType = "text" | "markdown" | "code";

/** Settings block `ai.writing` (schema 47, D8). */
export interface AiInlineSettings {
  inline_enabled: boolean;
  enabled_types: Record<InlineFileType, boolean>;
}

/** Mirrors native `InlineCompletionRequest`. */
export interface InlineCompletionRequest {
  document_id: string;
  revision: number;
  content_id: string;
  /** Collapsed cursor position in UTF-16 code units. */
  cursor_utf16: number;
  before: string;
  after: string;
  file_type: InlineFileType;
  language: string;
  generation: number;
}

/** Mirrors native `InlineCompletion`. Plain text only; no edits or paths. */
export interface InlineCompletion {
  generation: number;
  revision: number;
  content_id: string;
  cursor_utf16: number;
  text: string;
  expires_unix: number;
}

export type InlineUnavailableReason =
  | "disabled"
  | "type_disabled"
  | "api_backend"
  | "protected"
  | "locked"
  | "composing"
  | "selection"
  | "find_open"
  | "local_unavailable";

export interface InlineAvailability {
  available: boolean;
  reason: InlineUnavailableReason | null;
}

export const INLINE_FILE_TYPES: readonly InlineFileType[] = ["text", "markdown", "code"];

/** All three file types start off (D8). */
export function defaultAiInlineSettings(): AiInlineSettings {
  return {
    inline_enabled: false,
    enabled_types: { text: false, markdown: false, code: false },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Repairs a saved or incoming block field by field; unknown values fall back. */
export function normalizeAiInlineSettings(value: unknown): AiInlineSettings {
  const defaults = defaultAiInlineSettings();
  if (!isRecord(value)) return defaults;
  const types = isRecord(value.enabled_types) ? value.enabled_types : {};
  return {
    inline_enabled: flag(value.inline_enabled, defaults.inline_enabled),
    enabled_types: {
      text: flag(types.text, defaults.enabled_types.text),
      markdown: flag(types.markdown, defaults.enabled_types.markdown),
      code: flag(types.code, defaults.enabled_types.code),
    },
  };
}

/** Why a suggestion may not start, or `available` when every gate passes.
 * The order is stable so the UI can explain the first blocking reason. */
export function inlineAvailability(input: {
  backend: AssistantBackend | null;
  settings: AiInlineSettings;
  file_type: InlineFileType;
  protected_mode?: boolean;
  locked?: boolean;
  composing?: boolean;
  has_selection?: boolean;
  find_open?: boolean;
  local_ready?: boolean;
}): InlineAvailability {
  if (!input.settings.inline_enabled) return { available: false, reason: "disabled" };
  if (!input.settings.enabled_types[input.file_type]) return { available: false, reason: "type_disabled" };
  if (input.backend === "api") return { available: false, reason: "api_backend" };
  if (input.backend !== "local") return { available: false, reason: "local_unavailable" };
  if (input.protected_mode) return { available: false, reason: "protected" };
  if (input.locked) return { available: false, reason: "locked" };
  if (input.composing) return { available: false, reason: "composing" };
  if (input.has_selection) return { available: false, reason: "selection" };
  if (input.find_open) return { available: false, reason: "find_open" };
  if (input.local_ready === false) return { available: false, reason: "local_unavailable" };
  return { available: true, reason: null };
}

function fail(code = "ai_inline.unavailable"): never {
  throw new Error(code);
}

function scalars(value: string): number {
  return Array.from(value).length;
}

function safeInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}

/** Strictly validates one native-bound request (unknown fields refused). */
export function validateInlineCompletionRequest(value: unknown): InlineCompletionRequest {
  if (!isRecord(value)) fail();
  const allowed = [
    "document_id",
    "revision",
    "content_id",
    "cursor_utf16",
    "before",
    "after",
    "file_type",
    "language",
    "generation",
  ];
  if (Object.keys(value).length !== allowed.length || !allowed.every((key) => key in value)) fail();
  if (!isUuid(value.document_id) || !isUuid(value.content_id)) fail();
  const fileType = value.file_type;
  if (fileType !== "text" && fileType !== "markdown" && fileType !== "code") fail();
  if (typeof value.before !== "string" || scalars(value.before) > INLINE_MAX_BEFORE) fail();
  if (typeof value.after !== "string" || scalars(value.after) > INLINE_MAX_AFTER) fail();
  if (typeof value.language !== "string" || value.language.length < 1 || value.language.length > INLINE_MAX_LANGUAGE) fail();
  const cursor = safeInteger(value.cursor_utf16, 0, Number.MAX_SAFE_INTEGER);
  if (cursor < value.before.length) fail();
  return {
    document_id: value.document_id,
    revision: safeInteger(value.revision, 1, Number.MAX_SAFE_INTEGER),
    content_id: value.content_id,
    cursor_utf16: cursor,
    before: value.before,
    after: value.after,
    file_type: fileType,
    language: value.language,
    generation: safeInteger(value.generation, 0, 4_294_967_295),
  };
}

/** A completion must still match its request and stay plain single-paragraph
 * text of at most 256 scalars (D8/D9). */
export function validateInlineCompletion(
  value: unknown,
  request: InlineCompletionRequest,
): InlineCompletion {
  if (!isRecord(value)) fail("ai_inline.changed");
  if (value.generation !== request.generation) fail("ai_inline.changed");
  if (value.revision !== request.revision) fail("ai_inline.changed");
  if (value.content_id !== request.content_id) fail("ai_inline.changed");
  if (value.cursor_utf16 !== request.cursor_utf16) fail("ai_inline.changed");
  if (typeof value.text !== "string") fail("ai_inline.changed");
  if (scalars(value.text) > INLINE_MAX_SUGGESTION) fail("ai_inline.changed");
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.text)) fail("ai_inline.changed");
  if (scalars(value.text) === 0) fail("ai_inline.changed");
  return {
    generation: request.generation,
    revision: request.revision,
    content_id: request.content_id,
    cursor_utf16: request.cursor_utf16,
    text: value.text,
    expires_unix: safeInteger(value.expires_unix, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** The short announcement a screen reader gets once per available ghost. */
export function inlineAvailabilityLabelKey(available: boolean): string {
  return available ? "aiInline.available" : "aiInline.paused";
}

/** Tab and Escape only act when a current ghost is visible (D9). */
export const INLINE_ACCEPT_KEY = "Tab";
export const INLINE_DISMISS_KEY = "Escape";
