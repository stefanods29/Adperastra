import { invoke } from "@tauri-apps/api/core";
import type { DocumentRef } from "../documents/types";
import { isAbsolutePath, validateDocumentRef } from "../documents/types";
import { isTauriRuntime } from "./settings";
import { MAX_SPLIT_VIEW_ID_CHARS, validateSavedSplitDescriptor } from "./splitValidation";
import { serializeSplitTab, type SplitState } from "./splitViews";
import type { FolderTabState, TabsState } from "./tabs";
import { newGroupId, type GroupColor, type TabGroup } from "./tabGroups";
import { isGroupColor, isUuid, validateGroupName } from "./tabGroupValidation";
import type { FileAction, UndoEntryInput } from "./undo";
import { encodeViewState } from "./viewState";

/** Saved tab groups (Step 09b T3, revision saved-groups-1): the UI side
 * of `<data>/saved-tab-groups.json`. The native store is the authority;
 * these wrappers mirror its arguments exactly and validate before any
 * invoke. A saved descriptor is a session position only: no runtime
 * tab/document IDs, no grants or tokens, no unsaved content (D6-D8). */

export const SAVED_GROUPS_SCHEMA = 1;
export const MAX_SAVED_GROUPS = 100;
export const MAX_SAVED_TABS = 200;
export const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
export const MAX_HISTORY_RECORDS = 100;
export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_SAFE_UNIX = 9_007_199_254_740_991;

/** A saved tab position: the 09a session tab without `id`, `group_id`
 * or the runtime `document_id`. `pinned` is always false (D1). */
export interface SavedTabDescriptor {
  kind: "file" | "folder" | "split";
  title?: string;
  path?: string;
  handler?: string;
  source?: DocumentRef;
  folder?: FolderTabState;
  /** Serializable view state, bounded by the 09a codecs (64 KiB/view). */
  view?: unknown;
  view_version?: number;
  /** Split descriptors (Step 09i D7): both sides with encoded views and
   * fresh view ids on restore. Only `kind`, `split` and `pinned: false`
   * may appear; every other field is refused rather than dropped. */
  split?: SplitState;
  /** A promoted survivor's stable leaf view id (file/folder only). */
  content_view_id?: string;
  pinned?: false;
}

export interface SavedTabGroup {
  id: string;
  name: string;
  color: GroupColor;
  tabs: SavedTabDescriptor[];
  active_index: number;
  created_unix: number;
  modified_unix: number;
  version: 1;
}

export interface SavedGroupCatalog {
  schema_version: 1;
  groups: SavedTabGroup[];
  revision: number;
}

export interface SavedGroupWrite {
  expected_revision: number;
  group: SavedTabGroup;
}

export interface GroupRestoreReport {
  group_id: string;
  tab_ids: string[];
  missing_count: number;
  unsupported_count: number;
}

export interface SavedGroupHistoryRecord {
  id: string;
  before: SavedGroupCatalog;
  after: SavedGroupCatalog;
}

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "password",
  "passwd",
  "token",
  "access_token",
  "grant",
  "secret",
  "blob_url",
  "document_id",
  "group_id",
]);

function invalid(): Error {
  return new Error("groups.invalid");
}

function checkJsonValue(value: unknown, depth: number): void {
  if (depth > 8) throw invalid();
  if (typeof value === "string") {
    if ([...value].length > 8192) throw invalid();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid();
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) checkJsonValue(entry, depth + 1);
    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 64) throw invalid();
    for (const [key, entry] of entries) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw invalid();
      checkJsonValue(entry, depth + 1);
    }
  }
}

function isViewId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= MAX_SPLIT_VIEW_ID_CHARS &&
    /^[^\s\u0000-\u001f\u007f-\u009f]+$/.test(value)
  );
}

function checkDescriptor(descriptor: SavedTabDescriptor): void {
  if (descriptor === null || typeof descriptor !== "object") throw invalid();
  if (descriptor.kind !== "file" && descriptor.kind !== "folder" && descriptor.kind !== "split") {
    throw invalid();
  }
  if (descriptor.pinned) throw invalid();
  if (descriptor.kind === "split") {
    // A saved split reuses the exact split descriptor: `kind`, `split`
    // and `pinned: false` only, no outer title/source/view (Step 09i D7).
    const saved = validateSavedSplitDescriptor({
      kind: "split",
      split: descriptor.split,
      pinned: descriptor.pinned,
    });
    if (!saved) throw invalid();
    if (
      descriptor.title !== undefined ||
      descriptor.path !== undefined ||
      descriptor.handler !== undefined ||
      descriptor.source !== undefined ||
      descriptor.folder !== undefined ||
      descriptor.view !== undefined ||
      descriptor.view_version !== undefined ||
      descriptor.content_view_id !== undefined
    ) {
      throw invalid();
    }
    for (const leaf of [saved.split.first, saved.split.second]) {
      // A draft is a native runtime source and never a saved position.
      if (leaf.source?.kind === "draft") throw invalid();
      if (leaf.view !== undefined) checkJsonValue(leaf.view, 0);
    }
    descriptor.split = saved.split;
    return;
  }
  if (descriptor.split !== undefined) throw invalid();
  if (descriptor.title !== undefined && typeof descriptor.title !== "string") throw invalid();
  if (descriptor.path !== undefined && typeof descriptor.path !== "string") throw invalid();
  if (descriptor.path !== undefined && !isAbsolutePath(descriptor.path)) throw invalid();
  if (descriptor.title !== undefined && [...descriptor.title].length > 255) throw invalid();
  if (descriptor.path !== undefined && [...descriptor.path].length > 32768) throw invalid();
  if (
    descriptor.handler !== undefined &&
    (typeof descriptor.handler !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(descriptor.handler))
  ) {
    throw invalid();
  }
  if (descriptor.view_version !== undefined) {
    if (!Number.isInteger(descriptor.view_version) || descriptor.view_version < 0) throw invalid();
  }
  if (descriptor.content_view_id !== undefined && !isViewId(descriptor.content_view_id)) {
    throw invalid();
  }
  for (const part of [descriptor.source, descriptor.folder, descriptor.view]) {
    if (part !== undefined) checkJsonValue(part, 0);
  }
  if (descriptor.source !== undefined) {
    const source = validateDocumentRef(descriptor.source);
    // Shared allowlisted providers only; a runtime draft is refused.
    if (source === null || source.kind === "draft") throw invalid();
    descriptor.source = source;
  }
  if (descriptor.kind === "folder") {
    if (descriptor.folder === undefined) throw invalid();
  } else if (descriptor.path === undefined && descriptor.source === undefined) {
    throw invalid();
  }
  if (descriptor.view !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(descriptor.view)).length;
    if (bytes > 65536) throw invalid();
  }
  const source = descriptor.source as { kind?: string } | undefined;
  if (source && source.kind === "virtual") {
    // Virtual entries keep only the opaque reference (D8).
    if (descriptor.title !== undefined || descriptor.path !== undefined) throw invalid();
    if (descriptor.view !== undefined) throw invalid();
  }
}

/** Validate one saved group exactly as the native store does. */
export function validateSavedTabGroup(value: unknown): SavedTabGroup {
  if (value === null || typeof value !== "object") throw invalid();
  const group = value as SavedTabGroup;
  if (!isUuid(group.id)) throw invalid();
  validateGroupName(group.name);
  if (!isGroupColor(group.color)) throw invalid();
  if (!Array.isArray(group.tabs) || group.tabs.length < 1 || group.tabs.length > MAX_SAVED_TABS) {
    throw invalid();
  }
  if (
    !Number.isInteger(group.active_index) ||
    group.active_index < 0 ||
    group.active_index >= group.tabs.length
  ) {
    throw invalid();
  }
  for (const field of [group.created_unix, group.modified_unix]) {
    if (!Number.isSafeInteger(field) || field < 0 || field > MAX_SAFE_UNIX) throw invalid();
  }
  if (group.version !== 1) {
    throw new Error(
      typeof group.version === "number" && group.version > 1
        ? "groups.unsupported_version"
        : "groups.invalid",
    );
  }
  const fingerprints = new Set<string>();
  for (const descriptor of group.tabs) {
    checkDescriptor(descriptor);
    const fingerprint = JSON.stringify(descriptor);
    if (fingerprints.has(fingerprint)) throw invalid();
    fingerprints.add(fingerprint);
  }
  return group;
}

export function validateSavedCatalog(value: unknown): SavedGroupCatalog {
  if (value === null || typeof value !== "object") throw invalid();
  const catalog = value as SavedGroupCatalog;
  if (catalog.schema_version !== 1) {
    throw new Error(
      typeof catalog.schema_version === "number" && catalog.schema_version > 1
        ? "groups.unsupported_version"
        : "groups.invalid",
    );
  }
  if (!Array.isArray(catalog.groups) || catalog.groups.length > MAX_SAVED_GROUPS) {
    throw new Error(
      Array.isArray(catalog.groups) && catalog.groups.length > MAX_SAVED_GROUPS
        ? "groups.limit"
        : "groups.invalid",
    );
  }
  if (!Number.isSafeInteger(catalog.revision) || catalog.revision < 1) throw invalid();
  const ids = new Set<string>();
  for (const group of catalog.groups) {
    validateSavedTabGroup(group);
    if (ids.has(group.id)) throw invalid();
    ids.add(group.id);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(catalog)).length;
  if (bytes > MAX_CATALOG_BYTES) throw new Error("groups.limit");
  return catalog;
}

/** Build the saved form of a live group (explicit Save/Update only,
 * D6): runtime IDs and secrets never enter a descriptor. */
export function buildSavedGroup(
  state: TabsState,
  groupId: string,
  nowUnix: number,
  existing?: SavedTabGroup,
): SavedTabGroup {
  const group: TabGroup | undefined = (state.groups ?? []).find(
    (candidate) => candidate.id === groupId,
  );
  if (!group) throw invalid();
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const tabs: SavedTabDescriptor[] = [];
  for (const tabId of group.tab_ids) {
    const tab = byId.get(tabId);
    if (!tab || (tab.kind !== "file" && tab.kind !== "folder" && tab.kind !== "split")) {
      throw invalid();
    }
    if (tab.kind === "split") {
      // A split is one saved position: its two sides serialize through the
      // split codecs, and the outer tab keeps no title or source (D7).
      const saved = serializeSplitTab(tab);
      if (!saved) throw invalid();
      if (
        [saved.split.first, saved.split.second].some((leaf) => leaf.source?.kind === "draft")
      ) {
        throw invalid();
      }
      const splitDescriptor: SavedTabDescriptor = { kind: "split", split: saved.split, pinned: false };
      tabs.push(splitDescriptor);
      continue;
    }
    const descriptor: SavedTabDescriptor = { kind: tab.kind };
    // Drafts are native runtime sources, never a saved position.
    if (tab.source?.kind === "draft") throw invalid();
    if (tab.source && tab.source.kind === "virtual") {
      descriptor.source = tab.source;
    } else {
      if (tab.title !== undefined) descriptor.title = tab.title;
      if (tab.path !== undefined) descriptor.path = tab.path;
      if (tab.handler !== undefined) descriptor.handler = tab.handler;
      if (tab.source !== undefined) descriptor.source = tab.source;
      if (tab.folder !== undefined) descriptor.folder = tab.folder;
      if (tab.view !== undefined && tab.handler !== undefined) {
        // Saved views use the same bounded codecs as a session.
        const encoded = encodeViewState(tab.handler, tab.view);
        if (encoded !== null) {
          descriptor.view = encoded.view;
          descriptor.view_version = encoded.view_version;
        }
      }
    }
    // A promoted survivor keeps its leaf view identity; the id is opaque
    // and also valid on a locked (virtual) position.
    if (tab.content_view_id !== undefined) descriptor.content_view_id = tab.content_view_id;
    descriptor.pinned = false;
    tabs.push(descriptor);
  }
  const activeIndex = Math.max(0, group.tab_ids.indexOf(state.activeId));
  return validateSavedTabGroup({
    id: existing?.id ?? newGroupId(),
    name: group.name,
    color: group.color,
    tabs,
    active_index: activeIndex,
    created_unix: existing?.created_unix ?? nowUnix,
    modified_unix: nowUnix,
    version: 1,
  });
}

export async function listSavedGroups(): Promise<SavedGroupCatalog> {
  if (!isTauriRuntime()) return { schema_version: 1, groups: [], revision: 1 };
  return (await invoke("saved_groups_list")) as SavedGroupCatalog;
}

/** E4: write one group under the native revision check. */
export async function writeSavedGroup(request: SavedGroupWrite): Promise<SavedGroupCatalog> {
  validateSavedTabGroup(request.group);
  if (!Number.isSafeInteger(request.expected_revision) || request.expected_revision < 0) {
    throw invalid();
  }
  if (!isTauriRuntime()) throw new Error("groups.io");
  return (await invoke("saved_group_write", { request })) as SavedGroupCatalog;
}

export async function removeSavedGroup(
  id: string,
  expectedRevision: number,
): Promise<SavedGroupCatalog> {
  if (!isUuid(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw invalid();
  }
  if (!isTauriRuntime()) throw new Error("groups.io");
  return (await invoke("saved_group_remove", { id, expectedRevision })) as SavedGroupCatalog;
}

export interface SavedCatalogPort {
  list: () => Promise<SavedGroupCatalog>;
  write: (request: SavedGroupWrite) => Promise<SavedGroupCatalog>;
  remove: (id: string, expectedRevision: number) => Promise<SavedGroupCatalog>;
}

const nativeCatalogPort: SavedCatalogPort = {
  list: listSavedGroups,
  write: writeSavedGroup,
  remove: removeSavedGroup,
};

function catalogBytes(catalog: SavedGroupCatalog): number {
  return new TextEncoder().encode(JSON.stringify(catalog)).length;
}

/** E7: session-only Undo records for catalog changes (bounded 100/16MiB). */
export class SavedGroupHistory {
  private records = new Map<string, SavedGroupHistoryRecord>();
  private bytes = 0;

  constructor(private readonly port: SavedCatalogPort = nativeCatalogPort) {}

  record(before: SavedGroupCatalog, after: SavedGroupCatalog): string {
    validateSavedCatalog(before);
    validateSavedCatalog(after);
    const size = catalogBytes(before) + catalogBytes(after);
    if (
      size > MAX_HISTORY_BYTES ||
      this.records.size >= MAX_HISTORY_RECORDS ||
      this.bytes + size > MAX_HISTORY_BYTES
    ) {
      throw new Error("groups.limit");
    }
    const id = newGroupId();
    this.records.set(id, { id, before, after });
    this.bytes += size;
    return id;
  }

  /** Write the recorded catalog back through the revision-checked
   * native commands. Removals run first so a full catalog can shrink
   * before it grows; any concurrent change fails `groups.changed`. */
  async apply(id: string, reverse: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error("groups.changed");
    const target = reverse ? record.before : record.after;
    let current = await this.port.list();
    const targetIds = new Set(target.groups.map((group) => group.id));
    for (const group of current.groups) {
      if (!targetIds.has(group.id)) {
        current = await this.port.remove(group.id, current.revision);
      }
    }
    for (const group of target.groups) {
      const existing = current.groups.find((candidate) => candidate.id === group.id);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(group)) {
        current = await this.port.write({
          expected_revision: current.revision,
          group,
        });
      }
    }
  }

  releaseUnreferenced(ids: readonly string[]): void {
    for (const id of ids) {
      const record = this.records.get(id);
      if (!record) continue;
      this.bytes -= catalogBytes(record.before) + catalogBytes(record.after);
      this.records.delete(id);
    }
  }
}

export const savedGroupHistory = new SavedGroupHistory();

/** An Undo entry for one catalog change (E7 FileAction extension). */
export function savedGroupHistoryEntry(
  before: SavedGroupCatalog,
  after: SavedGroupCatalog,
  labelKey: string,
  labelArgs?: Record<string, string | number>,
  history: SavedGroupHistory = savedGroupHistory,
): UndoEntryInput {
  const id = history.record(before, after);
  const undo: FileAction = { type: "savedGroups", id, reverse: true };
  const redo: FileAction = { type: "savedGroups", id, reverse: false };
  return { labelKey, labelArgs, undo, redo };
}

export {
  exportSavedGroups,
  importSavedGroups,
  pickSavedGroupsImport,
} from "./savedGroupTransfer";
