import type { ConversionInput } from "../convert/types";
import { acquireAiInput, releaseAiInput } from "./localAiArtifacts";
import type { AiInputRef } from "./localAiTypes";
import type { OfficeController } from "../office/OfficeController";
import type { OfficeSelection } from "../office/types";
import {
  MAX_DECK_AI_SOURCE_SCALARS,
  type DeckAiSource,
} from "../office/deck/ai/deckAiTypes";

/** Capture the current source at the moment the user asks. An unsaved
 * document is captured through an immutable snapshot, never the original
 * revision-1 input. Every acquired input lease is released after the
 * suggestion ends. */

export interface CapturedDeckSource {
  source: DeckAiSource;
  input_ids: string[];
  release: () => Promise<void>;
}

export async function captureDocumentSource(
  input: ConversionInput,
  selection: OfficeSelection | null,
): Promise<CapturedDeckSource> {
  const reference: AiInputRef = await acquireAiInput(input);
  return {
    source: { kind: "document", input: reference, selection },
    input_ids: [reference.id],
    release: () => releaseAiInput(reference.id),
  };
}

export function captureTextSource(kind: "outline" | "notes", text: string): CapturedDeckSource {
  if ([...text].length < 1 || [...text].length > MAX_DECK_AI_SOURCE_SCALARS) {
    throw new Error("deck_ai.too_large");
  }
  return {
    source: { kind, text },
    input_ids: [],
    release: async () => undefined,
  };
}

export function captureSelectedSlides(
  controller: OfficeController,
  slideIds: readonly string[],
): CapturedDeckSource {
  if (slideIds.length < 1 || slideIds.length > 30 || new Set(slideIds).size !== slideIds.length) {
    throw new Error("deck_ai.invalid");
  }
  const state = controller.getState();
  if (state.family !== "deck" || state.busy) throw new Error("deck_ai.changed");
  return {
    source: {
      kind: "selected_slides",
      session_id: controller.session_id,
      slide_ids: [...slideIds],
      expected_revision: state.revision,
      expected_content_id: state.content_id,
    },
    input_ids: [],
    release: async () => undefined,
  };
}

export function sourceInputIds(source: DeckAiSource): string[] {
  return source.kind === "document" ? [source.input.id] : [];
}

export function sourceTextForPrompt(source: DeckAiSource): string {
  if (source.kind === "outline" || source.kind === "notes") return source.text;
  return "";
}

export async function releaseSourceInputs(inputIds: readonly string[]): Promise<void> {
  await Promise.all([...new Set(inputIds)].map((id) => releaseAiInput(id)));
}
