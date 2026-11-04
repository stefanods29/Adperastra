import { invoke } from "@tauri-apps/api/core";
import type { ConversionReport, ConversionRequest } from "../convert/types";
import { runJob, type JobHandle } from "./jobs";
import type { AiActionRequest, AiActionResult, AiMaskSpec } from "./aiActionTypes";
import { isUuid, parseAiActionResult, parseAiActionRequest } from "./aiActionTypes";

/**
 * The only module that calls the AI-action commands (`ai-actions-1` E1/E2).
 *
 * `ai_action_start` validates the typed request, checks the installed and
 * tested capability, then runs the work as a cancellable shared job. A
 * result is an opaque RAM/lease-owned suggestion; it is never an OS path or
 * a document provider. Closing a result tab revokes new reads while leases
 * already granted finish normally.
 */

const START_PREFIX = "ai_act";
const EXPORT_PREFIX = "ai_export";

/** Start one action; the completion carries the typed suggestion. */
export async function startAiAction(request: AiActionRequest): Promise<JobHandle<AiActionResult>> {
  const checked = parseAiActionRequest(request);
  return runJob<AiActionResult>(START_PREFIX, async (requestId) => {
    await invoke("ai_action_start", { requestId, request: checked });
  }).then((handle) => ({
    ...handle,
    completion: handle.completion.then((result) => parseAiActionResult(result)),
  }));
}

/** The current suggestion; refuses an id this profile never issued. */
export async function getAiActionResult(id: string): Promise<AiActionResult> {
  if (!isUuid(id)) throw new Error("ai_actions.invalid");
  const result = (await invoke("ai_action_result", { id })) as unknown;
  return parseAiActionResult(result);
}

/** Release the suggestion and its artifact lease; idempotent. */
export async function releaseAiActionResult(id: string): Promise<void> {
  if (!isUuid(id)) throw new Error("ai_actions.invalid");
  await invoke("ai_action_result_release", { id });
}

/**
 * Save a copy through the 08a converter into a new owned file. The request
 * carries the user's destination and loss acknowledgements; an existing
 * destination is never replaced under 09f.
 */
export async function exportAiActionResult(
  id: string,
  request: ConversionRequest,
): Promise<JobHandle<ConversionReport>> {
  if (!isUuid(id)) throw new Error("ai_actions.invalid");
  if (!request || typeof request !== "object") throw new Error("ai_actions.invalid");
  if (request.keep_original !== true) throw new Error("ai_actions.invalid");
  return runJob<ConversionReport>(EXPORT_PREFIX, async (requestId) => {
    await invoke("ai_action_result_export_start", { requestId, id, request });
  });
}

/**
 * Stores the compact UI mask and returns the opaque `mask_artifact_id` that
 * `erase_object` accepts. Additive command required by T2; see the handoff.
 */
export async function createMaskArtifact(
  spec: AiMaskSpec,
  width: number,
  height: number,
  expectedContentId: string | null,
): Promise<string> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("ai_actions.invalid");
  }
  if (!spec || (spec.kind !== "rect" && spec.kind !== "strokes")) throw new Error("ai_actions.invalid");
  if (expectedContentId !== null && !isUuid(expectedContentId)) throw new Error("ai_actions.invalid");
  const answer = (await invoke("ai_mask_artifact_create", {
    width,
    height,
    spec,
    expectedContentId,
  })) as { mask_artifact_id?: unknown };
  if (!answer || !isUuid(answer.mask_artifact_id)) throw new Error("ai_actions.invalid");
  return answer.mask_artifact_id;
}

/** The result tab id for a suggestion: opaque, never a fake file path. */
export function aiResultTabId(resultId: string): string {
  if (!isUuid(resultId)) throw new Error("ai_actions.invalid");
  return `ai-result:${resultId}`;
}

/** True only for an id this module produced; never a path-like string. */
export function isAiResultTabId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("ai-result:") && isUuid(value.slice(10));
}
