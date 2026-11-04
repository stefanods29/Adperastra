import type { AiInputRef } from "./localAiTypes";
import type { TimeUs } from "./engineTypes";

/**
 * Canonical speech types (Step 17b, revision `speech-1`).
 * Native mirror: `src-tauri/src/speech_types.rs`.
 *
 * Speech runs locally with the optional Speech tools pack and never uses the
 * assistant backend or the network. Whisper reports centisecond ticks; this
 * module converts them exactly once into integer microseconds.
 */

export type SpeechLanguage = "auto" | "en" | "es";

/** Whisper timestamp ticks are 10 ms. */
export const WHISPER_TICK_US = 10_000;
export const TRANSCRIPT_PAGE_SEGMENTS = 200;
export const TRANSCRIPT_PAGE_BYTES = 128 * 1024;
export const MAX_TRANSCRIPT_SEGMENTS = 100_000;
export const MAX_TRANSCRIPT_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_TRANSCRIPT_SECONDS = 3_600;
export const CAPTION_WINDOW_SECONDS = 30;
export const CAPTION_OVERLAP_SECONDS = 1;
export const MAX_RETAINED_TRANSCRIPTS = 16;
export const TRANSCRIPT_MEMORY_BUDGET = 64 * 1024 * 1024;
export const TRANSCRIPT_SENSITIVE_BUDGET = 4 * 1024 * 1024;
export const DICTATION_MAX_SECONDS = 120;
export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MAX_BYTES = 7_680_000;
export const DICTATION_MAX_FLOAT_BYTES = DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE * 4;

export type SpeechErrorCode =
  | "speech.invalid"
  | "speech.pack_missing"
  | "speech.permission_denied"
  | "speech.device_unavailable"
  | "speech.too_long"
  | "speech.expired"
  | "speech.changed"
  | "speech.failed";

export interface TranscriptionRequest {
  input: AiInputRef;
  language: SpeechLanguage;
  /** Fixed false: this step never asks for a forced translation. */
  translate_to_english: false;
  start_us: TimeUs;
  end_us: TimeUs | null;
}

export interface TranscriptInfo {
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

/** The serialized text field is `text`, never `plain_text`. */
export interface TranscriptSegment {
  id: string;
  index: number;
  start_us: TimeUs;
  end_us: TimeUs;
  text: string;
  confidence: number | null;
  speaker_id: null;
}

export interface TranscriptPage {
  transcript_id: string;
  segments: TranscriptSegment[];
  next_index: number | null;
}

export type DictationState = "recording" | "processing" | "stopped";

export interface DictationRequest {
  document_id: string;
  expected_revision: number;
  expected_content_id: string;
  language: "en" | "es";
  max_seconds: number;
}

export interface DictationSession {
  id: string;
  document_id: string;
  expected_revision: number;
  expected_content_id: string;
  state: DictationState;
  started_unix: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSpeechUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function fail(code: SpeechErrorCode): never {
  throw new Error(code);
}

/** Centisecond ticks -> integer microseconds, checked. */
export function whisperTicksToUs(ticks: number): TimeUs {
  if (!Number.isSafeInteger(ticks) || ticks < 0) fail("speech.invalid");
  const micros = BigInt(ticks) * BigInt(WHISPER_TICK_US);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) fail("speech.invalid");
  return Number(micros);
}

/** A segment ends after it starts; the end time is exclusive. */
export function segmentIsValid(startUs: TimeUs, endUs: TimeUs): boolean {
  return Number.isSafeInteger(startUs) && Number.isSafeInteger(endUs) && startUs >= 0 && endUs > startUs;
}

export function validateTranscriptionRequest(request: TranscriptionRequest): TranscriptionRequest {
  if (!request || typeof request !== "object") fail("speech.invalid");
  if (!request.input || !isSpeechUuid(request.input.id)) fail("speech.invalid");
  if (!["document", "snapshot", "artifact"].includes(request.input.kind)) fail("speech.invalid");
  if (!Number.isSafeInteger(request.input.expected_revision) || request.input.expected_revision < 1) {
    fail("speech.invalid");
  }
  if (!["auto", "en", "es"].includes(request.language)) fail("speech.invalid");
  if (request.translate_to_english !== false) fail("speech.invalid");
  const start = request.start_us;
  if (!Number.isSafeInteger(start) || start < 0) fail("speech.invalid");
  const end = request.end_us;
  if (end !== null) {
    if (!Number.isSafeInteger(end) || end <= start) fail("speech.invalid");
    if ((end - start) / 1_000_000 > MAX_TRANSCRIPT_SECONDS) fail("speech.too_long");
  }
  return { ...request, translate_to_english: false };
}

export function parseTranscriptInfo(value: unknown): TranscriptInfo {
  if (!value || typeof value !== "object") fail("speech.invalid");
  const info = value as TranscriptInfo;
  if (!isSpeechUuid(info.id) || !isSpeechUuid(info.source_input_id)) fail("speech.invalid");
  if (!Number.isSafeInteger(info.source_revision) || info.source_revision < 1) fail("speech.invalid");
  if (!Number.isSafeInteger(info.duration_us) || info.duration_us < 0) fail("speech.invalid");
  if (!Number.isSafeInteger(info.segment_count) || info.segment_count < 0 || info.segment_count > MAX_TRANSCRIPT_SEGMENTS) {
    fail("speech.invalid");
  }
  if (typeof info.language !== "string" || info.language.length === 0 || info.language.length > 32) fail("speech.invalid");
  return info;
}

export function parseTranscriptPage(value: unknown): TranscriptPage {
  if (!value || typeof value !== "object") fail("speech.invalid");
  const page = value as TranscriptPage;
  if (!isSpeechUuid(page.transcript_id)) fail("speech.invalid");
  if (!Array.isArray(page.segments) || page.segments.length > TRANSCRIPT_PAGE_SEGMENTS) fail("speech.invalid");
  let bytes = 0;
  let previousEnd = -1;
  for (const segment of page.segments) {
    if (!isSpeechUuid(segment.id)) fail("speech.invalid");
    if (!Number.isSafeInteger(segment.index) || segment.index < 0) fail("speech.invalid");
    if (!segmentIsValid(segment.start_us, segment.end_us)) fail("speech.invalid");
    if (segment.start_us < previousEnd) fail("speech.invalid");
    previousEnd = segment.end_us;
    if (segment.speaker_id !== null) fail("speech.invalid");
    if (typeof segment.text !== "string") fail("speech.invalid");
    bytes += new TextEncoder().encode(segment.text).byteLength;
    if (bytes > TRANSCRIPT_PAGE_BYTES) fail("speech.invalid");
  }
  if (page.next_index !== null && (!Number.isSafeInteger(page.next_index) || page.next_index < 0)) {
    fail("speech.invalid");
  }
  return page;
}

export function validateDictationRequest(request: DictationRequest): DictationRequest {
  if (!request || typeof request !== "object") fail("speech.invalid");
  if (!isSpeechUuid(request.document_id) || !isSpeechUuid(request.expected_content_id)) fail("speech.invalid");
  if (!Number.isSafeInteger(request.expected_revision) || request.expected_revision < 1) fail("speech.invalid");
  if (request.language !== "en" && request.language !== "es") fail("speech.invalid");
  if (!Number.isInteger(request.max_seconds) || request.max_seconds < 1 || request.max_seconds > DICTATION_MAX_SECONDS) {
    fail("speech.invalid");
  }
  return request;
}

/** Exact frame count for the 120 s mono 16 kHz float cap. */
export function dictationFrameCap(maxSeconds: number): number {
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > DICTATION_MAX_SECONDS) {
    fail("speech.invalid");
  }
  return maxSeconds * DICTATION_SAMPLE_RATE;
}
