import { invoke } from "@tauri-apps/api/core";
import type { AiCitation, AiInputRef, AiSourceLocation } from "../services/localAiTypes";

/**
 * Authorized, bounded source text (`ai-actions-1` E6).
 *
 * Only an already-authorized immutable input is read; the native extractor is
 * authoritative for the 64 KiB/file and 128 KiB/turn budgets. Source text is
 * data: a sentence inside a file never grants permission or adds a tool.
 */

export const MAX_SOURCE_FILE_BYTES = 64 * 1024;
export const MAX_SOURCE_TURN_BYTES = 128 * 1024;
export const MAX_SOURCE_CHUNKS = 32;

export interface AiActionSourceBlock {
  location: AiSourceLocation;
  text: string;
}

export interface AiActionSource {
  input_id: string;
  revision: number;
  title: string;
  blocks: AiActionSourceBlock[];
  partial: boolean;
  sensitive: boolean;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Client-side mirror of the native budget; the native answer wins. */
export function validateSources(sources: readonly AiActionSource[]): AiActionSource[] {
  if (!Array.isArray(sources)) throw new Error("ai_actions.invalid");
  let total = 0;
  for (const source of sources) {
    if (!source || typeof source.input_id !== "string" || source.input_id.length === 0) {
      throw new Error("ai_actions.invalid");
    }
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new Error("ai_actions.invalid");
    if (typeof source.title !== "string" || Array.from(source.title).length > 32_768) {
      throw new Error("ai_actions.invalid");
    }
    if (!Array.isArray(source.blocks) || source.blocks.length > MAX_SOURCE_CHUNKS) {
      throw new Error("ai_actions.too_large");
    }
    let fileBytes = 0;
    for (const block of source.blocks) {
      if (!block || typeof block.text !== "string" || !block.location) throw new Error("ai_actions.invalid");
      fileBytes += byteLength(block.text);
    }
    if (fileBytes > MAX_SOURCE_FILE_BYTES) throw new Error("ai_actions.too_large");
    total += fileBytes;
  }
  if (total > MAX_SOURCE_TURN_BYTES) throw new Error("ai_actions.too_large");
  return [...sources];
}

/** Prepares the exact approved sources; a denied scope reads nothing. */
export async function prepareAiActionSources(
  inputs: readonly AiInputRef[],
  scopeId: string | null,
): Promise<AiActionSource[]> {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) {
    throw new Error("ai_actions.invalid");
  }
  const answer = (await invoke("ai_action_sources", {
    inputs,
    scopeId,
  })) as unknown as AiActionSource[];
  const checked = validateSources(answer);
  if (checked.every((source) => source.blocks.length === 0)) throw new Error("ai_actions.no_sources");
  return checked;
}

/** A citation is only shown when it points at a captured block we still hold. */
export function citationIsGrounded(citation: AiCitation, sources: readonly AiActionSource[]): boolean {
  return sources.some(
    (source) =>
      source.input_id === citation.input_id &&
      source.revision === citation.revision &&
      source.blocks.some(
        (block) => JSON.stringify(block.location) === JSON.stringify(citation.location) && block.text.includes(citation.quote.trim()),
      ),
  );
}

/** Shows a warning when a source tries to give instructions; authority stays 0. */
export function sourceLooksLikeInstructions(text: string): boolean {
  const lowered = text.toLowerCase();
  return ["ignore previous", "system prompt", "developer message", "upload every file"].some((marker) =>
    lowered.includes(marker),
  );
}
