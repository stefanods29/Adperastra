import type { AssistantOutboundPreview } from "../assistant/types";
import { prepareAssistantInference, startAssistantInference } from "./assistantInference";
import type { JobHandle } from "./jobs";
import {
  buildDeckTaskRequest,
  clearDeckAiRecordsForTest,
  deleteDeckAiRecord,
  getDeckAiRecord,
  putDeckAiRecord,
  suggestionFromResult,
  taskSourceText,
  validateGeneratedOutline,
  type DeckAiBackend,
} from "../office/deck/ai/deckAiGeneration";
import {
  DECK_AI_PREVIEW_TTL_SECONDS,
  type DeckAiOutline,
  type DeckAiPreparedRequest,
  type DeckAiRequest,
  type DeckAiSuggestion,
} from "../office/deck/ai/deckAiTypes";
import { validateDeckAiOutline, validateDeckAiRequest } from "../office/deck/ai/deckAiValidation";
import type { OfficeController } from "../office/OfficeController";
import type { OfficeTransactionResult } from "../office/types";
import { buildDeckSuggestionPreview } from "../office/deck/ai/deckAiDraft";
import { acceptDeckSuggestionTransaction } from "../office/deck/ai/deckAiAcceptance";
import { releaseDeckSuggestionResources } from "../office/deck/ai/deckAiLifetime";
import { sourceInputIds } from "./deckAiSources";

/** E8: prepare, generate, edit, accept and release a deck suggestion.
 *
 * API mode needs an exact payload preview and a separate one-shot consent.
 * A local failure never falls back to an API provider and no content or key
 * is logged. */

export const assistantDeckAiBackend: DeckAiBackend = {
  prepare: prepareAssistantInference,
  start: startAssistantInference,
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function emptyOutline(): DeckAiOutline {
  return {
    schema_id: "deck.outline.v1",
    action: "create",
    suggested_style_id: null,
    rationale: "",
    slides: [],
    layout_choices: [],
  };
}

export async function prepareDeckSuggestion(
  controller: OfficeController | null,
  request: DeckAiRequest,
): Promise<DeckAiPreparedRequest> {
  const validated = validateDeckAiRequest(request);
  if (validated.action !== "create" && controller === null) throw new Error("deck_ai.invalid");
  const task = buildDeckTaskRequest(validated, taskSourceText(validated));
  const outbound: AssistantOutboundPreview = await assistantDeckAiBackend.prepare(task);
  const id = crypto.randomUUID();
  const expires = Math.min(nowUnix() + DECK_AI_PREVIEW_TTL_SECONDS, Number(outbound.expires_unix));
  const suggestion: DeckAiSuggestion = {
    id,
    request: validated,
    source_context_id: null,
    target_context: null,
    outline: emptyOutline(),
    warnings: [],
    preview: null,
    draft_id: null,
    model_id: outbound.model_id,
    model_revision: "",
    prompt_revision: 1,
    status: "awaiting_send",
    expires_unix: expires,
  };
  putDeckAiRecord({
    suggestion,
    task,
    outbound,
    input_ids: sourceInputIds(validated.source),
    release: async () => undefined,
    created_unix: nowUnix(),
  });
  return {
    id,
    request: validated,
    outbound_preview: outbound,
    expires_unix: expires,
  };
}

export async function generateDeckSuggestion(
  preparedId: string,
  outboundConsentId: string | null,
): Promise<JobHandle<DeckAiSuggestion>> {
  const record = getDeckAiRecord(preparedId);
  if (!record) throw new Error("deck_ai.changed");
  if (record.suggestion.expires_unix <= nowUnix()) {
    record.suggestion.status = "cancelled";
    throw new Error("deck_ai.changed");
  }
  if (record.outbound.requires_consent && !outboundConsentId) {
    // No implicit consent: enabling AI, choosing a style or a prior request
    // never authorizes this payload.
    throw new Error("deck_ai.invalid");
  }
  const handle = await assistantDeckAiBackend.start(record.task, outboundConsentId);
  const completion: Promise<DeckAiSuggestion> = (async () => {
    try {
      const result = await handle.completion;
      const { outline, warnings } = validateGeneratedOutline(
        result,
        record.suggestion.request,
        record.input_ids,
      );
      record.suggestion = suggestionFromResult(
        record.suggestion.id,
        record.suggestion.request,
        outline,
        warnings,
        result,
        record.suggestion.expires_unix,
      );
      return record.suggestion;
    } catch (error) {
      record.suggestion.status = "error";
      throw error;
    }
  })();
  return { id: handle.id, cancel: handle.cancel, completion };
}

export async function previewEditedDeckSuggestion(
  controller: OfficeController | null,
  suggestionId: string,
  outline: DeckAiOutline,
): Promise<JobHandle<DeckAiSuggestion>> {
  const record = getDeckAiRecord(suggestionId);
  if (!record) throw new Error("deck_ai.changed");
  const validated = validateDeckAiOutline(outline);
  const completion = buildDeckSuggestionPreview(record.suggestion, controller, validated);
  return {
    id: suggestionId,
    cancel: async () => undefined,
    completion: completion.then((suggestion) => {
      record.suggestion = suggestion;
      return suggestion;
    }),
  };
}

export async function acceptDeckSuggestion(
  controller: OfficeController | null,
  suggestionId: string,
): Promise<{ document_id: string; result: OfficeTransactionResult }> {
  const record = getDeckAiRecord(suggestionId);
  if (!record) throw new Error("deck_ai.changed");
  return acceptDeckSuggestionTransaction(controller, record.suggestion);
}

export async function releaseDeckSuggestion(id: string): Promise<void> {
  const record = getDeckAiRecord(id);
  if (!record) return;
  await releaseDeckSuggestionResources(record.suggestion);
  deleteDeckAiRecord(id);
}

export { clearDeckAiRecordsForTest };
