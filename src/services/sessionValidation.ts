import type { DocumentRef, SerializableViewState } from "../documents/types";
import { validateDocumentRef } from "../documents/types";
import { validateFolderTabState, type FolderTabState } from "./folderState";
import { MAX_SPLIT_VIEW_ID_CHARS, validateSavedSplitDescriptor } from "./splitValidation";
import type { SessionData, SessionTab } from "./tabs";
import { sanitizeSessionGroups } from "./tabGroupValidation";
import { isSerializableViewState } from "./viewState";

/** Session validation (Step 09a D5/D6). The session stores descriptors and
 * bounded view state only: no live content, passwords, tokens, blob URLs
 * or parser objects. A session from a newer schema is refused as a whole
 * and the original file is retained, never written down. */

export const MAX_SESSION_TABS = 200;
export const MAX_SESSION_HISTORY = 200;
export const MAX_SESSION_BYTES = 4 * 1024 * 1024;
export const SESSION_SCHEMA_VERSION = 3;

export class SessionValidationError extends Error {
  readonly code = "tabs.invalid_state";
  constructor() {
    super("tabs.invalid_state");
  }
}

/** A session written by a newer schema is never downgraded: once one is
 * read, this run keeps the original file instead of saving over it. */
let writesBlocked = false;

export function blockSessionWrites(): void {
  writesBlocked = true;
}

export function sessionWritesBlocked(): boolean {
  return writesBlocked;
}

/** Test helper: forget the downgrade refusal. */
export function resetSessionWriteBlockForTests(): void {
  writesBlocked = false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/** A promoted survivor's leaf view id: the same bounds the split codecs
 * apply (non-empty, at most 128 characters, no whitespace or controls). */
function isViewId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= MAX_SPLIT_VIEW_ID_CHARS &&
    /^[^\s\u0000-\u001f\u007f-\u009f]+$/.test(value)
  );
}

/** Serialize-then-measure: the same bytes the native side will write. */
export function sessionByteLength(data: SessionData): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

function validateTab(entry: unknown, knownHandlers: readonly string[]): SessionTab | null {
  if (!isRecord(entry)) return null;
  const id = boundedString(entry.id, 128);
  const kind = entry.kind;
  if (!id || typeof kind !== "string") return null;
  const tab: SessionTab = { id, kind };
  const title = boundedString(entry.title, 255);
  if (title !== undefined) tab.title = title;
  if (entry.pinned === true) tab.pinned = true;
  if (
    typeof entry.group_id === "string" &&
    entry.group_id.length > 0 &&
    entry.group_id.length <= 128
  ) {
    tab.group_id = entry.group_id;
  }
  if (entry.view !== undefined && entry.view !== null) {
    if (!isSerializableViewState(entry.view)) return null;
    tab.view = entry.view as SerializableViewState;
    if (typeof entry.view_version === "number" && Number.isSafeInteger(entry.view_version) && entry.view_version >= 0) {
      tab.view_version = entry.view_version;
    }
  }
  if (entry.split !== undefined && kind !== "split") return null;
  if (kind === "split") {
    // A split outer tab carries its two sides and nothing positional:
    // source, folder, view and the missing placeholder live on the leaves
    // (Step 09i D7). Extra or nested fields are refused by the codec.
    const descriptor = validateSavedSplitDescriptor({ kind: "split", split: entry.split });
    if (!descriptor) return null;
    if (
      entry.path !== undefined ||
      entry.handler !== undefined ||
      entry.source !== undefined ||
      entry.folder !== undefined ||
      entry.view !== undefined ||
      entry.view_version !== undefined ||
      entry.missing_reason !== undefined ||
      entry.content_view_id !== undefined
    ) {
      return null;
    }
    tab.split = descriptor.split;
    return tab;
  }
  if (entry.content_view_id !== undefined) {
    // Only a promoted normal tab keeps a leaf view identity; a split names
    // its sides instead, and singleton tabs never have one.
    if ((kind !== "file" && kind !== "folder") || !isViewId(entry.content_view_id)) return null;
    tab.content_view_id = entry.content_view_id;
  }
  if (kind === "folder") {
    const folder: FolderTabState | null = validateFolderTabState(entry.folder);
    if (!folder) return null;
    tab.folder = folder;
    tab.path = folder.path;
    return tab;
  }
  if (kind === "file") {
    const handler = boundedString(entry.handler, 64);
    if (!handler) return null;
    tab.handler = handler;
    if (entry.source !== undefined) {
      const source: DocumentRef | null = validateDocumentRef(entry.source);
      if (!source) return null;
      tab.source = source;
      if (source.kind === "disk") tab.path = source.path;
      // Virtual titles and paths stay inside the provider's encrypted
      // store: a serialized virtual tab carries no plain title or path.
      if (source.kind === "virtual") {
        delete tab.title;
        delete tab.path;
        delete tab.view;
        delete tab.view_version;
      }
      if (source.kind === "draft") delete tab.path;
    } else {
      const path = boundedString(entry.path, 32768);
      if (!path) return null;
      tab.path = path;
    }
    if (!knownHandlers.includes(handler)) {
      // Unknown handler: keep a recoverable placeholder instead of
      // dropping the tab (the host marks it `handler_missing`).
      tab.missing_reason = "handler_missing";
    }
    return tab;
  }
  if (kind === "explorer" || kind === "help" || kind === "settings" || kind === "gallery") {
    return tab;
  }
  return null;
}

/** Validate raw session JSON into a schema-2 `SessionData`. Throws
 * `SessionValidationError` (`tabs.invalid_state`) for a newer schema or an
 * oversized payload; individually broken tabs are skipped. */
export function validateSessionData(input: unknown, knownHandlers: readonly string[]): SessionData {
  if (!isRecord(input)) throw new SessionValidationError();
  const schema = input.schema_version;
  if (schema !== undefined && (typeof schema !== "number" || !Number.isSafeInteger(schema) || schema < 1)) {
    throw new SessionValidationError();
  }
  if (typeof schema === "number" && schema > SESSION_SCHEMA_VERSION) {
    // Refuse the whole payload and keep the newer original on disk: the
    // next save must not replace it with a downgraded schema-2 session.
    blockSessionWrites();
    throw new SessionValidationError();
  }
  if (!Array.isArray(input.tabs) || input.tabs.length > MAX_SESSION_TABS) {
    throw new SessionValidationError();
  }
  const tabs: SessionTab[] = [];
  const seen = new Set<string>();
  for (const entry of input.tabs) {
    const tab = validateTab(entry, knownHandlers);
    if (!tab || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
  }
  const history = Array.isArray(input.history)
    ? input.history.filter((id): id is string => typeof id === "string" && seen.has(id)).slice(-MAX_SESSION_HISTORY)
    : [];
  const result: SessionData = {
    schema_version: SESSION_SCHEMA_VERSION,
    tabs,
    active_tab: typeof input.active_tab === "string" && seen.has(input.active_tab) ? input.active_tab : "explorer",
    saved_unix: typeof input.saved_unix === "number" && Number.isFinite(input.saved_unix) ? Math.max(0, Math.floor(input.saved_unix)) : 0,
    history,
    groups: sanitizeSessionGroups(input.groups),
  };
  if (sessionByteLength(result) > MAX_SESSION_BYTES) throw new SessionValidationError();
  return result;
}
