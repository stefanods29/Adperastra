import { invoke } from "@tauri-apps/api/core";
import { isAbsolutePath } from "../documents/types";
import { isTauriRuntime } from "./settings";
import { isUuid } from "./tabGroupValidation";
import type { SavedGroupCatalog } from "./savedGroups";

/** Export and import of `.adpgroups` files (Step 09b T4, E5/D7).
 * Export writes a new file through the native owned output and never
 * overwrites; import only reads and validates a bounded file, assigns
 * fresh group IDs natively, and never opens a path or starts an app. */

export const MAX_TRANSFER_GROUPS = 100;
const MAX_DIALOG_TEXT = 200;

/** Pick one `.adpgroups` file for import. A cancelled dialog is `null`;
 * the path is revalidated by the import command (absolute, bounded,
 * schema-checked) before the catalog changes. */
export async function pickSavedGroupsImport(
  title: string,
  filterName: string,
): Promise<string | null> {
  if (
    typeof title !== "string" ||
    title === "" ||
    [...title].length > MAX_DIALOG_TEXT ||
    typeof filterName !== "string" ||
    filterName === "" ||
    [...filterName].length > MAX_DIALOG_TEXT
  ) {
    throw new Error("groups.invalid");
  }
  if (!isTauriRuntime()) throw new Error("groups.io");
  return ((await invoke("saved_groups_pick_import", {
    title,
    filterName,
  })) ?? null) as string | null;
}

export async function exportSavedGroups(
  ids: readonly string[],
  destPath: string,
): Promise<{ path: string; bytes: number }> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_TRANSFER_GROUPS) {
    throw new Error("groups.invalid");
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isUuid(id) || seen.has(id)) throw new Error("groups.invalid");
    seen.add(id);
  }
  if (typeof destPath !== "string" || destPath === "" || !isAbsolutePath(destPath)) {
    throw new Error("groups.invalid");
  }
  if (!isTauriRuntime()) throw new Error("groups.io");
  return (await invoke("saved_groups_export", {
    ids: [...ids],
    destPath,
  })) as { path: string; bytes: number };
}

export async function importSavedGroups(
  path: string,
  expectedRevision: number,
): Promise<SavedGroupCatalog> {
  if (typeof path !== "string" || path === "" || !isAbsolutePath(path)) {
    throw new Error("groups.invalid");
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("groups.invalid");
  }
  if (!isTauriRuntime()) throw new Error("groups.io");
  return (await invoke("saved_groups_import", {
    path,
    expectedRevision,
  })) as SavedGroupCatalog;
}
