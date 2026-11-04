/**
 * Canonical AI wire types (Step 14c, revision `ai-runtime-1`).
 *
 * Mirrors `crates/ai-runtime/src/types.rs` and `types_ui.rs`. Fields keep the
 * exact snake_case names Rust serializes. `TimeUs` comes from 12b and is not
 * redefined here.
 */

import type { TimeUs } from "./mediaEngine";

export type JobRequestId = string;
export type ProfileId = string;

export const AI_TASK_KINDS = [
  "structured_text",
  "vision_answer",
  "embed_text",
  "embed_image",
  "transcribe",
  "upscale",
  "foreground_mask",
  "inpaint",
] as const;

export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

export type AiLocale = "en" | "es";
export type AiDevice = "auto" | "cpu" | "gpu";
export type AiTier = "auto" | "small" | "default" | "pro";
export type AiPromptTrust = "user" | "source";

export type AiUnavailableReason =
  | "disabled"
  | "pack_missing"
  | "unverified"
  | "unsupported"
  | "memory_limit"
  | "sandbox_failed";

export interface AiCapabilityStatus {
  task: AiTaskKind;
  available: boolean;
  pack_id: string | null;
  model_id: string | null;
  reason: AiUnavailableReason | null;
}

export type GpuBackend = "vulkan" | "directml";

export interface AiHardwareInfo {
  ram_bytes: number;
  available_ram_bytes: number;
  logical_cores: number;
  gpu_name: string | null;
  dedicated_vram_bytes: number | null;
  gpu_backend: GpuBackend | null;
  recommended_tier: AiTier;
}

export type AiInputKind = "document" | "snapshot" | "artifact";

export interface AiInputRef {
  kind: AiInputKind;
  id: string;
  expected_revision: number;
}

export interface AiPromptArgument {
  name: string;
  value: string;
  trust: AiPromptTrust;
}

export interface AiPromptRequest {
  template_id: string;
  template_revision: number;
  arguments: AiPromptArgument[];
  output_schema_id: string;
}

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EmbedMode = "query" | "passage";
export type EmbedTextModel = "multilingual_e5_small" | "siglip2_base";
export type EmbedImageModel = "siglip2_base";
export type TranscribeLanguage = "auto" | "en" | "es";
export type UpscaleScale = 2 | 4;
export type UpscaleModel = "general" | "photo" | "drawing";
export type ForegroundModel = "birefnet";
export type InpaintModel = "migan";

export interface StructuredTextOptions {
  kind: "structured_text";
  max_output_tokens: number;
  temperature: number;
  seed: number;
}

export interface VisionAnswerOptions {
  kind: "vision_answer";
  max_output_tokens: number;
  temperature: number;
  seed: number;
}

export interface EmbedTextOptions {
  kind: "embed_text";
  mode: EmbedMode;
  model: EmbedTextModel;
  truncate_tokens: 512;
}

export interface EmbedImageOptions {
  kind: "embed_image";
  model: EmbedImageModel;
}

export interface TranscribeOptions {
  kind: "transcribe";
  language: TranscribeLanguage;
  translate_to_english: boolean;
  start_us: TimeUs;
  end_us: TimeUs | null;
}

export interface UpscaleOptions {
  kind: "upscale";
  scale: UpscaleScale;
  model: UpscaleModel;
  preview_region: ImageRect | null;
  device: AiDevice;
}

export interface ForegroundMaskOptions {
  kind: "foreground_mask";
  model: ForegroundModel;
  threshold: number;
}

export interface InpaintOptions {
  kind: "inpaint";
  model: InpaintModel;
  mask_artifact_id: string;
}

export type AiTaskOptions =
  | StructuredTextOptions
  | VisionAnswerOptions
  | EmbedTextOptions
  | EmbedImageOptions
  | TranscribeOptions
  | UpscaleOptions
  | ForegroundMaskOptions
  | InpaintOptions;

export interface AiTaskRequest {
  request_id: JobRequestId;
  task: AiTaskKind;
  locale: AiLocale;
  inputs: AiInputRef[];
  prompt: AiPromptRequest | null;
  options: AiTaskOptions;
}

export type AiWarningCode =
  | "cpu_fallback"
  | "approximate"
  | "truncated"
  | "experimental"
  | "metadata_loss";

export type EmbeddingNormalization = "l2";

export type AiSourceLocation =
  | { kind: "text"; start: number; end: number }
  | { kind: "page"; page: number }
  | { kind: "time"; start_us: TimeUs; end_us: TimeUs }
  | { kind: "sheet"; sheet_id: string; range: string }
  | { kind: "slide"; slide_id: string }
  | { kind: "image"; region: ImageRect | null };

export interface AiCitation {
  input_id: string;
  revision: number;
  location: AiSourceLocation;
  quote: string;
}

export type AiResultPayload =
  | { kind: "structured"; schema_id: string; canonical_json: string }
  | {
      kind: "embeddings";
      artifact_id: string;
      rows: number;
      dimensions: number;
      normalization: EmbeddingNormalization;
    }
  | {
      kind: "transcript";
      artifact_id: string;
      duration_us: TimeUs;
      segment_count: number;
    }
  | { kind: "image"; artifact_id: string; width: number; height: number; mime: "image/png" }
  | { kind: "mask"; artifact_id: string; width: number; height: number };

export interface AiTaskResult {
  job_id: JobRequestId;
  task: AiTaskKind;
  model_id: string;
  model_revision: string;
  result: AiResultPayload;
  citations: AiCitation[];
  warnings: AiWarningCode[];
}

export interface AiTextChunk {
  sequence: number;
  text: string;
}

export interface AiTextPage {
  chunks: AiTextChunk[];
  after_sequence: number;
  done: boolean;
}

export type AiArtifactKind = "image" | "mask" | "embeddings" | "transcript";

export interface AiArtifactInfo {
  id: string;
  kind: AiArtifactKind;
  byte_len: number;
  expires_unix: number;
  sensitive: boolean;
}

export interface LocalAiSettings {
  enabled: boolean;
  device: AiDevice;
  tier: AiTier;
  idle_unload_seconds: number;
  memory_limit_mb: number;
  tasks: Record<AiTaskKind, boolean>;
}

/** `ai_input_acquire`: a bare file path is not authorization. */
export type AiInputAcquire =
  | { kind: "document"; document_id: string }
  | { kind: "snapshot"; snapshot_id: string; document_id: string; revision: number };

const GIB = 1_073_741_824;

export function defaultLocalAiSettings(): LocalAiSettings {
  return {
    enabled: false,
    device: "auto",
    tier: "auto",
    idle_unload_seconds: 120,
    memory_limit_mb: 4096,
    tasks: {
      structured_text: false,
      vision_answer: false,
      embed_text: false,
      embed_image: false,
      transcribe: false,
      upscale: false,
      foreground_mask: false,
      inpaint: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Schema-40 -> 41: add missing task keys, keep every other field. */
export function normalizeLocalAiSettings(value: unknown): LocalAiSettings {
  const defaults = defaultLocalAiSettings();
  const raw = isRecord(value) ? value : {};
  const rawTasks = isRecord(raw.tasks) ? raw.tasks : {};
  const tasks = { ...defaults.tasks };
  for (const kind of AI_TASK_KINDS) {
    if (typeof rawTasks[kind] === "boolean") tasks[kind] = rawTasks[kind] as boolean;
  }
  return {
    ...(raw as Partial<LocalAiSettings>),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    device: oneOf(raw.device, ["auto", "cpu", "gpu"] as const, defaults.device),
    tier: oneOf(raw.tier, ["auto", "small", "default", "pro"] as const, defaults.tier),
    idle_unload_seconds: clampInteger(raw.idle_unload_seconds, 30, 600, 120),
    memory_limit_mb: clampInteger(raw.memory_limit_mb, 512, 8192, 4096),
    tasks,
  };
}

/** Actual hardware only: no VRAM value means Pro is never recommended. */
export function recommendAiTier(hardware: {
  ram_bytes: number;
  dedicated_vram_bytes: number | null;
}): AiTier {
  const ram = Number.isSafeInteger(hardware.ram_bytes) && hardware.ram_bytes > 0
    ? hardware.ram_bytes
    : 0;
  const vram =
    typeof hardware.dedicated_vram_bytes === "number" &&
    Number.isSafeInteger(hardware.dedicated_vram_bytes)
      ? hardware.dedicated_vram_bytes
      : null;
  if (ram <= 8 * GIB) return "small";
  if (ram >= 16 * GIB && vram !== null && vram >= 8 * GIB) return "pro";
  return "default";
}

export function isUpscaleResult(
  result: AiTaskResult,
): result is AiTaskResult & { result: Extract<AiResultPayload, { kind: "image" }> } {
  return result.task === "upscale" && result.result.kind === "image";
}
