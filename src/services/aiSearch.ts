import { invoke } from "@tauri-apps/api/core";
import { prepareAssistantInference } from "./assistantInference";
import { isTauriRuntime } from "./settings";
import { newRequestId, runJob, type JobHandle } from "./jobs";
import type { AiInputRef, AiPromptArgument, AiTaskRequest } from "./localAiTypes";
import { isSafeU64, validateSemanticQuery } from "./aiSearchTypes";
import type {
  AiNameSuggestion,
  AiNamingPattern,
  AiSearchInferenceRequest,
  AiSearchPreparedRequest,
  AiSortSuggestion,
  NaturalQueryPreview,
  NaturalQueryRequest,
  SemanticPage,
  SemanticQuery,
  SemanticStatus,
  SortHistory,
} from "./aiSearchTypes";
import { SEARCH_DESTINATION_SCHEMA_ID, SEARCH_NAMES_SCHEMA_ID, SEARCH_QUERY_SCHEMA_ID } from "../search/ai/aiSearchSchemas";

/** The only service that calls the AI-search commands (Step 17c E2). */

const JOB_PREFIX = "aisearch";

function promptArgument(name: string, value: unknown): AiPromptArgument {
  return { name, value: JSON.stringify(value), trust: "user" };
}

/**
 * Build the exact bounded task the 17a gateway will prepare. The preview is a
 * native payload review; it performs no network request by itself.
 */
export function searchInferenceTask(request: AiSearchInferenceRequest): AiTaskRequest {
  const requestId = newRequestId(JOB_PREFIX);
  if (request.kind === "query") {
    return {
      request_id: requestId,
      task: "structured_text",
      locale: request.request.locale,
      inputs: [],
      prompt: {
        template_id: SEARCH_QUERY_SCHEMA_ID,
        template_revision: 1,
        arguments: [
          promptArgument("request", request.request.text),
          promptArgument("root_ids", request.request.root_ids),
          promptArgument("now_unix", request.request.now_unix),
          promptArgument("timezone", request.request.timezone),
        ],
        output_schema_id: SEARCH_QUERY_SCHEMA_ID,
      },
      options: { kind: "structured_text", max_output_tokens: 1024, temperature: 0, seed: 0 },
    };
  }
  if (request.kind === "names") {
    return {
      request_id: requestId,
      task: "structured_text",
      locale: request.pattern.locale,
      inputs: [...request.inputs],
      prompt: {
        template_id: SEARCH_NAMES_SCHEMA_ID,
        template_revision: 1,
        arguments: [
          promptArgument("inputs", request.inputs.map((input) => input.id)),
          promptArgument("pattern", request.pattern),
        ],
        output_schema_id: SEARCH_NAMES_SCHEMA_ID,
      },
      options: { kind: "structured_text", max_output_tokens: 1024, temperature: 0, seed: 0 },
    };
  }
  return {
    request_id: requestId,
    task: "structured_text",
    locale: "en",
    inputs: [request.input],
    prompt: {
      template_id: SEARCH_DESTINATION_SCHEMA_ID,
      template_revision: 1,
      arguments: [promptArgument("input", request.input.id)],
      output_schema_id: SEARCH_DESTINATION_SCHEMA_ID,
    },
    options: { kind: "structured_text", max_output_tokens: 512, temperature: 0, seed: 0 },
  };
}

/** 17a E7 preparation. Local mode also prepares but sends nothing. */
export async function prepareAiSearchInference(
  request: AiSearchInferenceRequest,
): Promise<AiSearchPreparedRequest> {
  const outboundPreview = await prepareAssistantInference(searchInferenceTask(request));
  return {
    id: outboundPreview.preview_id,
    request,
    outbound_preview: outboundPreview,
    expires_unix: outboundPreview.expires_unix,
  };
}

/** Bounded semantic search. Cancel through the returned JobHandle. */
export async function searchSemantic(query: SemanticQuery): Promise<JobHandle<SemanticPage>> {
  if (!validateSemanticQuery(query)) throw new Error("ai_search.invalid");
  return runJob<SemanticPage>(JOB_PREFIX, async (requestId) => {
    await invoke("ai_semantic_search_start", { requestId, query });
  });
}

export async function semanticStatus(): Promise<SemanticStatus> {
  if (!isTauriRuntime()) {
    // Browser preview has no native index or embedder. Report that explicitly
    // instead of pretending the semantic index is healthy and empty.
    return {
      generation: 0,
      text_chunks: 0,
      images: 0,
      bytes: 0,
      pending: 0,
      skipped: 0,
      paused: true,
      reason_code: "ai_search.unavailable",
    };
  }
  return (await invoke("ai_semantic_status")) as SemanticStatus;
}

export async function rebuildSemantic(rootIds: readonly string[]): Promise<JobHandle<SemanticStatus>> {
  return runJob<SemanticStatus>(JOB_PREFIX, async (requestId) => {
    await invoke("ai_semantic_rebuild_start", { requestId, rootIds: [...rootIds] });
  });
}

export async function previewNaturalQuery(
  request: NaturalQueryRequest,
  preparedId: string,
  outboundConsentId: string | null,
): Promise<JobHandle<NaturalQueryPreview>> {
  if (
    request.text.trim().length === 0 ||
    Array.from(request.text).length > 1024 ||
    request.root_ids.length === 0 ||
    request.root_ids.length > 32 ||
    !isSafeU64(request.now_unix) ||
    request.request_revision === 0
  ) {
    throw new Error("ai_search.invalid");
  }
  return runJob<NaturalQueryPreview>(JOB_PREFIX, async (requestId) => {
    await invoke("ai_query_preview_start", { requestId, request, preparedId, outboundConsentId });
  });
}

export async function suggestNames(
  inputs: readonly AiInputRef[],
  pattern: AiNamingPattern,
  preparedId: string,
  outboundConsentId: string | null,
): Promise<JobHandle<AiNameSuggestion[]>> {
  return runJob<AiNameSuggestion[]>(JOB_PREFIX, async (requestId) => {
    await invoke("ai_names_suggest_start", {
      requestId,
      inputs: [...inputs],
      pattern,
      preparedId,
      outboundConsentId,
    });
  });
}

export async function suggestDestination(
  input: AiInputRef,
  preparedId: string,
  outboundConsentId: string | null,
): Promise<JobHandle<AiSortSuggestion | null>> {
  return runJob<AiSortSuggestion | null>(JOB_PREFIX, async (requestId) => {
    await invoke("ai_sort_suggest_start", { requestId, input, preparedId, outboundConsentId });
  });
}

export async function resetSortHistory(expectedRevision: number): Promise<SortHistory> {
  if (!isSafeU64(expectedRevision) || expectedRevision === 0) {
    throw new Error("ai_search.invalid");
  }
  return (await invoke("ai_sort_history_reset", { expectedRevision })) as SortHistory;
}

/** Embeddings never use the API provider, even when assistant text does. */
export function embeddingsStayLocal(): true {
  return true;
}

/** Sensitive unlocked input is refused for an API backend, never downgraded. */
export function sensitiveApiRefused(backend: "local" | "api"): boolean {
  return backend === "api";
}

/**
 * A failed request never switches to another backend by itself. `null` means
 * the task stopped and the user chooses Local AI or an explicit Retry.
 */
export function backendAfterFailure(selected: "local" | "api", failed: boolean): "local" | "api" | null {
  return failed ? null : selected;
}
