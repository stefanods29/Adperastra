import { UiHistoryRegistry } from "../../services/uiHistory";
import { appUndoStack } from "../../services/undo";
import {
  listDeckStyles,
  removeDeckStyle,
  saveDeckStyle,
} from "../../services/deckStyles";
import {
  DECK_STYLE_CATALOG_ADAPTER_ID,
  registerDeckStyleCatalogHistory,
  recordDeckStyleCatalogChange,
} from "./styles/styleCatalogHistory";
import type { DeckStyle, DeckStyleCatalog } from "./styles/styleTypes";

/** Coordinator wiring for the 22b user-style catalog (E3).
 *
 * The catalog is application state, so its changes are recorded in the 09a
 * UI history and the shared app Undo stack, never in the document Undo. The
 * adapter is registered once; a failed history reservation never turns an
 * already committed catalog write into an error. */

/** The approved native DeckStyleHost adapter (20a/22a preview and apply) is
 * not registered in this build, so `deck_style_prepare`/`deck_style_apply`
 * answer `office_edit.engine_missing`. The library stays readable and the
 * catalog stays usable, but Apply must stay disabled instead of failing after
 * the click. Flip this only together with the native host registration. */
export const DECK_STYLE_APPLY_HOST_AVAILABLE = false;

let registered = false;

export function ensureDeckStyleCatalogHistory(): void {
  if (registered) return;
  if (!UiHistoryRegistry.hasAdapter(DECK_STYLE_CATALOG_ADAPTER_ID)) {
    registerDeckStyleCatalogHistory(UiHistoryRegistry, {
      // Wrappers keep the registration itself free of reads that a partially
      // mocked test module may not provide; the real services are called only
      // when a catalog change or its Undo actually runs.
      list: () => listDeckStyles(),
      save: (style, expectedRevision) => saveDeckStyle(style, expectedRevision),
      remove: (id, expectedRevision) => removeDeckStyle(id, expectedRevision),
    });
  }
  registered = true;
}

function recordChange(
  before: DeckStyleCatalog,
  after: DeckStyleCatalog,
  labelKey: string,
): void {
  try {
    const id = recordDeckStyleCatalogChange(UiHistoryRegistry, before, after);
    appUndoStack.push({
      labelKey,
      undo: { type: "uiState", id, reverse: true },
      redo: { type: "uiState", id, reverse: false },
    });
  } catch {
    // The catalog write already committed. A full UI history must not turn
    // that success into a failure; the next explicit change can still record.
  }
}

/** Register the adapter and read the catalog the library displays. */
export async function listDeckStylesWithHistory(): Promise<DeckStyleCatalog> {
  ensureDeckStyleCatalogHistory();
  return listDeckStyles();
}

/** Save one imported style, then record exactly that one-step change. */
export async function saveDeckStyleWithHistory(style: DeckStyle): Promise<DeckStyleCatalog> {
  ensureDeckStyleCatalogHistory();
  const before = await listDeckStyles();
  const after = await saveDeckStyle(style, before.revision);
  recordChange(before, after, "deckStyle.import");
  return after;
}

/** Remove one user style, then record exactly that one-step change. */
export async function removeDeckStyleWithHistory(
  id: string,
  expectedRevision: number,
  before: DeckStyleCatalog,
): Promise<DeckStyleCatalog> {
  ensureDeckStyleCatalogHistory();
  const after = await removeDeckStyle(id, expectedRevision);
  recordChange(before, after, "deckStyle.remove");
  return after;
}
