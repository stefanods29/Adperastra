import { invoke } from "@tauri-apps/api/core";
import type {
  AssistantBackend,
  AssistantConversation,
  AssistantMessage,
  AssistantTurnRequest,
  AssistantTurnResult,
} from "../assistant/types";
import { runJob, type JobHandle } from "./jobs";

/**
 * Assistant chat transport (Step 17a T3, E4).
 *
 * Every turn is one shared job; the wrapper owns the request ID and the UI
 * polls the shared job table. `sendAssistantTurn` is called only from the
 * main composer's explicit Send gesture.
 */

export async function createAssistantChat(backend: AssistantBackend): Promise<AssistantConversation> {
  return (await invoke("assistant_chat_create", { backend })) as AssistantConversation;
}

export async function sendAssistantTurn(request: AssistantTurnRequest): Promise<JobHandle<AssistantTurnResult>> {
  return runJob<AssistantTurnResult>("assistant", async (requestId) => {
    await invoke("assistant_turn_start", {
      requestId,
      request: { ...request, request_id: requestId },
    });
  });
}

export async function assistantMessages(
  chatId: string,
  afterMessageId: string | null,
): Promise<AssistantMessage[]> {
  return (await invoke("assistant_messages", { chatId, afterMessageId })) as AssistantMessage[];
}

export async function stopAssistantTurn(jobId: string): Promise<void> {
  await invoke("assistant_turn_stop", { jobId });
}
