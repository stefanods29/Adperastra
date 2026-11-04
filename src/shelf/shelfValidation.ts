import {
  isAbsolutePath,
  isUuid,
  validateDocumentRef,
  type DocumentRef,
} from "../documents/types";
import { folderViewKey } from "../services/folderViews";
import type { CompletedItem } from "../services/fileops";
import {
  MAX_DISPLAY_NAME,
  MAX_SHELF_ITEMS,
  SHELF_SCHEMA,
  type ShelfCatalog,
  type ShelfItem,
  type ShelfPatch,
  type ShelfState,
} from "../services/shelf";

/** Shelf validation (Step 09g T3/T4). Pure: the wrappers, the panel and
 * the native store all apply the same bounds. Disk references dedupe with
 * `folderViewKey`; virtual references use the exact provider container and
 * entry id and never persist. */

const STATES: readonly ShelfState[] = ["available", "missing", "changed", "unavailable"];
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

function invalid(): Error {
  return new Error("shelf.invalid");
}

export function isShelfState(value: unknown): value is ShelfState {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

/** Windows accepts `/` as a separator; the native key
 * (`fs_service::path_key_of`) turns it into `\` before comparing. */
function shelfPathKey(path: string): string {
  return folderViewKey(path.replace(/\//g, "\\"));
}

/** The normalized key of a source, or `shelf.invalid` for a draft. */
export function shelfSourceKey(source: DocumentRef): string {
  if (source.kind === "disk") return `disk:${shelfPathKey(source.path)}`;
  if (source.kind === "virtual") {
    return `virtual:${shelfPathKey(source.container_path)}:${source.entry_id.toLowerCase()}`;
  }
  throw invalid();
}

/** Only disk references may be written to `shelf.json`. */
export function isPersistedShelfSource(source: DocumentRef): boolean {
  return source.kind === "disk";
}

/** Deduplicate sources in display order, refusing drafts and the limit. */
export function dedupeShelfSources(sources: readonly DocumentRef[]): DocumentRef[] {
  if (!Array.isArray(sources) || sources.length > MAX_SHELF_ITEMS) throw new Error("shelf.limit");
  const seen = new Set<string>();
  const out: DocumentRef[] = [];
  for (const value of sources) {
    const source = validateDocumentRef(value);
    if (!source || source.kind === "draft") throw invalid();
    const key = shelfSourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  if (out.length === 0) throw invalid();
  return out;
}

export function validateShelfItem(value: unknown): ShelfItem {
  if (value === null || typeof value !== "object") throw invalid();
  const item = value as Record<string, unknown>;
  const source = validateDocumentRef(item.source);
  if (!source || source.kind === "draft") throw invalid();
  if (
    typeof item.id !== "string" ||
    !isUuid(item.id) ||
    typeof item.display_name !== "string" ||
    item.display_name.length === 0 ||
    item.display_name.length > MAX_DISPLAY_NAME ||
    !Number.isSafeInteger(item.added_unix) ||
    (item.added_unix as number) < 0 ||
    (item.added_unix as number) > MAX_SAFE_INTEGER ||
    !isShelfState(item.state) ||
    typeof item.runtime_sensitive !== "boolean"
  ) {
    throw invalid();
  }
  if (
    item.last_checked_unix !== undefined &&
    (!Number.isSafeInteger(item.last_checked_unix) ||
      (item.last_checked_unix as number) < 0 ||
      (item.last_checked_unix as number) > MAX_SAFE_INTEGER)
  ) {
    throw invalid();
  }
  const sensitive = source.kind === "virtual";
  if (item.runtime_sensitive !== sensitive) throw invalid();
  return {
    id: item.id,
    source,
    display_name: item.display_name,
    added_unix: item.added_unix as number,
    state: item.state,
    ...(item.last_checked_unix === undefined
      ? {}
      : { last_checked_unix: item.last_checked_unix as number }),
    runtime_sensitive: sensitive,
  };
}

export function validateShelfCatalog(value: unknown): ShelfCatalog {
  if (value === null || typeof value !== "object") throw invalid();
  const catalog = value as Record<string, unknown>;
  if (catalog.schema_version !== SHELF_SCHEMA) throw invalid();
  if (
    !Number.isSafeInteger(catalog.revision) ||
    (catalog.revision as number) < 1 ||
    (catalog.revision as number) > MAX_SAFE_INTEGER
  ) {
    throw invalid();
  }
  if (!Array.isArray(catalog.items) || catalog.items.length > MAX_SHELF_ITEMS) {
    throw new Error("shelf.limit");
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const items = catalog.items.map((entry) => {
    const item = validateShelfItem(entry);
    if (ids.has(item.id.toLowerCase())) throw invalid();
    ids.add(item.id.toLowerCase());
    const key = shelfSourceKey(item.source);
    if (keys.has(key)) throw invalid();
    keys.add(key);
    return item;
  });
  return {
    schema_version: SHELF_SCHEMA,
    revision: catalog.revision as number,
    items,
  };
}

export function validateShelfPatch(value: unknown): ShelfPatch {
  if (value === null || typeof value !== "object") throw invalid();
  const patch = value as Record<string, unknown>;
  switch (patch.kind) {
    case "add": {
      if (!Array.isArray(patch.sources) || patch.sources.length === 0) throw invalid();
      if (patch.sources.length > MAX_SHELF_ITEMS) throw new Error("shelf.limit");
      return { kind: "add", sources: dedupeShelfSources(patch.sources as DocumentRef[]) };
    }
    case "remove":
    case "reorder": {
      if (!Array.isArray(patch.ids) || patch.ids.length === 0) throw invalid();
      if (patch.ids.length > MAX_SHELF_ITEMS) throw invalid();
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const id of patch.ids) {
        if (typeof id !== "string" || !isUuid(id) || seen.has(id.toLowerCase())) throw invalid();
        seen.add(id.toLowerCase());
        ids.push(id);
      }
      return { kind: patch.kind, ids };
    }
    case "clear":
      return { kind: "clear" };
    case "update_moved": {
      if (!Array.isArray(patch.moves) || patch.moves.length === 0) throw invalid();
      if (patch.moves.length > MAX_SHELF_ITEMS) throw invalid();
      const moves: CompletedItem[] = patch.moves.map((entry) => {
        if (entry === null || typeof entry !== "object") throw invalid();
        const move = entry as Record<string, unknown>;
        if (
          typeof move.from !== "string" ||
          typeof move.to !== "string" ||
          !isAbsolutePath(move.from) ||
          !isAbsolutePath(move.to)
        ) {
          throw invalid();
        }
        return { from: move.from, to: move.to };
      });
      return { kind: "update_moved", moves };
    }
    default:
      throw invalid();
  }
}

/** Files dropped on the shelf: absolute paths only, deduplicated. */
export function shelfDropPaths(paths: readonly string[]): string[] {
  if (!Array.isArray(paths)) throw invalid();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!isAbsolutePath(path)) continue;
    const key = shelfPathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  if (out.length > MAX_SHELF_ITEMS) throw new Error("shelf.limit");
  return out;
}

/** Ctrl+Alt+S toggles the shelf; Ctrl+Shift+S stays Save as. */
export function isShelfToggleShortcut(event: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): boolean {
  return (
    event.ctrlKey &&
    event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "s"
  );
}

/** Every completed move effect from an actual transfer report. Only a
 * move whose item finished, has a destination and removed its source
 * contributes; copy/skipped/failed/cancelled items never change a shelf
 * reference. */
export function projectMovedPaths(
  kind: "copy" | "move",
  items: readonly {
    from: string;
    to?: string;
    status: "done" | "skipped" | "failed" | "cancelled";
    source_removed: boolean;
  }[],
): CompletedItem[] {
  if (kind !== "move") return [];
  const out: CompletedItem[] = [];
  for (const item of items) {
    if (item.status === "done" && item.to && item.source_removed) {
      out.push({ from: item.from, to: item.to });
    }
  }
  return out;
}
