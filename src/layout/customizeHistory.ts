import type { SerializableViewState } from "../documents/types";
import {
  validateToolbarCustomSettings,
  type ToolbarCustomSettings,
} from "../services/commandLayout";
import { validateKeyboardCustomSettings } from "../services/keyboardMaps";
import type { KeyboardCustomSettings } from "../keyboard/types";
import { UiHistoryRegistry } from "../services/uiHistory";

/** Toolbar and keyboard changes in the shared UI history (Step 10b T5,
 * producer 09a E9). One Apply is one history entry; capacity is reserved
 * before anything mutates, and undo applies validated settings data —
 * it never runs a command. */

export const COMMAND_LAYOUT_ADAPTER = "command-layout";
export const KEYBOARD_MAP_ADAPTER = "keyboard-map";

/** The actual 09a registry API (static methods). Pass `UiHistoryRegistry`
 * itself; the narrow type keeps the test double honest. */
export type CustomizeHistoryRegistry = Pick<
  typeof UiHistoryRegistry,
  "registerAdapter" | "record" | "apply" | "releaseUnreferenced"
>;

export const customizeHistoryRegistry: CustomizeHistoryRegistry = UiHistoryRegistry;

export interface CustomizeHistoryHost {
  getToolbar(): ToolbarCustomSettings;
  applyToolbar(value: ToolbarCustomSettings): Promise<void>;
  getKeyboard(): KeyboardCustomSettings;
  applyKeyboard(value: KeyboardCustomSettings): Promise<void>;
}

function asState(value: ToolbarCustomSettings | KeyboardCustomSettings): SerializableViewState {
  return JSON.parse(JSON.stringify(value)) as SerializableViewState;
}

function validToolbar(state: SerializableViewState): boolean {
  try {
    validateToolbarCustomSettings(state);
    return true;
  } catch {
    return false;
  }
}

function validKeyboard(state: SerializableViewState): boolean {
  try {
    validateKeyboardCustomSettings(state);
    return true;
  } catch {
    return false;
  }
}

/** Register both adapters once (coordinator calls this at startup). */
export function registerCustomizeHistory(registry: CustomizeHistoryRegistry, host: CustomizeHistoryHost): void {
  registry.registerAdapter(COMMAND_LAYOUT_ADAPTER, {
    validate: validToolbar,
    apply: async (state) => {
      await host.applyToolbar(validateToolbarCustomSettings(state));
    },
  });
  registry.registerAdapter(KEYBOARD_MAP_ADAPTER, {
    validate: validKeyboard,
    apply: async (state) => {
      await host.applyKeyboard(validateKeyboardCustomSettings(state));
    },
  });
}

/** Apply a toolbar change as one undoable entry. The history record is
 * reserved first; when saving fails the orphan record is released and
 * the caller's draft stays untouched. */
export async function applyToolbarWithHistory(
  registry: CustomizeHistoryRegistry,
  host: CustomizeHistoryHost,
  next: ToolbarCustomSettings,
  retainedIds: readonly string[],
): Promise<string> {
  const validated = validateToolbarCustomSettings(next);
  const id = registry.record(COMMAND_LAYOUT_ADAPTER, asState(host.getToolbar()), asState(validated));
  try {
    await host.applyToolbar(validated);
  } catch (error) {
    // The producer keeps the supplied ids and drops every unreferenced record.
    // Preserve the existing Undo stack while discarding only this failed draft.
    registry.releaseUnreferenced(retainedIds);
    throw error;
  }
  return id;
}

export async function applyKeyboardWithHistory(
  registry: CustomizeHistoryRegistry,
  host: CustomizeHistoryHost,
  next: KeyboardCustomSettings,
  retainedIds: readonly string[],
): Promise<string> {
  const validated = validateKeyboardCustomSettings(next);
  const id = registry.record(KEYBOARD_MAP_ADAPTER, asState(host.getKeyboard()), asState(validated));
  try {
    await host.applyKeyboard(validated);
  } catch (error) {
    registry.releaseUnreferenced(retainedIds);
    throw error;
  }
  return id;
}
