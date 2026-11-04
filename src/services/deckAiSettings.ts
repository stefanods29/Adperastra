import {
  DECK_AI_ACTIONS,
  type DeckAiAction,
  type DeckAiSettings,
} from "../office/deck/ai/deckAiTypes";

/** Settings schema 55 -> 56: AI deck drafting is off and every experimental
 * action is empty until a real evaluation and an explicit user opt-in. */

export const DECK_AI_SETTINGS_DEFAULTS: Readonly<DeckAiSettings> = Object.freeze({
  enabled: false,
  experimental_actions: [],
});

export function defaultDeckAiSettings(): DeckAiSettings {
  return {
    enabled: DECK_AI_SETTINGS_DEFAULTS.enabled,
    experimental_actions: [...DECK_AI_SETTINGS_DEFAULTS.experimental_actions],
  };
}

function isAction(value: unknown): value is DeckAiAction {
  return typeof value === "string" && (DECK_AI_ACTIONS as readonly string[]).includes(value);
}

export function normalizeDeckAiSettings(input: unknown): DeckAiSettings {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return defaultDeckAiSettings();
  }
  const record = input as Record<string, unknown>;
  const actions = Array.isArray(record.experimental_actions)
    ? [...new Set(record.experimental_actions.filter(isAction))]
    : [];
  return {
    enabled: record.enabled === true,
    experimental_actions: actions,
  };
}

/** An action needs the feature switch and an explicit experimental opt-in. */
export function deckAiActionEnabled(settings: DeckAiSettings, action: DeckAiAction): boolean {
  return settings.enabled && settings.experimental_actions.includes(action);
}
