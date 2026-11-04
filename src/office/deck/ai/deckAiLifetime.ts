import { releaseOfficeAiContext, releaseOfficeProposal } from "../../../services/officeAi";
import { releaseSourceInputs } from "../../../services/deckAiSources";
import { takeDeckAiDraft } from "./deckAiDraft";
import type { DeckAiSuggestion } from "./deckAiTypes";

/** Release previews, contexts and input leases idempotently. An unaccepted,
 * unmodified empty draft can close; a user-edited or accepted draft follows
 * the normal unsaved-close policy and is never deleted by job cleanup. */

export async function releaseDeckSuggestionResources(suggestion: DeckAiSuggestion): Promise<void> {
  if (suggestion.preview) {
    await releaseOfficeProposal(suggestion.preview.preview_id).catch(() => undefined);
  }
  if (suggestion.source_context_id) {
    await releaseOfficeAiContext(suggestion.source_context_id).catch(() => undefined);
  }
  if (suggestion.target_context) {
    await releaseOfficeAiContext(suggestion.target_context.context_id).catch(() => undefined);
  }
  await releaseSourceInputs(
    suggestion.request.source.kind === "document" ? [suggestion.request.source.input.id] : [],
  ).catch(() => undefined);

  const draft = takeDeckAiDraft(suggestion.id);
  if (!draft) return;
  const state = draft.controller.getState();
  if (!state.dirty && suggestion.status !== "applied") {
    await draft.controller.close().catch(() => undefined);
    draft.document.release();
  }
  // Dirty/applied drafts stay open for the normal save/close decision.
}
