import type { OfficeController } from "../../OfficeController";
import type { OfficeTransactionResult } from "../../types";
import { applyOfficeProposal, confirmOfficeProposal } from "../../../services/officeAi";
import { canAcceptPreview } from "./deckAiLayoutValidation";
import { assertProtectedFacts } from "./deckAiProtectedFacts";
import type { DeckAiSuggestion } from "./deckAiTypes";

/** A6/A7/E22: Accept is a separate human foreground action from Send. One
 * atomic transaction, one Undo. The assistant cannot mint the confirmation
 * grant or apply a style without the manual library review. */

export async function acceptDeckSuggestionTransaction(
  controller: OfficeController | null,
  suggestion: DeckAiSuggestion,
): Promise<{ document_id: string; result: OfficeTransactionResult }> {
  if (suggestion.request.action === "style") {
    // A style is a proposal only; Apply must go through the manual library.
    throw new Error("deck_ai.unsupported");
  }
  const preview = suggestion.preview;
  if (!preview || !canAcceptPreview(preview)) throw new Error("deck_ai.overflow");

  const source = suggestion.request.source;
  if (source.kind === "selected_slides") {
    if (!controller) throw new Error("deck_ai.changed");
    const state = controller.getState();
    if (
      state.revision !== source.expected_revision ||
      state.content_id !== source.expected_content_id
    ) {
      throw new Error("deck_ai.changed");
    }
  }
  if (source.kind === "outline" || source.kind === "notes") {
    assertProtectedFacts(source.text, suggestion.outline);
  }

  // E22 grant is issued only from the explicit trusted Accept gesture in the
  // main review; this service is called from that click.
  const grant = await confirmOfficeProposal(preview.preview_id);
  const result = await applyOfficeProposal({
    preview_id: preview.preview_id,
    transaction_id: crypto.randomUUID(),
    expected_revision: preview.revision,
    expected_content_id: preview.content_id,
    acknowledged_warning_ids: preview.warnings.map((warning) => warning.id),
    human_confirmation_id: grant.human_confirmation_id,
  });
  suggestion.status = "applied";
  const documentId = suggestion.draft_id ?? controller?.document.id ?? preview.session_id;
  return { document_id: documentId, result };
}
