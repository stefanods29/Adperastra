import type { OfficeController } from "../../OfficeController";
import type {
  OfficeAiContext,
  OfficeDraftSourceRef,
  OfficeProposalIntent,
  OfficeProposalPreview,
} from "../../types";
import { captureOfficeAiContext, evaluateOfficeProposal } from "../../../services/officeAi";
import { createOfficeDraft, type OfficeDraftHandle } from "../../../services/officeDrafts";
import { builtinDeckStyle } from "../styles/builtins";
import type { DeckAiSuggestion } from "./deckAiTypes";
import { densityWarnings } from "./deckAiGeneration";
import { outlineToDeckOperations } from "./outlinePlacement";
import { canAcceptPreview, proposalWarnings } from "./deckAiLayoutValidation";

/** A6/A7: create-from-source builds an in-memory unsaved draft and evaluates
 * typed operations on a clone; existing decks build one proposal against the
 * captured selection. No source file is saved or overwritten. */

function intentFor(action: DeckAiSuggestion["request"]["action"]): OfficeProposalIntent {
  switch (action) {
    case "add":
      return "deck_add";
    case "shorten":
      return "deck_shorten";
    case "notes":
      return "deck_notes";
    case "layout":
      return "deck_layout";
    default:
      return "deck_create";
  }
}

const drafts = new Map<string, OfficeDraftHandle>();

export function deckAiDraft(suggestionId: string): OfficeDraftHandle | undefined {
  return drafts.get(suggestionId);
}

export function takeDeckAiDraft(suggestionId: string): OfficeDraftHandle | undefined {
  const draft = drafts.get(suggestionId);
  drafts.delete(suggestionId);
  return draft;
}

function draftSources(suggestion: DeckAiSuggestion): OfficeDraftSourceRef[] {
  const source = suggestion.request.source;
  if (source.kind === "document") return [{ kind: "ai_input", input: source.input }];
  return [];
}

async function contextFor(
  controller: OfficeController,
  selection: OfficeAiContext["selection"],
): Promise<OfficeAiContext> {
  const state = controller.getState();
  const job = await captureOfficeAiContext(controller.session_id, {
    expected_revision: state.revision,
    expected_content_id: state.content_id,
    selection,
    max_scalars: 24_000,
    include_images: false,
    cursor: null,
  });
  return job.completion;
}

function mergeWarnings(suggestion: DeckAiSuggestion, preview: OfficeProposalPreview | null) {
  const warnings = preview ? proposalWarnings(preview) : [];
  const density = densityWarnings(suggestion.outline, suggestion.request);
  const seen = new Set(density.map((warning) => `${warning.kind}:${warning.argument}`));
  for (const warning of warnings) {
    const key = `${warning.kind}:${warning.argument}`;
    if (!seen.has(key)) {
      density.push(warning);
      seen.add(key);
    }
  }
  return density;
}

/** Preview edited or generated outline. For create, the draft is created once
 * and reused; for every other action the current controller is untouched. */
export async function buildDeckSuggestionPreview(
  suggestion: DeckAiSuggestion,
  controller: OfficeController | null,
  outline: DeckAiSuggestion["outline"],
): Promise<DeckAiSuggestion> {
  const request = suggestion.request;
  if (request.action === "style") {
    return {
      ...suggestion,
      outline,
      warnings: [],
      preview: null,
      status: "ready",
      expires_unix: Math.floor(Date.now() / 1000) + 300,
    };
  }
  const style = request.style_id ? builtinDeckStyle(request.style_id) : undefined;
  if (!style) throw new Error("deck_ai.invalid");

  let target = controller;
  let draft: OfficeDraftHandle | null = request.action === "create" ? (drafts.get(suggestion.id) ?? null) : null;
  if (request.action === "create" && !draft) {
    const job = await createOfficeDraft("deck", style.theme, draftSources(suggestion));
    draft = await job.completion;
    drafts.set(suggestion.id, draft);
    target = draft.controller;
  } else if (draft) {
    target = draft.controller;
  }
  if (!target) throw new Error("deck_ai.changed");

  const selection =
    request.source.kind === "selected_slides"
      ? {
          kind: "deck" as const,
          slide_ids: [...request.source.slide_ids],
          shape_ids: [],
          text_span: null,
        }
      : {
          kind: "deck" as const,
          slide_ids: draft ? [draft.initial_slide_id] : [],
          shape_ids: [],
          text_span: null,
        };
  try {
    const context = await contextFor(target, selection);
    const operations = outlineToDeckOperations(outline, style, context);
    const evaluation = await evaluateOfficeProposal(target.session_id, {
      context_id: context.context_id,
      expected_revision: context.revision,
      expected_content_id: context.content_id,
      intent: intentFor(request.action),
      operations: [...operations],
      label_key: "office.transaction",
    });
    const preview = await evaluation.completion;
    const updated: DeckAiSuggestion = {
      ...suggestion,
      outline,
      source_context_id: context.context_id,
      target_context: context,
      preview,
      draft_id: draft ? draft.document.id : suggestion.draft_id,
      warnings: mergeWarnings({ ...suggestion, outline }, preview),
      status: canAcceptPreview(preview) ? "ready" : "previewing",
      expires_unix: Math.floor(Date.now() / 1000) + 300,
    };
    // The draft stays open for Accept. It is not saved; the source and its
    // bytes are untouched until the explicit acceptance transaction.
    return updated;
  } catch (error) {
    if (draft) {
      drafts.delete(suggestion.id);
      await draft.controller.close().catch(() => undefined);
      draft.document.release();
    }
    throw error;
  }
}
