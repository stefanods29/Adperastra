import type { AiCitation } from "../../../services/localAiTypes";

/** ai-document-1. Shared Office DTOs are deliberately not redeclared here. */
export const DOCUMENT_AI_ACTIONS = [
  "rewrite", "shorten", "expand", "simplify", "grammar", "tone", "translate",
  "alt_text", "draft", "continue",
] as const;
export type DocumentAiAction = typeof DOCUMENT_AI_ACTIONS[number];
export const DOCUMENT_AI_TONES = ["formal", "friendly", "persuasive", "neutral"] as const;
export type DocumentAiTone = typeof DOCUMENT_AI_TONES[number];
export const DOCUMENT_AI_LIMITS = {
  source_scalars: 4000, context_scalars_each_side: 1000, output_scalars: 8000,
  paragraphs: 32, runs_per_paragraph: 128, alt_scalars: 4096, topic_scalars: 1000,
  citations: 16, cautions: 16, protected_changes: 64, token_scalars: 512,
  lifetime_seconds: 300,
} as const;
export const DOCUMENT_AI_SCHEMA = "document.action.v1" as const;
export const DOCUMENT_AI_PROMPT_REVISION = 1;

export interface DocumentAiOptions {
  action: DocumentAiAction;
  tone: DocumentAiTone | null;
  target_language: string | null;
  topic: string | null;
  locale: "en" | "es";
}
export interface DocumentAiParagraph {
  source_run_ids: string[];
  text: string;
}
export type DocumentAiCaution = "protected_token_changed" | "meaning_uncertain" | "unverified_draft";
export interface DocumentAiOutput {
  schema_id: typeof DOCUMENT_AI_SCHEMA;
  action: DocumentAiAction;
  paragraphs: DocumentAiParagraph[];
  alt: string | null;
  citations: AiCitation[];
  cautions: DocumentAiCaution[];
}
export interface ProtectedTokenChange {
  id: string;
  before: string;
  after: string | null;
  source_run_id: string;
  category: "number" | "date" | "name" | "url" | "identifier" | "quotation";
  user_acknowledged: boolean;
}
export interface DocumentAiSettings {
  enabled: boolean;
  experimental_actions: DocumentAiAction[];
}

// Request/Suggestion/PreparedRequest await the exact producer/request wire
// clarifications recorded in the step-20c contract-gap notes. No substitute DTO.
