/**
 * Assistant change/recycle adapters (Step 17a T5).
 *
 * An adapter never writes. Its `preview` delegates to the native draft
 * service, which freezes the exact rows, warnings and hash; `executeRead` is
 * refused because a change tool is not a read tool.
 */

import { ASSISTANT_TOOL_SPECS } from "./toolRegistry";
import { parseAssistantToolArguments } from "./toolSchemas";
import type {
  AssistantCommandAdapter,
  AssistantDraft,
  AssistantOperation,
  AssistantToolId,
  AssistantToolResult,
} from "./types";
import { ASSISTANT_CHANGE_TOOL_IDS, ASSISTANT_RECYCLE_TOOL_ID } from "./types";

/** Implemented by the coordinator over the native assistant_action_preview. */
export interface AssistantPreviewPort {
  preview(operation: AssistantOperation, scopeId: string): Promise<AssistantDraft>;
}

function spec(toolId: AssistantToolId) {
  return ASSISTANT_TOOL_SPECS.find((row) => row.tool_id === toolId)!;
}

export function createAssistantActionAdapters(port: AssistantPreviewPort): AssistantCommandAdapter[] {
  const ids: AssistantToolId[] = [...ASSISTANT_CHANGE_TOOL_IDS, ASSISTANT_RECYCLE_TOOL_ID];
  return ids.map((toolId) => ({
    spec: { ...spec(toolId) },
    validate: (raw) => parseAssistantToolArguments(toolId, raw),
    preview: async (args, scopeId): Promise<AssistantDraft> =>
      port.preview(args as AssistantOperation, scopeId),
    executeRead: async (): Promise<AssistantToolResult> => {
      throw new Error("assistant.confirmation_required");
    },
  }));
}

/** A change adapter is never automatic, even if a caller tries. */
export function automaticAllowedFor(toolId: AssistantToolId): boolean {
  return spec(toolId).automatic_allowed;
}
