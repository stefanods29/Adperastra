import { invoke } from "@tauri-apps/api/core";
import type { AiPromptArgument, AiTaskRequest } from "./localAiTypes";
import { newRequestId, runJob, type JobHandle } from "./jobs";
import type { ExportSnapshot } from "./exportSnapshots";
import type { InlineCompletion, InlineCompletionRequest } from "../editor/aiInlineTypes";
import {
  inlineAvailability,
  validateInlineCompletionRequest,
} from "../editor/aiInlineTypes";
import {
  MAX_EXTRACTION_INPUTS,
  MAX_MODEL_PAYLOAD_BYTES,
  PREPARED_TTL_SECONDS,
  type ExtractionCorrection,
  type ExtractionPreparedRequest,
  type ExtractionPublish,
  type ExtractionRequest,
  type ExtractionReview,
  type ExtractionSource,
} from "./aiExtractionTypes";
import {
  validateExtractionCorrection,
  validateExtractionPublish,
  validateExtractionRequest,
  validateExtractionReview,
} from "./aiExtractionValidation";
import { prepareAssistantInference } from "./assistantInference";
import { loadSettings } from "./settings";

/** Typed extraction and inline services (Step 17d T3/T6, E2/E4).
 *
 * No component calls `invoke`. Local OCR/layout preparation runs before any
 * outbound review; an API backend needs one explicit Send, bound to the exact
 * payload, and is never retried automatically. Inline suggestions only exist
 * while Local AI is selected (D8): a typing pause cannot authorize an upload.
 */

/** What the native preparation returns before any network access. */
export interface NativePreparedExtraction {
  id: string;
  sources: ExtractionSource[];
  arguments: { name: string; value: string }[];
}

/** One prepared request may be sent once; a retry is a new explicit action. */
export const EXTRACTION_SENDS_PER_PREPARED = 1;

export interface ExtractionStartGuard {
  ok: boolean;
  /** Requests this call would start. */
  network: number;
  error: string | null;
}

const PROMPTS: Record<ExtractionRequest["kind"], string> = {
  document: "extraction.document.v1",
  tables: "extraction.table.v1",
  receipts: "extraction.receipt.v1",
};

const SCHEMAS: Record<ExtractionRequest["kind"], string> = {
  document: "extraction.document.v1",
  tables: "extraction.table.v1",
  receipts: "extraction.receipt.v1",
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function promptArguments(prepared: NativePreparedExtraction): AiPromptArgument[] {
  return prepared.arguments.slice(0, 32).map((argument) => ({
    name: argument.name,
    value: argument.value.slice(0, 65_536),
    trust: "source" as const,
  }));
}

function buildTaskRequest(
  request: ExtractionRequest,
  prepared: NativePreparedExtraction,
): AiTaskRequest {
  return {
    request_id: newRequestId("aiext"),
    task: "structured_text",
    locale: request.locale,
    inputs: request.inputs,
    prompt: {
      template_id: PROMPTS[request.kind],
      template_revision: 1,
      arguments: promptArguments(prepared),
      output_schema_id: SCHEMAS[request.kind],
    },
    options: {
      kind: "structured_text",
      max_output_tokens: 2048,
      temperature: 0,
      seed: 0,
    },
  };
}

/** Local OCR and layout first, then one exact outbound preview; no network. */
export async function prepareExtraction(
  request: ExtractionRequest,
): Promise<ExtractionPreparedRequest> {
  const typed = validateExtractionRequest(request);
  const job = await runJob<NativePreparedExtraction>("aiprep", (requestId) =>
    invoke("ai_extract_prepare_start", { requestId, request: typed }),
  );
  const prepared = await job.completion;
  if (!Array.isArray(prepared.sources) || prepared.sources.length < 1) {
    throw new Error("ai_extract.failed");
  }
  const outbound = await prepareAssistantInference(buildTaskRequest(typed, prepared));
  return {
    id: prepared.id,
    request: typed,
    sources: prepared.sources,
    outbound_preview: outbound,
    expires_unix: nowSeconds() + PREPARED_TTL_SECONDS,
  };
}

/** Start the extraction job. `outboundConsentId` is required for an API
 * backend and must be null for Local AI (which never sends anything). */
export async function extractSources(
  request: ExtractionRequest,
  preparedId: string,
  outboundConsentId: string | null,
): Promise<JobHandle<ExtractionReview>> {
  const typed = validateExtractionRequest(request);
  return runJob<ExtractionReview>("aiext", (requestId) =>
    invoke("ai_extract_start", {
      requestId,
      request: typed,
      preparedId,
      outboundConsentId,
    }),
  );
}

/** One bounded page of an immutable review; the cursor is bound to its
 * review id and revision and expires with the review. */
export async function extractionPage(reviewId: string, cursor: string): Promise<ExtractionReview> {
  return validateExtractionReview(
    await invoke("ai_extract_page", { reviewId, cursor }),
  );
}

/** Apply typed corrections atomically; the revision check is the CAS. */
export async function correctExtraction(
  reviewId: string,
  expectedRevision: number,
  corrections: readonly ExtractionCorrection[],
): Promise<ExtractionReview> {
  if (corrections.length > 1000) throw new Error("ai_extract.invalid");
  const typed = corrections.map(validateExtractionCorrection);
  return validateExtractionReview(
    await invoke("ai_extract_correct", {
      reviewId,
      expectedRevision,
      corrections: typed,
    }),
  );
}

/** Capture the corrected model as an immutable 08a snapshot (no publish). */
export async function captureExtraction(
  request: ExtractionPublish,
): Promise<JobHandle<ExportSnapshot>> {
  const typed = validateExtractionPublish(request);
  return runJob<ExportSnapshot>("aiexpc", (requestId) =>
    invoke("ai_extract_capture_start", { requestId, request: typed }),
  );
}

/** Release OCR/pixel/snapshot grants. Idempotent: an unknown id is gone. */
export async function releaseExtraction(reviewId: string): Promise<void> {
  try {
    await invoke("ai_extract_release", { reviewId });
  } catch {
    // The review expired or was already released.
  }
}

/** Only the Local AI backend may run inline suggestions (D8). */
export async function requestInlineCompletion(
  request: InlineCompletionRequest,
): Promise<JobHandle<InlineCompletion>> {
  const typed = validateInlineCompletionRequest(request);
  const settings = await loadSettings();
  const availability = inlineAvailability({
    backend: settings.assistant.backend,
    settings: settings.ai.writing,
    file_type: typed.file_type,
  });
  if (!availability.available) throw new Error("ai_inline.unavailable");
  return runJob<InlineCompletion>("aiinline", (requestId) =>
    invoke("ai_inline_start", { requestId, request: typed }),
  );
}

/** An API extraction needs the one-shot outbound Send; local never does. */
export function requiresOutboundConsent(prepared: ExtractionPreparedRequest): boolean {
  return prepared.outbound_preview.backend === "api" && prepared.outbound_preview.requires_consent;
}

/** Decide whether the extraction may start, and how many network requests
 * that would make. Sensitive sources never reach an API provider. */
export function guardExtractionStart(
  prepared: ExtractionPreparedRequest,
  outboundConsentId: string | null,
  state: { source_changed?: boolean; sensitive?: boolean } = {},
): ExtractionStartGuard {
  const api = prepared.outbound_preview.backend === "api";
  if (state.sensitive || prepared.sources.some((source) => source.sensitive)) {
    if (api) return { ok: false, network: 0, error: "ai_extract.unsupported" };
  }
  if (state.source_changed) return { ok: false, network: 0, error: "ai_extract.changed" };
  if (requiresOutboundConsent(prepared) && !outboundConsentId) {
    return { ok: false, network: 0, error: "assistant.outbound_required" };
  }
  return { ok: true, network: api ? 1 : 0, error: null };
}

/** There is no automatic retry: one explicit Send per prepared request. */
export function canSendPrepared(sends: number): boolean {
  return Number.isInteger(sends) && sends >= 0 && sends < EXTRACTION_SENDS_PER_PREPARED;
}

/** The model payload is capped at 256 KiB before it leaves the app. */
export function modelPayloadTooLarge(bytes: number): boolean {
  return !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_MODEL_PAYLOAD_BYTES;
}

/** A review may select 1..100 sources; the UI shows the count. */
export function extractionSourceCountOk(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= MAX_EXTRACTION_INPUTS;
}

