import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConversionReport } from "../convert/types";
import type { FileIdentityKey } from "./fileIdentity";
import { readFileIdentity } from "./fileIdentity";
import type { JobHandle } from "./jobs";
import { runJob } from "./jobs";
import { UiHistoryRegistry } from "./uiHistory";

/** Tags (Step 11b, interface tags-1). Every call is native; only this
 * service invokes the tag commands. */

export interface Tag {
  id: string;
  name: string;
  color: string;
  icon_id: string;
  created_unix: number;
  modified_unix: number;
  revision: number;
}

export interface TagCatalog {
  schema_version: number;
  tags: Tag[];
  revision: number;
  /** Present on the answer of a catalog write: its Undo entry. */
  history_id?: string;
}

export interface TagAssignment {
  key: FileIdentityKey;
  display_path: string;
  tag_ids: string[];
  revision: number;
}

export interface TagMutation {
  keys: FileIdentityKey[];
  paths: string[];
  add: string[];
  remove: string[];
  expected_revisions: number[];
}

export interface TagSkipped {
  path: string;
  code: string;
}

export interface TagMutationResult {
  changed_count: number;
  skipped: TagSkipped[];
  next_cursor: string | null;
  history_id: string;
  complete: boolean;
}

/** The seven reserved identifiers never change across exports or profiles. */
export const DEFAULT_TAG_IDS = [
  "0f8fad1e-0001-4a3b-9c4d-000000000001",
  "0f8fad1e-0002-4a3b-9c4d-000000000002",
  "0f8fad1e-0003-4a3b-9c4d-000000000003",
  "0f8fad1e-0004-4a3b-9c4d-000000000004",
  "0f8fad1e-0005-4a3b-9c4d-000000000005",
  "0f8fad1e-0006-4a3b-9c4d-000000000006",
  "0f8fad1e-0007-4a3b-9c4d-000000000007",
] as const;

export const DEFAULT_TAG_COLORS = [
  "#D32F2F",
  "#EF6C00",
  "#F9A825",
  "#2E7D32",
  "#1565C0",
  "#7B1FA2",
  "#616161",
] as const;

/** Translation keys of the reserved names, in the same order. */
export const DEFAULT_TAG_NAME_KEYS = [
  "tags.red",
  "tags.orange",
  "tags.yellow",
  "tags.green",
  "tags.blue",
  "tags.purple",
  "tags.gray",
] as const;

export const TAG_ICON_IDS = ["tag", "dot", "star", "flag"] as const;

/** A batch that changed nothing carries this id instead of a history entry. */
export const NO_HISTORY_ID = "00000000-0000-4000-8000-000000000000";

type TagCatalogListener = (catalog: TagCatalog) => void;
const catalogListeners = new Set<TagCatalogListener>();

/** Observe committed catalog writes, including Undo from the shared stack. */
export function subscribeTagCatalog(listener: TagCatalogListener): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

function notifyTagCatalog(catalog: TagCatalog): void {
  for (const listener of catalogListeners) {
    try {
      listener(catalog);
    } catch {
      // One stale consumer must not stop the others.
    }
  }
}

/** Most keys one assignment read may ask for. */
export const MAX_ASSIGNMENT_KEYS = 256;
/** Most selected items one add/remove batch may touch. */
export const MAX_MUTATION_PATHS = 10_000;

export type TagTranslate = (key: string) => string;

export async function getTagCatalog(): Promise<TagCatalog> {
  return invoke<TagCatalog>("tags_catalog");
}

export async function saveTag(
  tag: Tag,
  expectedCatalogRevision: number,
): Promise<TagCatalog> {
  const catalog = await invoke<TagCatalog>("tag_save", {
    tag,
    expectedCatalogRevision,
  });
  recordTagHistory(catalog.history_id);
  notifyTagCatalog(catalog);
  return catalog;
}

export async function mergeTags(
  fromId: string,
  toId: string,
  expectedRevision: number,
): Promise<TagCatalog> {
  const catalog = await invoke<TagCatalog>("tag_merge", {
    fromId,
    toId,
    expectedRevision,
  });
  recordTagHistory(catalog.history_id);
  notifyTagCatalog(catalog);
  return catalog;
}

export async function deleteTag(
  id: string,
  expectedRevision: number,
): Promise<TagCatalog> {
  const catalog = await invoke<TagCatalog>("tag_delete", {
    id,
    expectedRevision,
  });
  recordTagHistory(catalog.history_id);
  notifyTagCatalog(catalog);
  return catalog;
}

export async function getAssignments(
  keys: readonly FileIdentityKey[],
): Promise<TagAssignment[]> {
  if (keys.length > MAX_ASSIGNMENT_KEYS) throw new Error("tags.invalid");
  return invoke<TagAssignment[]>("tag_assignments", { keys });
}

/** Page a large selection through the 256-key native read bound while
 * keeping the caller's order. */
async function assignmentsForKeys(
  keys: readonly FileIdentityKey[],
): Promise<TagAssignment[]> {
  const rows: TagAssignment[] = [];
  for (let index = 0; index < keys.length; index += MAX_ASSIGNMENT_KEYS) {
    rows.push(
      ...(await getAssignments(keys.slice(index, index + MAX_ASSIGNMENT_KEYS))),
    );
  }
  return rows;
}

export async function mutateTags(
  request: TagMutation,
): Promise<JobHandle<TagMutationResult>> {
  const handle = await runJob<TagMutationResult>("tags", (requestId) =>
    invoke("tag_mutate_start", { request, requestId }),
  );
  void handle.completion
    .then((result) => recordTagHistory(result.history_id))
    .catch(() => undefined);
  return handle;
}

/** Capture identities in bounded concurrent batches; a 10,000-item selection
 * must not open 10,000 native calls at once. */
async function identitiesForPaths(
  paths: readonly string[],
): Promise<FileIdentityKey[]> {
  const keys: FileIdentityKey[] = [];
  for (let index = 0; index < paths.length; index += MAX_ASSIGNMENT_KEYS) {
    keys.push(
      ...(await Promise.all(
        paths
          .slice(index, index + MAX_ASSIGNMENT_KEYS)
          .map((path) => readFileIdentity(path)),
      )),
    );
  }
  return keys;
}

/** Read the tags of selected paths through the metadata-only identity
 * capture. The caller passes the resulting rows back with the paths. */
export async function assignmentsForPaths(
  paths: readonly string[],
): Promise<TagAssignment[]> {
  if (paths.length === 0 || paths.length > MAX_MUTATION_PATHS) {
    throw new Error("tags.invalid");
  }
  const keys = await identitiesForPaths(paths);
  return assignmentsForKeys(keys);
}

/** Add and remove tags for selected paths in one operation: identities are
 * captured first, the current revisions are read, and one native batch owns
 * the whole change (one Undo). A path whose identity changed is skipped by
 * the native transaction, never re-attached by name. */
export async function mutateTagsForPaths(
  paths: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): Promise<JobHandle<TagMutationResult>> {
  if (paths.length === 0 || paths.length > MAX_MUTATION_PATHS) {
    throw new Error("tags.invalid");
  }
  const keys = await identitiesForPaths(paths);
  const current = await assignmentsForKeys(keys);
  return mutateTags({
    keys,
    paths: [...paths],
    add: [...add],
    remove: [...remove],
    expected_revisions: current.map((assignment) => assignment.revision),
  });
}

export async function tagUndo(
  historyId: string,
  reverse: boolean,
): Promise<TagCatalog> {
  const catalog = await invoke<TagCatalog>("tag_undo", { historyId, reverse });
  notifyTagCatalog(catalog);
  return catalog;
}

/** One completed Step 09f E8 mutation whose two sides both carry a stable
 * identity. This mirrors the canonical `identity-effects` wire shape; the
 * listener lives here until `fileIdentity.ts` exports its 09f E8 block. */
export interface IdentityEffect {
  operation_id: string;
  sequence: number;
  kind: "copy" | "move" | "rename";
  from_key: FileIdentityKey;
  from_path: string;
  to_key: FileIdentityKey;
  to_path: string;
  /** The native emitter only sends completed mutations; receipts are still
   * re-checked so an unproved one can never move a record. */
  complete: boolean;
}

/** The two payload shapes of one `identity-effects` batch. */
export type IdentityEvent =
  | { kind: "effect"; effect: IdentityEffect }
  | { kind: "overflow"; last_sequence: number };

/** Subscribe to the guarded Step 09f receipts. Batches are at most 256
 * effects and 768 KiB; sequence numbers only grow. */
export async function subscribeIdentityEffects(
  listener: (events: readonly IdentityEvent[]) => void,
): Promise<UnlistenFn> {
  return listen<readonly IdentityEvent[]>("identity-effects", (event) =>
    listener(event.payload),
  );
}

/** What one forwarded 09f batch changed in the native store. */
export interface TagIdentityApplySummary {
  applied: number;
  copies: number;
  moves: number;
  ignored: number;
  reconciled: boolean;
}

/** Forward one guarded 09f receipt batch to the native tag store. */
export async function applyTagIdentityEvents(
  events: readonly IdentityEvent[],
): Promise<TagIdentityApplySummary> {
  return invoke<TagIdentityApplySummary>("tag_identity_apply", { events });
}

/** Ask the native store to replay every membership into the search mirror.
 * Call once after the index is ready, after a rebuild, or after a crash; the
 * pending in-memory mirror queue is not durable by itself. */
export async function reconcileTagMirrors(): Promise<TagIdentityApplySummary> {
  return invoke<TagIdentityApplySummary>("tag_identity_apply", {
    events: [{ kind: "overflow", last_sequence: 0 }],
  });
}

/** Subscribe once during app wiring. A failed batch leaves the native store
 * untouched; the next assignment read is authoritative. */
export async function registerTagIdentityBridge(): Promise<UnlistenFn> {
  return subscribeIdentityEffects((events) => {
    void applyTagIdentityEvents(events).catch(() => undefined);
  });
}

/** One name that already exists in both the file and this catalog. */
export interface TagImportConflict {
  name: string;
  incoming_id: string;
  existing_id: string;
}

/** A parsed `.adptags` file, held native until the choices are applied. */
export interface TagImportPreview {
  preview_id: string;
  catalog: TagCatalog;
  /** The file carries personal file locations (opt-in on export). */
  contains_paths: boolean;
  conflicts: TagImportConflict[];
}

/** What to do with one conflicting incoming tag. */
export interface TagImportChoice {
  incoming_id: string;
  action: "merge" | "rename";
  target_id?: string;
  name?: string;
}

export interface TagExportResult {
  path: string;
  bytes: number;
}

/** Most files one rename/keyword batch may name. */
export const MAX_WRITE_PATHS = 10_000;

export async function importTags(path: string): Promise<TagImportPreview> {
  return invoke<TagImportPreview>("tags_import_preview", { path });
}

/** Pick an exchange file and parse its preview; null when cancelled. */
export async function pickTagImport(
  title: string,
  filterName: string,
): Promise<TagImportPreview | null> {
  return invoke<TagImportPreview | null>("tags_pick_import", {
    title,
    filterName,
  });
}

/** Pick a destination for a catalog-only export; null when cancelled. */
export async function pickTagExport(
  title: string,
  fileName: string,
  filterName: string,
): Promise<string | null> {
  return invoke<string | null>("tags_pick_export", {
    title,
    fileName,
    filterName,
  });
}

/** Apply a preview. Nothing is written until every conflict has a choice. */
export async function applyTagImport(
  previewId: string,
  choices: readonly TagImportChoice[],
  allowPaths: boolean,
): Promise<TagCatalog> {
  const catalog = await invoke<TagCatalog>("tags_import_apply", {
    previewId,
    choices,
    allowPaths,
  });
  recordTagHistory(catalog.history_id);
  notifyTagCatalog(catalog);
  return catalog;
}

/** Write a catalog-only `.adptags` file, or include personal locations. The
 * destination is never replaced. */
export async function exportTags(
  destPath: string,
  includePaths: boolean,
): Promise<JobHandle<TagExportResult>> {
  return runJob<TagExportResult>("tagsex", (requestId) =>
    invoke("tags_export_start", { destPath, includePaths, requestId }),
  );
}

/** Write the tags into a new image copy next to each source. Returns the
 * conversion-style report of the copies actually published. */
export async function writeEmbeddedTags(
  paths: readonly string[],
  destDir: string | null,
): Promise<JobHandle<ConversionReport>> {
  if (paths.length === 0 || paths.length > MAX_WRITE_PATHS) {
    throw new Error("tags.invalid");
  }
  return runJob<ConversionReport>("tagsw", (requestId) =>
    invoke("tags_write_start", { paths, destDir, requestId }),
  );
}

/** Name, color, icon and id of the seven reserved tags, without creating
 * anything. `ensureDefaultTags` stores the missing ones. */
export function defaultTagSeeds(t: TagTranslate): Tag[] {
  return DEFAULT_TAG_IDS.map((id, index) => ({
    id,
    name: t(DEFAULT_TAG_NAME_KEYS[index]),
    color: DEFAULT_TAG_COLORS[index],
    icon_id: "tag",
    created_unix: 0,
    modified_unix: 0,
    revision: 0,
  }));
}

/** Store the reserved tags that do not exist yet. A translated name already
 * used by a user tag is left alone instead of failing the whole seeding. */
export async function ensureDefaultTags(t: TagTranslate): Promise<TagCatalog> {
  let catalog = await getTagCatalog();
  for (const seed of defaultTagSeeds(t)) {
    if (catalog.tags.some((tag) => tag.id === seed.id)) continue;
    try {
      catalog = await invoke<TagCatalog>("tag_save", {
        tag: seed,
        expectedCatalogRevision: catalog.revision,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code !== "tags.invalid") throw error;
    }
  }
  notifyTagCatalog(catalog);
  return catalog;
}

type TagHistoryState = {
  history_id: string;
  reverse: boolean;
};

let tagHistoryRegistered = false;

/** Register the tag Undo adapter once during app wiring. Calling it again
 * keeps the first registration (Step 09a registries are static). */
export function registerTagHistory(): void {
  if (tagHistoryRegistered) return;
  UiHistoryRegistry.registerAdapter("tags", {
    validate: (state) => isTagHistoryState(state),
    apply: async (state) => {
      if (!isTagHistoryState(state)) throw new Error("tags.invalid");
      await tagUndo(state.history_id, state.reverse);
    },
  });
  tagHistoryRegistered = true;
}

/** Record one native tag state as Undo/Redo. Returns the registry id. */
export function recordTagHistory(historyId?: string | null): string | null {
  if (
    !tagHistoryRegistered ||
    !historyId ||
    historyId === NO_HISTORY_ID ||
    !isUuid(historyId)
  ) {
    return null;
  }
  try {
    return UiHistoryRegistry.record(
      "tags",
      { history_id: historyId, reverse: true },
      { history_id: historyId, reverse: false },
    );
  } catch {
    // The native write already committed. A full UI history must not turn
    // that success into an error; the native entry remains available to a
    // later explicit Undo path, and the toast can say so.
    return null;
  }
}

function isTagHistoryState(state: unknown): state is TagHistoryState {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const value = state as Record<string, unknown>;
  return (
    typeof value.history_id === "string" &&
    isUuid(value.history_id) &&
    typeof value.reverse === "boolean"
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}
