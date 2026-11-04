/**
 * App-owned prompt templates (Step 17a T2, assistant-schema-1 E3).
 *
 * Prompts come from `assets/ai/prompts/`, never from file content. A template
 * is registered explicitly by the consuming feature, with 3-5 typed examples.
 * Source arguments stay data.
 */

export const MAX_SYSTEM_PROMPT = 32_768;
export const MAX_EXAMPLES = 5;
export const MIN_EXAMPLES = 3;

export type AssistantPromptLocale = "en" | "es";

export interface AiPromptExample {
  user: string;
  /** Canonical JSON text, checked by the schema's typed validator. */
  expected_canonical_json: string;
}

export interface AiPromptTemplate {
  id: string;
  revision: number;
  locale: AssistantPromptLocale;
  system_text: string;
  examples: AiPromptExample[];
  source_argument_names: string[];
}

const ASCII_ID = /^[A-Za-z0-9._-]{1,96}$/;
const ASCII_ARG = /^[A-Za-z0-9_.-]{1,64}$/;
const prompts = new Map<string, AiPromptTemplate>();

function key(id: string, locale: AssistantPromptLocale): string {
  return `${id}\u0000${locale}`;
}

export function registerAiPrompt(template: AiPromptTemplate): void {
  if (!ASCII_ID.test(template.id)) throw new Error("assistant.invalid_prompt");
  if (!Number.isSafeInteger(template.revision) || template.revision < 1) {
    throw new Error("assistant.invalid_prompt");
  }
  if (template.locale !== "en" && template.locale !== "es") {
    throw new Error("assistant.invalid_prompt");
  }
  if (
    template.system_text.length === 0 ||
    Array.from(template.system_text).length > MAX_SYSTEM_PROMPT
  ) {
    throw new Error("assistant.invalid_prompt");
  }
  if (template.examples.length < MIN_EXAMPLES || template.examples.length > MAX_EXAMPLES) {
    throw new Error("assistant.invalid_prompt");
  }
  for (const example of template.examples) {
    if (example.user.length === 0 || example.user.length > 8_192) {
      throw new Error("assistant.invalid_prompt");
    }
    try {
      JSON.parse(example.expected_canonical_json);
    } catch {
      throw new Error("assistant.invalid_prompt");
    }
  }
  if (template.source_argument_names.length > 32) {
    throw new Error("assistant.invalid_prompt");
  }
  if (template.source_argument_names.some((name) => !ASCII_ARG.test(name))) {
    throw new Error("assistant.invalid_prompt");
  }
  const slot = key(template.id, template.locale);
  if (prompts.has(slot)) throw new Error("assistant.invalid_prompt");
  prompts.set(slot, template);
}

export function getAiPrompt(id: string, locale: AssistantPromptLocale): AiPromptTemplate | null {
  return prompts.get(key(id, locale)) ?? null;
}

export function listAiPrompts(): readonly AiPromptTemplate[] {
  return [...prompts.values()].map((row) => ({
    ...row,
    examples: row.examples.map((example) => ({ ...example })),
  }));
}

/** Maps an argument name to the source-data marker used by the gateway. */
export function sourceArguments(template: AiPromptTemplate): readonly string[] {
  return [...template.source_argument_names];
}
