import {
  validateDeckStyleCatalog,
  validateStyleAddition,
} from "./styleValidation";
import {
  DeckStyleError,
  MAX_DECK_STYLE_CATALOG_BYTES,
  type DeckStyle,
  type DeckStyleCatalog,
} from "./styleTypes";

/** Catalog changes use the 09a UI history, never document Undo. A record is
 * one save or one remove; restore replays exactly that one-step difference so
 * every applied step stays one atomic catalog write.
 *
 * The adapter validates a state (<=4 MiB) before it is recorded; a failure
 * leaves both the catalog and the global cursor unchanged. */

export const DECK_STYLE_CATALOG_ADAPTER_ID = "deck-style-catalog";

export interface DeckStyleCatalogHistoryHost {
  list(): Promise<DeckStyleCatalog>;
  save(style: DeckStyle, expectedRevision: number): Promise<DeckStyleCatalog>;
  remove(id: string, expectedRevision: number): Promise<DeckStyleCatalog>;
}

/** The subset of 09a `UiHistoryRegistry` this feature uses. The real registry
 * satisfies this structurally; states stay opaque at this boundary and are
 * validated by the adapter before `record`. */
export interface DeckStyleCatalogHistoryAdapter {
  validate(state: unknown): boolean;
  apply(state: unknown): Promise<void>;
}

export interface DeckStyleCatalogHistoryRegistry {
  registerAdapter(id: string, adapter: DeckStyleCatalogHistoryAdapter): void;
  record(adapterId: string, before: unknown, after: unknown): string;
  apply(id: string, reverse: boolean): Promise<void>;
}

export interface DeckStyleCatalogDiff {
  added: DeckStyle | null;
  removed: DeckStyle | null;
  changed: DeckStyle | null;
}

export function catalogDiff(current: DeckStyleCatalog, target: DeckStyleCatalog): DeckStyleCatalogDiff {
  const currentById = new Map(current.styles.map((style) => [style.id, style]));
  const targetById = new Map(target.styles.map((style) => [style.id, style]));
  const added = target.styles.filter((style) => !currentById.has(style.id));
  const removed = current.styles.filter((style) => !targetById.has(style.id));
  const changed = target.styles.filter((style) => {
    const before = currentById.get(style.id);
    return before !== undefined && JSON.stringify(before) !== JSON.stringify(style);
  });
  const sameCount = current.styles.length === target.styles.length;
  if (sameCount && added.length === 0 && removed.length === 0 && changed.length <= 1) {
    return { added: null, removed: null, changed: changed[0] ?? null };
  }
  if (added.length === 1 && removed.length === 0 && changed.length === 0) {
    return { added: added[0], removed: null, changed: null };
  }
  if (removed.length === 1 && added.length === 0 && changed.length === 0) {
    return { added: null, removed: removed[0], changed: null };
  }
  throw new DeckStyleError("deck_style.history_full");
}

export function sameCatalogContent(left: DeckStyleCatalog, right: DeckStyleCatalog): boolean {
  const normalize = (catalog: DeckStyleCatalog) =>
    [...catalog.styles]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((style) => JSON.stringify(style));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Register once with the app's UI history registry. */
export function registerDeckStyleCatalogHistory(
  registry: DeckStyleCatalogHistoryRegistry,
  host: DeckStyleCatalogHistoryHost,
): void {
  registry.registerAdapter(DECK_STYLE_CATALOG_ADAPTER_ID, {
    validate(state) {
      try {
        const catalog = validateDeckStyleCatalog(state);
        return byteLength(catalog) <= MAX_DECK_STYLE_CATALOG_BYTES;
      } catch {
        return false;
      }
    },
    async apply(state) {
      const target = validateDeckStyleCatalog(state);
      const current = await host.list();
      const diff = catalogDiff(current, target);
      let next: DeckStyleCatalog;
      if (diff.changed) {
        // Save is also the one-step path for an edited style. It refuses a
        // case-folded duplicate instead of overwriting another entry.
        validateStyleAddition(
          { ...current, styles: current.styles.filter((style) => style.id !== diff.changed?.id) },
          diff.changed,
        );
        next = await host.save(diff.changed, current.revision);
      } else if (diff.added) {
        next = await host.save(diff.added, current.revision);
      } else if (diff.removed) {
        next = await host.remove(diff.removed.id, current.revision);
      } else {
        next = current;
      }
      if (!sameCatalogContent(next, target)) throw new DeckStyleError("deck_style.changed");
    },
  });
}

/** Record one completed catalog change. Throws `ui_history.limit` from the
 * registry without touching the catalog or the cursor. */
export function recordDeckStyleCatalogChange(
  registry: DeckStyleCatalogHistoryRegistry,
  before: DeckStyleCatalog,
  after: DeckStyleCatalog,
): string {
  const validatedBefore = validateDeckStyleCatalog(before);
  const validatedAfter = validateDeckStyleCatalog(after);
  if (!sameCatalogContent(validatedBefore, validatedAfter)) {
    // A multi-entry jump must never become one unreplayable history record.
    catalogDiff(validatedBefore, validatedAfter);
  }
  return registry.record(DECK_STYLE_CATALOG_ADAPTER_ID, validatedBefore, validatedAfter);
}
