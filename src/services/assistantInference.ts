import { invoke } from "@tauri-apps/api/core";
import type { AssistantOutboundPreview } from "../assistant/types";
import type { AiTaskRequest, AiTaskResult } from "./localAiTypes";
import { runJob, type JobHandle } from "./jobs";

/**
 * Selected-backend inference (Step 17a T4, E7).
 *
 * `prepare` only describes the exact bytes; it never touches the network.
 * `confirm` is the native human review and returns a one-use consent ID.
 * `start` sends only after the native gateway revalidates that consent.
 */

export async function prepareAssistantInference(
  request: AiTaskRequest,
): Promise<AssistantOutboundPreview> {
  return (await invoke("assistant_inference_prepare", { request })) as AssistantOutboundPreview;
}

export async function confirmAssistantOutbound(previewId: string): Promise<{ consent_id: string }> {
  return (await invoke("assistant_outbound_confirm", { previewId })) as { consent_id: string };
}

export async function startAssistantInference(
  request: AiTaskRequest,
  outboundConsentId: string | null,
): Promise<JobHandle<AiTaskResult>> {
  return runJob<AiTaskResult>("aiinfer", async (requestId) => {
    await invoke("assistant_inference_start", {
      requestId,
      request: { ...request, request_id: requestId },
      outboundConsentId,
    });
  });
}
