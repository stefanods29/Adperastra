import { DOCUMENT_AI_ACTIONS, type DocumentAiAction, type DocumentAiSettings } from "./documentAiTypes";

export function defaultDocumentAiSettings(): DocumentAiSettings {
  return { enabled: false, experimental_actions: [] };
}

/** Normalize only this section; the coordinator owns schema 51 -> 52. */
export function normalizeDocumentAiSettings(value: unknown): DocumentAiSettings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return defaultDocumentAiSettings();
  const raw = value as Record<string, unknown>;
  const actions = Array.isArray(raw.experimental_actions) ? raw.experimental_actions : [];
  return {
    enabled: raw.enabled === true,
    experimental_actions: [...new Set(actions.filter((action): action is DocumentAiAction =>
      typeof action === "string" && DOCUMENT_AI_ACTIONS.includes(action as DocumentAiAction)))],
  };
}
