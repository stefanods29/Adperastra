import type { AssistantOutboundPreview } from "../../../assistant/types";
import type { AiTaskRequest, AiTaskResult } from "../../../services/localAiTypes";
import { newRequestId, type JobHandle } from "../../../services/jobs";
import { builtinDeckStyle } from "../styles/builtins";
import type { DeckStyleSuffix } from "../styles/stylePalettes";
import {
  DECK_AI_SCHEMA_ID,
  type DeckAiOutline,
  type DeckAiRequest,
  type DeckAiSuggestion,
  type DeckAiWarning,
} from "./deckAiTypes";
import { validateDeckAiOutline } from "./deckAiValidation";
import { buildDeckPromptArguments, deckPromptTemplate } from "./deckAiPromptSelection";
import { sourceInputIds, sourceTextForPrompt } from "../../../services/deckAiSources";

/** Generation keeps the prepared request and its exact source IDs. The model
 * result is validated before any preview or draft exists; no content is
 * logged and no second backend is tried. */

export interface DeckAiBackend {
  prepare(request: AiTaskRequest): Promise<AssistantOutboundPreview>;
  start(request: AiTaskRequest, consentId: string | null): Promise<JobHandle<AiTaskResult>>;
}

interface DeckAiRecord {
  suggestion: DeckAiSuggestion;
  task: AiTaskRequest;
  outbound: AssistantOutboundPreview;
  input_ids: string[];
  release: () => Promise<void>;
  created_unix: number;
}

const records = new Map<string, DeckAiRecord>();

export function putDeckAiRecord(record: DeckAiRecord): void {
  records.set(record.suggestion.id, record);
}

export function getDeckAiRecord(id: string): DeckAiRecord | undefined {
  return records.get(id);
}

export function deleteDeckAiRecord(id: string): void {
  records.delete(id);
}

export function clearDeckAiRecordsForTest(): void {
  records.clear();
}

export function deckAiRecordCount(): number {
  return records.size;
}

function suffixOf(styleId: string): DeckStyleSuffix {
  const style = builtinDeckStyle(styleId);
  const suffix = style?.name_key?.split(".").at(-1);
  if (!suffix) throw new Error("deck_ai.invalid");
  return suffix as DeckStyleSuffix;
}

export function buildDeckTaskRequest(request: DeckAiRequest, sourceText: string): AiTaskRequest {
  // A style suggestion has no selected style yet; use the first built-in as
  // the neutral template that asks for one of the eight.
  const styleId = request.style_id ?? "220b0001-0000-4000-8000-000000000000";
  const style = builtinDeckStyle(styleId);
  if (!style) throw new Error("deck_ai.invalid");
  const template = deckPromptTemplate(request.action, style.id, request.locale);
  const args = buildDeckPromptArguments(style, request.locale, sourceText, []);
  const inputs = request.source.kind === "document" ? [request.source.input] : [];
  return {
    request_id: newRequestId("deckai"),
    task: "structured_text",
    locale: request.locale,
    inputs,
    prompt: {
      template_id: template.id,
      template_revision: template.revision,
      arguments: args,
      output_schema_id: DECK_AI_SCHEMA_ID,
    },
    options: { kind: "structured_text", max_output_tokens: 1024, temperature: 0, seed: 0 },
  };
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

export function densityWarnings(outline: DeckAiOutline, request: DeckAiRequest): DeckAiWarning[] {
  const style = request.style_id ? builtinDeckStyle(request.style_id) : undefined;
  if (!style) return [];
  const warnings: DeckAiWarning[] = [];
  for (const slide of outline.slides) {
    const over =
      slide.bullets.length > style.guidance.max_bullets ||
      slide.bullets.some((bullet) => words(bullet) > style.guidance.max_words_per_bullet) ||
      slide.right_bullets.length > style.guidance.max_bullets;
    if (over) {
      warnings.push({
        id: crypto.randomUUID(),
        kind: "density",
        outline_id: slide.outline_id,
        source_id: null,
        text_key: "deckAi.density",
        argument: `${style.guidance.max_bullets}/${style.guidance.max_words_per_bullet}`,
        accepted: false,
      });
    }
  }
  return warnings;
}

export function validateGeneratedOutline(
  result: AiTaskResult,
  request: DeckAiRequest,
  allowedInputIds: readonly string[],
): { outline: DeckAiOutline; warnings: DeckAiWarning[] } {
  if (result.task !== "structured_text" || result.result.kind !== "structured") {
    throw new Error("deck_ai.failed");
  }
  if (result.result.schema_id !== DECK_AI_SCHEMA_ID) throw new Error("deck_ai.invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.result.canonical_json);
  } catch {
    throw new Error("deck_ai.invalid");
  }
  const outline = validateDeckAiOutline(parsed);
  if (outline.action !== request.action) throw new Error("deck_ai.invalid");
  const allowlist = new Set(allowedInputIds);
  for (const slide of outline.slides) {
    for (const citation of slide.citations) {
      if (!allowlist.has(citation.input_id)) throw new Error("deck_ai.invalid");
    }
  }
  return { outline, warnings: densityWarnings(outline, request) };
}

export function suggestionFromResult(
  id: string,
  request: DeckAiRequest,
  outline: DeckAiOutline,
  warnings: DeckAiWarning[],
  result: AiTaskResult,
  expiresUnix: number,
): DeckAiSuggestion {
  return {
    id,
    request,
    source_context_id: null,
    target_context: null,
    outline,
    warnings,
    preview: null,
    draft_id: null,
    model_id: result.model_id,
    model_revision: result.model_revision,
    prompt_revision: 1,
    status: "ready",
    expires_unix: expiresUnix,
  };
}

export function taskSourceText(request: DeckAiRequest): string {
  const text = sourceTextForPrompt(request.source);
  return text;
}

export function taskInputIds(request: DeckAiRequest): string[] {
  return sourceInputIds(request.source);
}

export function taskUsesInputs(request: DeckAiRequest): boolean {
  return request.source.kind === "document" || request.source.kind === "selected_slides";
}
