/**
 * The only service that calls the AI commands (Step 14c, E1/E2).
 * A component never imports `invoke` directly.
 */

import { invoke } from "@tauri-apps/api/core";
import { newRequestId, runJob, type JobHandle } from "./jobs";
import type {
  AiCapabilityStatus,
  AiHardwareInfo,
  AiTaskRequest,
  AiTaskResult,
  AiTextPage,
} from "./localAiTypes";

/** E1: capability list; this call never loads a model. */
export async function aiCapabilities(): Promise<AiCapabilityStatus[]> {
  return (await invoke("ai_capabilities")) as AiCapabilityStatus[];
}

/** E1: actual hardware; missing GPU facts stay null. */
export async function aiHardware(): Promise<AiHardwareInfo> {
  return (await invoke("ai_hardware")) as AiHardwareInfo;
}

/**
 * E2: start one task. The wrapper-generated id is used in both the shared
 * job table and the typed request, so completion authority stays identical.
 */
export async function startAiTask(request: AiTaskRequest): Promise<JobHandle<AiTaskResult>> {
  return runJob<AiTaskResult>("ai", async (requestId) => {
    const typed: AiTaskRequest = { ...request, request_id: requestId };
    await invoke("ai_task_start", { requestId, request: typed });
  });
}

/** E2: page a text task's provisional/complete chunks. */
export async function pollAiText(jobId: string, afterSequence: number): Promise<AiTextPage> {
  return (await invoke("ai_text_page", {
    jobId,
    afterSequence,
  })) as AiTextPage;
}

/**
 * D10: disabling local AI cancels active jobs and unloads the model. The
 * settings page calls this before saving `enabled: false`.
 */
export async function shutdownAi(): Promise<void> {
  await invoke("ai_shutdown");
}

/** A fresh id for a task that is not driven by the shared job wrapper. */
export function newAiRequestId(): string {
  return newRequestId("ai");
}
