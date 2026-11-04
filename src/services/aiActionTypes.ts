import type { AiTaskOptions } from "./localAiTypes";
import type { AiCitation, AiInputRef } from "./localAiTypes";
import type { TimeUs } from "./engineTypes";
import type { AssistantProviderId } from "../assistant/types";

/**
 * Canonical AI-action data shapes (Step 17b, interface `ai-actions-1`).
 * Native mirror: `src-tauri/src/ai_action_types.rs`.
 *
 * `AiInputRef`/`AiCitation`/`AiTaskOptions` come from 14c and
 * `AssistantProviderId` from 17a; this file never redefines them.
 * Image, speech and upscaling actions stay local. Text actions use the
 * selected assistant backend (17a), which owns outbound consent.
 */

export const AI_ACTION_IDS = [
  "remove_background",
  "blur_background",
  "erase_object",
  "copy_text",
  "describe_image",
  "ask_image",
  "upscale",
  "summarize",
  "create_faq",
  "translate",
  "key_points",
  "ask_file",
  "transcribe",
  "summarize_media",
  "find_moments",
  "compare_documents",
  "summarize_folder",
] as const;

export type AiActionId = (typeof AI_ACTION_IDS)[number];

/** Every action that needs a model pack or the assistant backend. */
export const MODEL_ACTION_IDS: readonly AiActionId[] = AI_ACTION_IDS.filter(
  (id) => id !== "copy_text",
);

export type AiActionInputKind = "image" | "document" | "audio" | "video" | "multiple" | "folder";

export type AiSpeechLanguage = "auto" | "en" | "es";

export const AI_ACTIONS_SETTINGS_SCHEMA_VERSION = 45;
export const AI_ACTIONS_CAPTION_WINDOW_SECONDS = 30;
export const AI_ACTION_MAX_INPUTS = 100;
export const AI_ACTION_MAX_QUESTION = 4096;
export const AI_ACTION_MAX_TARGET_LANGUAGE = 35;
export const AI_ACTION_MAX_QUERY = 512;
export const AI_ACTION_MAX_BLOCKS = 64;
export const AI_ACTION_MAX_PLAIN_TEXT = 8192;
export const AI_ACTION_MAX_CITATIONS = 256;
export const AI_ACTION_MAX_WARNINGS = 32;
export const AI_ACTION_MAX_FAQ_PAIRS = 12;
export const AI_ACTION_MAX_TRANSLATION_PAIRS = 32;
export const AI_ACTION_MAX_ACTION_ITEMS = 32;
export const AI_ACTION_MAX_MOMENTS = 20;
export const AI_ACTION_MAX_COMPARISON_POINTS = 32;
export const AI_ACTION_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export type AiActionErrorCode =
  | "ai_actions.invalid"
  | "ai_actions.unsupported"
  | "ai_actions.too_large"
  | "ai_actions.source_changed"
  | "ai_actions.empty_mask"
  | "ai_actions.image_mask_too_large"
  | "ai_actions.no_sources"
  | "ai_actions.language_unsupported"
  | "ai_actions.failed";

/** Settings 44 -> 45. `copy_text` is governed by the 07e OCR preference. */
export interface AiActionsSettings {
  enabled: Record<string, boolean>;
  transcription_language: AiSpeechLanguage;
  caption_language: AiSpeechLanguage;
  caption_window_seconds: 30;
  dictation_language: "en" | "es";
}

export function defaultAiActionsSettings(appLanguage: string = "en"): AiActionsSettings {
  const enabled: Record<string, boolean> = {};
  for (const id of MODEL_ACTION_IDS) enabled[id] = false;
  return {
    enabled,
    transcription_language: "auto",
    caption_language: "auto",
    caption_window_seconds: AI_ACTIONS_CAPTION_WINDOW_SECONDS,
    dictation_language: appLanguage === "es" ? "es" : "en",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function speechLanguage(value: unknown, fallback: AiSpeechLanguage): AiSpeechLanguage {
  return value === "auto" || value === "en" || value === "es" ? value : fallback;
}

/** Missing keys default to off/false; other settings are preserved. */
export function normalizeAiActionsSettings(
  value: unknown,
  appLanguage: string = "en",
): AiActionsSettings {
  const defaults = defaultAiActionsSettings(appLanguage);
  if (!isRecord(value)) return defaults;
  const enabled: Record<string, boolean> = { ...defaults.enabled };
  if (isRecord(value.enabled)) {
    for (const id of MODEL_ACTION_IDS) {
      const entry = value.enabled[id];
      if (typeof entry === "boolean") enabled[id] = entry;
    }
  }
  const dictation = value.dictation_language;
  return {
    enabled,
    transcription_language: speechLanguage(value.transcription_language, "auto"),
    caption_language: speechLanguage(value.caption_language, "auto"),
    caption_window_seconds: AI_ACTIONS_CAPTION_WINDOW_SECONDS,
    dictation_language: dictation === "es" || dictation === "en" ? dictation : defaults.dictation_language,
  };
}

export interface AiActionSpec {
  id: AiActionId;
  label_key: string;
  help_slug: string;
  required_capabilities: string[];
  input_kind: AiActionInputKind;
  min_inputs: number;
  max_inputs: number;
  local_only: boolean;
  preview_required: boolean;
}

/** Capability ids used by 14c status rows and the 17a assistant backend. */
export const AI_CAPABILITY_FOREGROUND = "ai.foreground_mask";
export const AI_CAPABILITY_INPAINT = "ai.inpaint";
export const AI_CAPABILITY_TRANSCRIBE = "ai.transcribe";
export const AI_CAPABILITY_UPSCALE = "ai.upscale";
export const AI_CAPABILITY_TEXT = "assistant.structured_text";
export const AI_CAPABILITY_VISION = "assistant.vision_answer";
/** Windows OCR from 07e; no pack and no assistant model. */
export const AI_CAPABILITY_OCR = "ocr.windows";

export type AiActionOptions =
  | { kind: "remove_background" }
  | { kind: "blur_background"; radius: number }
  | { kind: "erase_object"; mask_artifact_id: string }
  | { kind: "copy_text"; language: string }
  | { kind: "describe_image"; question: string }
  | { kind: "ask_image"; question: string }
  | { kind: "upscale"; options: Extract<AiTaskOptions, { kind: "upscale" }> }
  | { kind: "summarize" }
  | { kind: "create_faq" }
  | { kind: "translate"; target_language: string }
  | { kind: "key_points" }
  | { kind: "ask_file"; question: string }
  | { kind: "transcribe"; start_us: TimeUs | null; end_us: TimeUs | null; language: AiSpeechLanguage }
  | { kind: "summarize_media"; start_us: TimeUs | null; end_us: TimeUs | null; language: AiSpeechLanguage }
  | { kind: "find_moments"; query: string; start_us: TimeUs | null; end_us: TimeUs | null }
  | { kind: "compare_documents" }
  | {
      kind: "summarize_folder";
      root_id: string;
      recursive: boolean;
      include_contents: boolean;
      approved_input_ids: string[];
    };

/** Compact erase-mask description; the native side paints the pixels. */
export interface AiBrushSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  radius: number;
}

export type AiMaskSpec =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "strokes"; strokes: AiBrushSegment[] };

export interface AiActionRequest {
  action: AiActionId;
  inputs: AiInputRef[];
  options: AiActionOptions;
  request_revision: number;
  expected_content_id: string | null;
  scope_id: string | null;
  outbound_consent_id: string | null;
}

export type AiSuggestionKind = "paragraph" | "bullet" | "heading";

export interface AiSuggestionBlock {
  id: string;
  kind: AiSuggestionKind;
  plain_text: string;
  citations: AiCitation[];
}

export interface AiFaqPair {
  question: string;
  answer: string;
  citations: AiCitation[];
}

export interface AiSourceLocation {
  input_id: string;
  location: string;
}

export interface AiTranslationPair {
  source_input_id: string;
  source_location: AiSourceLocation;
  source_text: string;
  translated_text: string;
  target_language: string;
  citations: AiCitation[];
}

export interface AiActionItem {
  text: string;
  assignee: string | null;
  due_text: string | null;
  citations: AiCitation[];
}

export interface AiMoment {
  id: string;
  segment_indices: number[];
  start_us: TimeUs;
  end_us: TimeUs;
  label: string;
  citations: AiCitation[];
}

export type AiComparisonKind = "agreement" | "difference" | "unknown";

export interface AiComparisonPoint {
  kind: AiComparisonKind;
  left_text: string;
  right_text: string;
  left_citations: AiCitation[];
  right_citations: AiCitation[];
}

export interface AiImagePayload {
  artifact_id: string;
  width: number;
  height: number;
}

export interface AiTranscriptRef {
  id: string;
  source_input_id: string;
  source_revision: number;
  language: string;
  duration_us: TimeUs;
  segment_count: number;
  partial: boolean;
  model_id: string;
  model_revision: string;
  expires_unix: number;
}

export interface AiFolderSkipped {
  label: string;
  reason_code: string;
}

export type AiActionPayload =
  | { kind: "image"; image: AiImagePayload }
  | { kind: "text"; blocks: AiSuggestionBlock[] }
  | { kind: "faq"; pairs: AiFaqPair[] }
  | { kind: "translation"; pairs: AiTranslationPair[] }
  | { kind: "key_points"; points: AiSuggestionBlock[]; actions: AiActionItem[] }
  | { kind: "transcript"; info: AiTranscriptRef }
  | { kind: "moments"; items: AiMoment[] }
  | { kind: "comparison"; points: AiComparisonPoint[] }
  | {
      kind: "folder_summary";
      blocks: AiSuggestionBlock[];
      included_input_ids: string[];
      skipped: AiFolderSkipped[];
      partial: boolean;
      names_only: boolean;
    };

export interface AiActionResult {
  id: string;
  action: AiActionId;
  inputs: AiInputRef[];
  payload: AiActionPayload;
  backend: "local" | "api";
  provider_id: AssistantProviderId | null;
  model_id: string;
  model_revision: string;
  citations: AiCitation[];
  warnings: string[];
  sensitive: boolean;
  created_unix: number;
  expires_unix: number;
  generation: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE_RE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

export function isAiActionId(value: unknown): value is AiActionId {
  return typeof value === "string" && (AI_ACTION_IDS as readonly string[]).includes(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isValidTargetLanguage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= AI_ACTION_MAX_TARGET_LANGUAGE && LANGUAGE_RE.test(value);
}

function fail(code: AiActionErrorCode): never {
  throw new Error(code);
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function optionalTime(value: unknown): TimeUs | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("ai_actions.invalid");
  return value as number;
}

function validateRange(start: TimeUs | null, end: TimeUs | null): void {
  if (start !== null && end !== null && end <= start) fail("ai_actions.invalid");
}

function questionOf(value: unknown): string {
  if (typeof value !== "string" || scalarLength(value) === 0 || scalarLength(value) > AI_ACTION_MAX_QUESTION) {
    fail("ai_actions.invalid");
  }
  return value;
}

/** Validates exactly the keys each action allows; unknown keys fail. */
export function parseAiActionOptions(action: unknown, value: unknown): AiActionOptions {
  if (!isAiActionId(action)) fail("ai_actions.invalid");
  if (!isRecord(value)) fail("ai_actions.invalid");
  const keys = Object.keys(value).filter((key) => key !== "kind");
  const only = (...allowed: string[]): void => {
    if (keys.some((key) => !allowed.includes(key))) fail("ai_actions.invalid");
  };
  if (value.kind !== action) fail("ai_actions.invalid");
  switch (action) {
    case "remove_background":
      only();
      return { kind: "remove_background" };
    case "blur_background": {
      only("radius");
      const radius = value.radius;
      if (!Number.isInteger(radius) || (radius as number) < 1 || (radius as number) > 64) fail("ai_actions.invalid");
      return { kind: "blur_background", radius: radius as number };
    }
    case "erase_object":
      only("mask_artifact_id");
      if (!isUuid(value.mask_artifact_id)) fail("ai_actions.empty_mask");
      return { kind: "erase_object", mask_artifact_id: value.mask_artifact_id };
    case "copy_text": {
      only("language");
      const language = value.language === undefined ? "auto" : value.language;
      if (language !== "auto" && !isValidTargetLanguage(language)) fail("ai_actions.invalid");
      return { kind: "copy_text", language: language as string };
    }
    case "describe_image":
      only("question");
      return { kind: "describe_image", question: questionOf(value.question) };
    case "ask_image":
      only("question");
      return { kind: "ask_image", question: questionOf(value.question) };
    case "upscale": {
      only("options");
      if (!isRecord(value.options) || value.options.kind !== "upscale") fail("ai_actions.invalid");
      return { kind: "upscale", options: value.options as unknown as Extract<AiTaskOptions, { kind: "upscale" }> };
    }
    case "summarize":
      only();
      return { kind: "summarize" };
    case "create_faq":
      only();
      return { kind: "create_faq" };
    case "translate":
      only("target_language");
      if (!isValidTargetLanguage(value.target_language)) fail("ai_actions.invalid");
      return { kind: "translate", target_language: value.target_language };
    case "key_points":
      only();
      return { kind: "key_points" };
    case "ask_file":
      only("question");
      return { kind: "ask_file", question: questionOf(value.question) };
    case "transcribe":
    case "summarize_media": {
      only("start_us", "end_us", "language");
      const start = optionalTime(value.start_us);
      const end = optionalTime(value.end_us);
      validateRange(start, end);
      return {
        kind: action,
        start_us: start,
        end_us: end,
        language: speechLanguage(value.language, "auto"),
      };
    }
    case "find_moments": {
      only("query", "start_us", "end_us");
      if (typeof value.query !== "string" || scalarLength(value.query) === 0 || scalarLength(value.query) > AI_ACTION_MAX_QUERY) {
        fail("ai_actions.invalid");
      }
      const start = optionalTime(value.start_us);
      const end = optionalTime(value.end_us);
      validateRange(start, end);
      return { kind: "find_moments", query: value.query, start_us: start, end_us: end };
    }
    case "compare_documents":
      only();
      return { kind: "compare_documents" };
    case "summarize_folder": {
      only("root_id", "recursive", "include_contents", "approved_input_ids");
      if (!isUuid(value.root_id)) fail("ai_actions.invalid");
      if (typeof value.recursive !== "boolean" || typeof value.include_contents !== "boolean") fail("ai_actions.invalid");
      if (!Array.isArray(value.approved_input_ids)) fail("ai_actions.invalid");
      if (value.approved_input_ids.length > AI_ACTION_MAX_INPUTS) fail("ai_actions.too_large");
      if (!value.approved_input_ids.every(isUuid)) fail("ai_actions.invalid");
      return {
        kind: "summarize_folder",
        root_id: value.root_id,
        recursive: value.recursive,
        include_contents: value.include_contents,
        approved_input_ids: value.approved_input_ids,
      };
    }
    default:
      return fail("ai_actions.invalid");
  }
}

/** Refuses wrong counts before anything is read or sent. */
export function validateAiActionInputs(
  action: AiActionId,
  inputs: readonly AiInputRef[],
  spec: AiActionSpec,
): void {
  if (!Array.isArray(inputs) || inputs.length < spec.min_inputs || inputs.length > spec.max_inputs) {
    fail("ai_actions.invalid");
  }
  if (inputs.length > AI_ACTION_MAX_INPUTS) fail("ai_actions.too_large");
  for (const input of inputs) {
    if (!isRecord(input) || !isUuid(input.id) || !["document", "snapshot", "artifact"].includes(input.kind as string)) {
      fail("ai_actions.invalid");
    }
    if (!Number.isSafeInteger(input.expected_revision) || (input.expected_revision as number) < 1) {
      fail("ai_actions.invalid");
    }
  }
  if (action === "compare_documents" && inputs.length !== 2) fail("ai_actions.invalid");
  if (action === "summarize_folder" && inputs.length > 0) {
    // A folder request names its approved inputs in the options, not here.
    fail("ai_actions.invalid");
  }
}

export function parseAiActionRequest(value: unknown): AiActionRequest {
  if (!isRecord(value) || !isAiActionId(value.action)) fail("ai_actions.invalid");
  if (!Array.isArray(value.inputs)) fail("ai_actions.invalid");
  if (!Number.isSafeInteger(value.request_revision) || (value.request_revision as number) < 1) {
    fail("ai_actions.invalid");
  }
  for (const field of ["expected_content_id", "scope_id", "outbound_consent_id"] as const) {
    const entry = value[field];
    if (entry !== null && entry !== undefined && !isUuid(entry)) fail("ai_actions.invalid");
  }
  const options = parseAiActionOptions(value.action, value.options);
  return {
    action: value.action,
    inputs: value.inputs as AiInputRef[],
    options,
    request_revision: value.request_revision as number,
    expected_content_id: (value.expected_content_id as string | null) ?? null,
    scope_id: (value.scope_id as string | null) ?? null,
    outbound_consent_id: (value.outbound_consent_id as string | null) ?? null,
  };
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string" || scalarLength(value) > max) fail("ai_actions.invalid");
  return value;
}

function citations(value: unknown): AiCitation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) fail("ai_actions.invalid");
  return value as AiCitation[];
}

/** Validates a native result before the UI shows or exports anything. */
export function parseAiActionResult(value: unknown): AiActionResult {
  if (!isRecord(value) || !isUuid(value.id) || !isAiActionId(value.action)) fail("ai_actions.invalid");
  if (!Array.isArray(value.inputs) || (value.inputs as unknown[]).length > AI_ACTION_MAX_INPUTS) fail("ai_actions.invalid");
  if (value.backend !== "local" && value.backend !== "api") fail("ai_actions.invalid");
  if (!isRecord(value.payload) || typeof value.payload.kind !== "string") fail("ai_actions.invalid");
  const payload = value.payload;
  switch (payload.kind) {
    case "image":
      if (!isRecord(payload.image) || !isUuid(payload.image.artifact_id)) fail("ai_actions.invalid");
      break;
    case "text":
      if (!Array.isArray(payload.blocks) || payload.blocks.length > AI_ACTION_MAX_BLOCKS) fail("ai_actions.invalid");
      for (const block of payload.blocks as unknown[]) {
        if (!isRecord(block) || !boundedText(block.plain_text, AI_ACTION_MAX_PLAIN_TEXT)) fail("ai_actions.invalid");
        citations(block.citations);
      }
      break;
    case "faq":
      if (!Array.isArray(payload.pairs) || payload.pairs.length > AI_ACTION_MAX_FAQ_PAIRS) fail("ai_actions.invalid");
      break;
    case "translation":
      if (!Array.isArray(payload.pairs) || payload.pairs.length > AI_ACTION_MAX_TRANSLATION_PAIRS) fail("ai_actions.invalid");
      break;
    case "key_points":
      if (!Array.isArray(payload.points) || !Array.isArray(payload.actions)) fail("ai_actions.invalid");
      if (payload.actions.length > AI_ACTION_MAX_ACTION_ITEMS) fail("ai_actions.invalid");
      break;
    case "transcript":
      if (!isRecord(payload.info) || !isUuid(payload.info.id)) fail("ai_actions.invalid");
      break;
    case "moments":
      if (!Array.isArray(payload.items) || payload.items.length > AI_ACTION_MAX_MOMENTS) fail("ai_actions.invalid");
      break;
    case "comparison":
      if (!Array.isArray(payload.points) || payload.points.length > AI_ACTION_MAX_COMPARISON_POINTS) fail("ai_actions.invalid");
      break;
    case "folder_summary":
      if (!Array.isArray(payload.blocks) || !Array.isArray(payload.skipped)) fail("ai_actions.invalid");
      break;
    default:
      fail("ai_actions.invalid");
  }
  if (!Array.isArray(value.citations) || (value.citations as unknown[]).length > AI_ACTION_MAX_CITATIONS) {
    fail("ai_actions.invalid");
  }
  if (!Array.isArray(value.warnings) || (value.warnings as unknown[]).length > AI_ACTION_MAX_WARNINGS) {
    fail("ai_actions.invalid");
  }
  if (typeof value.sensitive !== "boolean") fail("ai_actions.invalid");
  if (!Number.isSafeInteger(value.created_unix) || !Number.isSafeInteger(value.expires_unix)) {
    fail("ai_actions.invalid");
  }
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 1) fail("ai_actions.invalid");
  return value as unknown as AiActionResult;
}

/**
 * A saved copy always gets a new file name; a path or an empty stem is
 * refused. The native publisher additionally uses CREATE_NEW, so an existing
 * file is never replaced even if the name looks free here.
 */
export function safeExportName(base: string, extension: "txt" | "srt" | "vtt"): string {
  const stem = base.trim().replace(/\.+$/, "");
  if (stem.length === 0 || stem.length > 200) throw new Error("ai_actions.invalid");
  if (/[\\/:*?"<>|]/.test(stem) || stem === "." || stem === "..") throw new Error("ai_actions.invalid");
  return `${stem}.${extension}`;
}

/** Bounded plain text for SRT/VTT/UI: no markup is ever interpreted. */
export function plainText(value: string, max: number = AI_ACTION_MAX_PLAIN_TEXT): string {
  const cleaned = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return Array.from(cleaned).slice(0, max).join("");
}
