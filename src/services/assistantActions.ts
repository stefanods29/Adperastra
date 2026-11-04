import { invoke } from "@tauri-apps/api/core";
import type { AssistantActionResult, AssistantDraft, AssistantToolRequest } from "../assistant/types";
import { runJob, type JobHandle } from "./jobs";

/**
 * Draft preview and native Apply transport (Step 17a T5, E6).
 *
 * Preview only reads producer data. Apply is a native approval dialog bound to
 * the immutable draft; a model message can never call it. Recycle has two
 * separate native stages and remains unavailable until its capability is
 * proven.
 */

export async function previewAssistantAction(
  chatId: string,
  request: AssistantToolRequest,
): Promise<AssistantDraft> {
  return (await invoke("assistant_action_preview", { chatId, request })) as AssistantDraft;
}

export async function applyAssistantDraft(draftId: string): Promise<JobHandle<AssistantActionResult>> {
  return runJob<AssistantActionResult>("assistantact", async (requestId) => {
    await invoke("assistant_action_apply", { requestId, draftId });
  });
}

export async function cancelAssistantDraft(draftId: string): Promise<void> {
  await invoke("assistant_action_cancel", { draftId });
}

export async function confirmAssistantRecycle(
  draftId: string,
  stage: 1 | 2,
): Promise<{ stage: 1 | 2; ready: boolean }> {
  return (await invoke("assistant_recycle_confirm", { draftId, stage })) as {
    stage: 1 | 2;
    ready: boolean;
  };
}
