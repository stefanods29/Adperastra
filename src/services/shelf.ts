import { invoke } from "@tauri-apps/api/core";
import type { DocumentRef } from "../documents/types";
import { validateShelfCatalog, validateShelfPatch } from "../shelf/shelfValidation";
import type { CompletedItem } from "./fileops";
import { runJob, type JobHandle } from "./jobs";

/** Persistent shelf references (Step 09g, revision `shelf-1`).
 * The native mirror is `src-tauri/src/shelf_types.rs`. A shelf item is a
 * reference: adding, removing or clearing never moves or deletes a file.
 * Only disk references persist; virtual locked-folder references are
 * memory-only and marked `runtime_sensitive`. */

export const SHELF_SCHEMA = 1;
export const MAX_SHELF_ITEMS = 1000;
export const MAX_SHELF_BYTES = 2 * 1024 * 1024;
export const MAX_DISPLAY_NAME = 255;

export type ShelfState = "available" | "missing" | "changed" | "unavailable";

export interface ShelfItem {
  id: string;
  source: DocumentRef;
  /** Shown label; editing it never renames the original path. */
  display_name: string;
  added_unix: number;
  state: ShelfState;
  last_checked_unix?: number;
  /** True only for a virtual locked-folder reference (memory only). */
  runtime_sensitive: boolean;
}

export interface ShelfCatalog {
  schema_version: number;
  revision: number;
  items: ShelfItem[];
}

export type ShelfPatch =
  | { kind: "add"; sources: DocumentRef[] }
  | { kind: "remove"; ids: string[] }
  | { kind: "clear" }
  | { kind: "reorder"; ids: string[] }
  | { kind: "update_moved"; moves: CompletedItem[] };

/** The reviewed actions the shelf may start. Each one opens its normal
 * review UI; the shelf itself is never permission to modify a file. */
export type ShelfActionId =
  | "copy"
  | "move"
  | "compress"
  | "share"
  | "convert"
  | "privacy"
  | "open_group";

function badRequest(): Error {
  return new Error("shelf.invalid");
}

export async function getShelf(): Promise<ShelfCatalog> {
  const catalog = await invoke("shelf_get");
  return validateShelfCatalog(catalog);
}

/** One revision-checked change. `expectedRevision` comes from the
 * catalog the user is looking at; a concurrent change returns
 * `shelf.changed` and leaves the stored catalog untouched. */
export async function patchShelf(
  patch: ShelfPatch,
  expectedRevision: number,
): Promise<ShelfCatalog> {
  const normalized = validateShelfPatch(patch);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw badRequest();
  const catalog = await invoke("shelf_patch", {
    patch: normalized,
    expectedRevision,
  });
  return validateShelfCatalog(catalog);
}

/** Refresh availability for the given item ids (empty means all). The
 * native check uses attribute-only handles and never hydrates a cloud
 * file. */
export async function refreshShelf(ids: readonly string[]): Promise<JobHandle<ShelfCatalog>> {
  if (!Array.isArray(ids) || ids.length > MAX_SHELF_ITEMS) throw badRequest();
  for (const id of ids) {
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw badRequest();
    }
  }
  return runJob<ShelfCatalog>("shelf", (requestId) =>
    invoke("shelf_refresh_start", { requestId, ids: [...ids] }),
  );
}
