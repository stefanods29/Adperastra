import type { AiInputRef } from "../services/localAiTypes";
import type { AiActionId, AiActionOptions, AiActionRequest } from "../services/aiActionTypes";
import { AI_ACTION_MAX_QUESTION, isValidTargetLanguage } from "../services/aiActionTypes";

/**
 * Requests for the five grounded document actions (D10).
 *
 * Every builder refuses a missing target language or question instead of
 * sending an ambiguous request, and the translation limit is stated as a
 * partial-coverage fact, never as a complete translation of a longer file.
 */

export type DocumentActionId = "summarize" | "create_faq" | "translate" | "key_points" | "ask_file";

export const DOCUMENT_ACTION_IDS: readonly DocumentActionId[] = [
  "summarize",
  "create_faq",
  "translate",
  "key_points",
  "ask_file",
];

export const MAX_TRANSLATION_PARAGRAPHS = 32;
export const MAX_SUMMARY_POINTS = 12;

export interface DocumentActionOptions {
  targetLanguage?: string;
  question?: string;
}

export function buildDocumentOptions(
  action: DocumentActionId,
  options: DocumentActionOptions = {},
): AiActionOptions {
  switch (action) {
    case "summarize":
      return { kind: "summarize" };
    case "create_faq":
      return { kind: "create_faq" };
    case "key_points":
      return { kind: "key_points" };
    case "translate": {
      const target = options.targetLanguage?.trim() ?? "";
      if (!isValidTargetLanguage(target)) throw new Error("ai_actions.invalid");
      return { kind: "translate", target_language: target };
    }
    case "ask_file": {
      const question = options.question?.trim() ?? "";
      if (question.length === 0 || Array.from(question).length > AI_ACTION_MAX_QUESTION) {
        throw new Error("ai_actions.invalid");
      }
      return { kind: "ask_file", question };
    }
    default:
      throw new Error("ai_actions.invalid");
  }
}

export function buildDocumentRequest(
  action: DocumentActionId,
  inputs: readonly AiInputRef[],
  options: DocumentActionOptions = {},
  revision = 1,
): AiActionRequest {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) {
    throw new Error("ai_actions.invalid");
  }
  return {
    action: action as AiActionId,
    inputs: [...inputs],
    options: buildDocumentOptions(action, options),
    request_revision: revision,
    expected_content_id: null,
    scope_id: null,
    outbound_consent_id: null,
  };
}

/**
 * A translation that covers only the first 32 paragraphs says so; it never
 * presents itself as the whole document.
 */
export function translationCoverage(paragraphs: number): { pairs: number; partial: boolean } {
  if (!Number.isInteger(paragraphs) || paragraphs < 0) throw new Error("ai_actions.invalid");
  if (paragraphs > MAX_TRANSLATION_PARAGRAPHS) {
    return { pairs: MAX_TRANSLATION_PARAGRAPHS, partial: true };
  }
  return { pairs: paragraphs, partial: false };
}

/** Summary points are capped at 12; more would be silently dropped. */
export function capSummaryPoints<T>(points: readonly T[]): T[] {
  return points.slice(0, MAX_SUMMARY_POINTS);
}
