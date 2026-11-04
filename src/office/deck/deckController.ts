import type { DocumentHandle } from "../../documents/types";
import { errorCode } from "../../services/errors";
import {
  acquireOfficeController,
  registerOfficeControllerFactory,
  type OfficeController,
} from "../OfficeController";
import { canOfficeCommand } from "../officeCompatibility";
import type { OfficeCapability, OfficeSessionState } from "../types";

/** The slide editor's one shared controller (Step 22a T1, E1).
 * `office-slide` is the existing read-only Office handler from Step 13; the
 * editor upgrades it with a deck presenter instead of registering a second
 * broad Office handler. The controller factory is a trusted static
 * registration; every view of one document receives the same controller. */

export const DECK_HANDLER_ID = "office-slide";
export const DECK_FAMILY = "deck";

let registered = false;

/** Called once by the application registration, never from a mounted view. */
export function registerDeckEditorController(): void {
  if (registered) return;
  registered = true;
  registerOfficeControllerFactory(DECK_HANDLER_ID, DECK_FAMILY);
}

/** Acquire the registry-owned editable model. The 20a controller is
 * reference-counted; calling this twice for two views must return the same
 * model and must not create a second engine session. */
export function acquireDeckController(document: DocumentHandle): Promise<OfficeController> {
  return acquireOfficeController(document, DECK_FAMILY);
}

export type DeckControllerResult =
  | { kind: "editing"; controller: OfficeController }
  | { kind: "viewing"; reason_key: string };

/** A missing or unsuitable engine keeps the Step 13 read-only presenter. */
export async function openDeckController(
  document: DocumentHandle,
  previewOnly = false,
): Promise<DeckControllerResult> {
  if (previewOnly) return { kind: "viewing", reason_key: "office.readOnly" };
  try {
    const controller = await acquireDeckController(document);
    return { kind: "editing", controller };
  } catch (error) {
    const code = errorCode(error);
    if (code === "office_edit.engine_missing") {
      return { kind: "viewing", reason_key: "office.engineNeeded" };
    }
    if (code === "office_edit.unsupported" || code === "office_edit.preservation_failed") {
      return { kind: "viewing", reason_key: "office.unsupported" };
    }
    throw error;
  }
}

/** Save-existing is never advertised by the canonical OfficeController: it
 * strips `save_existing` from every state and reports `can_save_existing`
 * false. Both facts must agree before a Save button or command may run. */
export function canSaveDeckExisting(controller: OfficeController): boolean {
  const state = controller.getState();
  return controller.document.getState().can_save_existing === true &&
    Array.isArray(state?.capabilities) && state.capabilities.includes("save_existing");
}

/** A mutation is allowed only for a ready, editable, capable session, never
 * for a preview copy or a protected/downloaded document that was not enabled. */
export function canDeckMutate(
  document: DocumentHandle | null,
  state: OfficeSessionState,
  capability: OfficeCapability,
  previewOnly = false,
): { enabled: boolean; reason_key: string | null } {
  if (previewOnly) return { enabled: false, reason_key: "office.enableEditing" };
  if (document) {
    if (document.info.read_only) return { enabled: false, reason_key: "office.readOnly" };
    if (document.info.from_internet && state.mode === "viewing") {
      return { enabled: false, reason_key: "office.enableEditing" };
    }
  }
  return canOfficeCommand(state, capability, true);
}

/** Settings schema 54 -> 55 values (Step 22a D10). */
export interface DeckEditorSettings {
  show_notes: boolean;
  snap_to_grid: boolean;
  default_aspect: "wide";
  presenter_view: boolean;
}

export const DECK_EDITOR_DEFAULTS: DeckEditorSettings = {
  show_notes: true,
  snap_to_grid: false,
  default_aspect: "wide",
  presenter_view: true,
};

/** Validate one `deck_editor` settings block. Unknown values fall back to the
 * default instead of being persisted. New decks always start 16:9 ("wide"). */
export function normalizeDeckEditorSettings(value: unknown): DeckEditorSettings {
  const item =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    show_notes: item.show_notes !== false,
    snap_to_grid: item.snap_to_grid === true,
    default_aspect: "wide",
    presenter_view: item.presenter_view !== false,
  };
}

/** Merge the new block into the previous settings without touching any
 * existing preference. Used by the coordinator's schema-55 migration. */
export function mergeDeckEditorSettings(
  previous: Record<string, unknown>,
  deckEditor: unknown,
): Record<string, unknown> {
  return { ...previous, deck_editor: normalizeDeckEditorSettings(deckEditor) };
}
