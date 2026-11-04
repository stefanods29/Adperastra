import {
  abortExportSnapshot,
  appendExportSnapshot,
  beginExportSnapshot,
  finishExportSnapshot,
  releaseSnapshotAuthority,
  releaseExportSnapshot,
  type ExportSnapshot,
} from "../services/exportSnapshots";
import {
  chooseLockedRecovery,
  listLockedRecovery,
  lockedEntryInfo,
  markLockedDirty,
  persistLockedSnapshot,
  readLockedEntry,
  registerLockedModelPersister,
  saveLockedCopy,
  touchLockedSession,
  type LockedEntry,
  type LockedPersistResult,
  type LockedRecoveryAction,
  type LockedSession,
} from "../services/lockedFolders";
import {
  registerDocumentClosePolicy,
  type DocumentCloseReason,
} from "./closePolicies";
import {
  registerDocumentControllerFactory,
  type DocumentControllerBinding,
  type DocumentControllerContext,
} from "./controller";
import {
  initialDocumentState,
  type DocumentHandle,
  type DocumentInfo,
  type DocumentProvider,
  type DocumentRef,
  type DocumentState,
} from "./types";
import { extensionOf } from "../services/files";
import { DocumentRegistry } from "./DocumentRegistry";

/** The one locked-container document provider (Step 09k T5). A virtual
 * document has no OS path and never fabricates a `FileTypeInfo`; all names
 * and bytes are authorized by the live native session and served as
 * sensitive memory grants. Two views of one entry share one model. */

export const LOCKED_TEXT_HANDLER_ID = "locked.text";
const MAX_EDITABLE = 256 * 1024 * 1024;
const MAX_HANDLE_RANGE = 4 * 1024 * 1024;

interface LockedModel {
  documentId: string;
  sessionId: string;
  containerRevision: number;
  source: Extract<DocumentRef, { kind: "virtual" }>;
  info: DocumentInfo;
  original: Uint8Array | null;
  edited: Uint8Array | null;
  state: DocumentState;
  listeners: Set<(state: DocumentState) => void>;
  context: DocumentControllerContext | null;
  cancelled: boolean;
  refs: number;
}

const models = new Map<string, LockedModel>();
const sessionsByContainer = new Map<string, string>();
const sessionRevisions = new Map<string, number>();

function plainPath(path: string): string {
  return path.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
}

function fnv(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic content identity. This is an identity, not a security
 * hash and not a claim about the bytes. */
export function contentIdOf(bytes: Uint8Array): string {
  const first = fnv(bytes, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = fnv(bytes, 0x9e3779b9).toString(16).padStart(8, "0");
  const third = fnv(bytes, 0x85ebca6b).toString(16).padStart(8, "0");
  const length = (bytes.length >>> 0).toString(16).padStart(7, "0").slice(0, 7);
  const last = `${third.slice(3)}${length}`.slice(0, 12).padEnd(12, "0");
  return `${first}-${second.slice(0, 4)}-4${second.slice(4, 7)}-8${third.slice(0, 3)}-${last}`;
}

function bytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function notify(model: LockedModel): void {
  for (const listener of model.listeners) listener(model.state);
}

function sessionFor(source: { container_path: string }): string {
  const session = sessionsByContainer.get(plainPath(source.container_path));
  if (!session) throw new Error("locked.locked");
  return session;
}

/** A model may only read through the session that created it. A re-unlock
 * at the same path creates a new session and the old view surfaces
 * `locked.changed` until it is reopened; bytes from another session are
 * never served under the old document id. */
function currentSession(model: LockedModel): string {
  const session = sessionsByContainer.get(plainPath(model.source.container_path));
  if (
    !session ||
    session !== model.sessionId ||
    sessionRevision(session) !== model.containerRevision
  ) {
    if (model.state.status_code !== "locked.changed") {
      model.state = { ...model.state, status_code: "locked.changed" };
      notify(model);
    }
    throw new Error("locked.changed");
  }
  return session;
}

export function registerLockedSession(session: LockedSession): void {
  // A locked session has no usable keys: never let it replace the live
  // routing for its path or serve bytes.
  if (session.state === "locked") {
    releaseLockedSessionById(session.session_id);
    return;
  }
  const key = plainPath(session.container_path);
  const previous = sessionsByContainer.get(key);
  // A re-unlock of the same container creates a new native session; models
  // from the old session must never keep serving bytes under the new one.
  if (previous && previous !== session.session_id) releaseLockedSessionById(previous);
  sessionsByContainer.set(key, session.session_id);
  // Host updates can arrive out of order. The native session revision only
  // grows, so a stale snapshot must never move the binding backwards.
  const known = sessionRevisions.get(session.session_id);
  const revision = known === undefined ? session.revision : Math.max(known, session.revision);
  sessionRevisions.set(session.session_id, revision);
  // A revision change means the container index was replaced (recovery).
  // Surface that before the next read instead of serving stale bytes.
  for (const model of models.values()) {
    if (model.sessionId !== session.session_id || model.containerRevision === revision) continue;
    if (model.state.status_code === "locked.changed") continue;
    model.state = { ...model.state, status_code: "locked.changed" };
    notify(model);
  }
}

/** The native session is gone (lock, close, idle lock): drop every path
 * alias and zeroize its models so no decrypted buffer outlives it. */
export function forgetLockedSession(session: LockedSession): void {
  releaseLockedSessionById(session.session_id);
}

function releaseLockedSessionById(sessionId: string): void {
  for (const [documentId, model] of models) {
    if (model.sessionId !== sessionId) continue;
    // Hide the content first: no listener may keep a decrypted buffer alive
    // after the native session is gone.
    model.cancelled = true;
    model.context = null;
    model.listeners.clear();
    model.original?.fill(0);
    model.edited?.fill(0);
    model.original = null;
    model.edited = null;
    models.delete(documentId);
    void releaseSnapshotAuthority(documentId).catch(() => undefined);
  }
  for (const [key, value] of sessionsByContainer) {
    if (value === sessionId) sessionsByContainer.delete(key);
  }
  sessionRevisions.delete(sessionId);
}

/** Lock/close/recovery replaced the native session: zeroize every model and
 * drop the session mapping before the caller reports the lock complete. */
export function releaseLockedSession(session: LockedSession): void {
  releaseLockedSessionById(session.session_id);
}

function sessionRevision(sessionId: string): number {
  return sessionRevisions.get(sessionId) ?? 1;
}

async function loadWhole(model: LockedModel): Promise<Uint8Array> {
  const session = currentSession(model);
  if (model.original) return model.original;
  if (model.info.size > MAX_EDITABLE) throw new Error("locked.too_large");
  const output = new Uint8Array(model.info.size);
  let offset = 0;
  while (offset < output.length) {
    if (model.cancelled) {
      output.fill(0);
      throw new Error("locked.cancelled");
    }
    const length = Math.min(MAX_HANDLE_RANGE, output.length - offset);
    const bytes = await readLockedEntry(session, model.source.entry_id, offset, length);
    if (bytes.length !== length) throw new Error("locked.changed");
    output.set(bytes, offset);
    offset += length;
  }
  model.original = output;
  return output;
}

async function captureModel(
  model: LockedModel,
  capturedRevision: number,
  contentId: string,
): Promise<ExportSnapshot> {
  const state = model.state;
  currentSession(model);
  if (state.revision !== capturedRevision || state.content_id !== contentId) {
    throw new Error("documents.changed");
  }
  const bytes = model.edited ?? (await loadWhole(model));
  if (!model.edited && !model.original) throw new Error("locked.io");
  const begun = await beginExportSnapshot({
    document_id: model.documentId,
    revision: capturedRevision,
    content_id: contentId,
    mime: model.info.mime || "application/octet-stream",
    byte_len: bytes.length,
  });
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.subarray(offset, Math.min(offset + 1024 * 1024, bytes.length));
      await appendExportSnapshot(begun.snapshot_id, begun.upload_token, offset, chunk);
      offset += chunk.length;
    }
    return await finishExportSnapshot(begun.snapshot_id);
  } catch (error) {
    await abortExportSnapshot(begun.snapshot_id).catch(() => undefined);
    throw error;
  }
}

/** Load the original bytes for a text view and give a clean model the
 * identity of those bytes, so Undo back to the original is clean. */
export async function loadLockedOriginal(documentId: string): Promise<Uint8Array> {
  const model = models.get(documentId);
  if (!model || model.cancelled) throw new Error("locked.locked");
  const bytes = await loadWhole(model);
  if (!model.state.dirty && model.edited === null) {
    const id = model.state.saved_content_id === model.documentId
      ? contentIdOf(bytes)
      : model.state.saved_content_id;
    model.state = { ...model.state, content_id: id, saved_content_id: id };
  }
  return bytes;
}

export async function commitLockedBytes(documentId: string, bytes: Uint8Array): Promise<DocumentState> {
  const model = models.get(documentId);
  if (!model || model.cancelled) throw new Error("locked.locked");
  if (bytes.length > MAX_EDITABLE) throw new Error("locked.too_large");
  const session = currentSession(model);
  await loadWhole(model);
  const contentId = bytesEqual(bytes, model.original)
    ? model.state.saved_content_id
    : contentIdOf(bytes);
  model.edited = bytesEqual(bytes, model.original) ? null : bytes.slice();
  if (model.context) {
    model.state = model.context.notifyContentChanged(contentId);
  } else {
    model.state = { ...model.state, content_id: contentId, dirty: contentId !== model.state.saved_content_id };
  }
  await touchLockedSession(session).catch(() => undefined);
  await markLockedDirty(session, model.documentId, model.state.dirty);
  notify(model);
  return model.state;
}

export function lockedModelState(documentId: string): DocumentState | null {
  return models.get(documentId)?.state ?? null;
}

export function lockedOriginalForTests(documentId: string): Uint8Array | null {
  return models.get(documentId)?.original ?? null;
}

class LockedProvider implements DocumentProvider {
  readonly id = "locked" as const;

  supports(ref: DocumentRef): boolean {
    return ref.kind === "virtual" && ref.provider === "locked";
  }

  async open(ref: DocumentRef): Promise<DocumentHandle> {
    if (!this.supports(ref) || ref.kind !== "virtual") throw new Error("documents.provider_missing");
    const session = sessionFor(ref);
    const entry = await lockedEntryInfo(session, ref.entry_id);
    if (entry.kind !== "file") throw new Error("documents.invalid");
    const existing = models.get(entry.id);
    if (existing) {
      if (existing.cancelled) throw new Error("locked.locked");
      if (
        existing.sessionId !== session ||
        existing.containerRevision !== sessionRevision(session) ||
        plainPath(existing.source.container_path) !== plainPath(ref.container_path)
      ) {
        throw new Error("locked.changed");
      }
      existing.refs += 1;
      return this.handleFor(existing);
    }
    const info: DocumentInfo = {
      document_id: entry.id,
      source: ref,
      name: entry.name,
      ext: extensionOf(entry.name),
      mime: entry.mime || "application/octet-stream",
      size: entry.size,
      modified_unix: entry.modified_unix,
      read_only: entry.read_only,
      from_internet: entry.from_internet,
      sensitive: true,
    };
    const state = initialDocumentState(entry.id);
    const model: LockedModel = {
      documentId: entry.id,
      sessionId: session,
      containerRevision: sessionRevision(session),
      source: ref,
      info,
      original: entry.size === 0 ? new Uint8Array(0) : null,
      edited: null,
      state: { ...state, ready: true, can_save_existing: false, can_save_copy: true },
      listeners: new Set(),
      context: null,
      cancelled: false,
      refs: 1,
    };
    models.set(entry.id, model);
    return this.handleFor(model);
  }

  private handleFor(model: LockedModel): DocumentHandle {
    let released = false;
    return {
      id: model.documentId,
      source: model.source,
      info: model.info,
      getState: () => model.state,
      subscribe(listener) {
        model.listeners.add(listener);
        return () => model.listeners.delete(listener);
      },
      readRange: async (offset, length) => {
        if (length > MAX_HANDLE_RANGE) throw new Error("documents.invalid");
        if (model.cancelled) throw new Error("locked.locked");
        return readLockedEntry(currentSession(model), model.source.entry_id, offset, length);
      },
      captureSnapshot: async () => {
        const state = model.state;
        return captureModel(model, state.revision, state.content_id);
      },
      save: async () => {
        throw new Error("locked.save_copy_required");
      },
      saveCopy: async () => {
        throw new Error("locked.unencrypted_copy_required");
      },
      discard: async () => {
        model.edited = null;
        model.state = {
          ...model.state,
          content_id: model.state.saved_content_id,
          dirty: false,
        };
        await markLockedDirty(currentSession(model), model.documentId, false);
        notify(model);
      },
      release: () => {
        if (released) return;
        released = true;
        model.refs -= 1;
        if (model.refs > 0) return;
        model.listeners.clear();
        model.cancelled = true;
        model.original?.fill(0);
        model.edited?.fill(0);
        model.original = null;
        model.edited = null;
        models.delete(model.documentId);
        void releaseSnapshotAuthority(model.documentId).catch(() => undefined);
      },
    };
  }
}

async function controllerFactory(context: DocumentControllerContext): Promise<DocumentControllerBinding> {
  const model = models.get(context.document_id);
  if (!model) throw new Error("documents.provider_missing");
  model.context = context;
  context.notifyReady({ editing_enabled: true, can_save_existing: false, can_save_copy: true });
  return {
    handler_id: LOCKED_TEXT_HANDLER_ID,
    capture: (revision, contentId) => captureModel(model, revision, contentId),
    discardToSaved: async (savedContentId) => {
      model.edited = null;
      model.state = { ...model.state, content_id: savedContentId, dirty: false };
      await markLockedDirty(currentSession(model), model.documentId, false);
      notify(model);
    },
    setEditingEnabled: async (enabled) => {
      context.notifyReady({ editing_enabled: enabled, can_save_existing: false, can_save_copy: true });
    },
    dispose: async () => {
      model.context = null;
    },
  };
}

export type LockedCloseChoice =
  | { choice: "keep" }
  | { choice: "save_copy"; dest_path: string }
  | { choice: "discard" }
  | { choice: "cancel" };

let closeChooser:
  | ((sessionId: string, documents: readonly DocumentHandle[]) => Promise<LockedCloseChoice>)
  | null = null;

export function registerLockedCloseChooser(
  chooser: ((sessionId: string, documents: readonly DocumentHandle[]) => Promise<LockedCloseChoice>) | null,
): void {
  closeChooser = chooser;
}

function modelForHandle(handle: DocumentHandle): LockedModel | null {
  return models.get(handle.id) ?? null;
}

export async function persistLockedSessionModels(sessionId: string): Promise<LockedPersistResult[]> {
  const receipts: LockedPersistResult[] = [];
  for (const model of models.values()) {
    if (model.state.dirty === false) continue;
    if (model.cancelled || model.sessionId !== sessionId) continue;
    if (sessionFor(model.source) !== sessionId) throw new Error("locked.changed");
    const state = model.state;
    const snapshot = await captureModel(model, state.revision, state.content_id);
    let receipt: LockedPersistResult;
    try {
      const result = await persistLockedSnapshot({
        session_id: sessionId,
        entry_id: model.documentId,
        snapshot_id: snapshot.snapshot_id,
        expected_container_revision: sessionRevision(sessionId),
        captured_revision: snapshot.revision,
        content_id: state.content_id,
      });
      receipt = await result.completion;
    } finally {
      // The native pending generation owns its verified bytes now. Stop new
      // leases for this immutable upload even when persistence fails.
      await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    }
    if (!receipt.verified || receipt.content_id !== state.content_id) throw new Error("locked.changed");
    if (model.state.content_id !== state.content_id) throw new Error("locked.changed");
    receipts.push(receipt);
  }
  return receipts;
}

async function lockedClosePolicy(
  documents: readonly DocumentHandle[],
  _reason: DocumentCloseReason,
): Promise<boolean> {
  const dirty = documents.filter((handle) => handle.getState().dirty);
  if (dirty.length === 0) return true;
  const sessions = new Set<string>();
  for (const handle of dirty) {
    const model = modelForHandle(handle);
    if (!model) return false;
    sessions.add(model.sessionId);
  }
  // One close plan may span several containers, but a locked decision
  // (receipts, discard) is only safe for one live session at a time.
  if (sessions.size !== 1) return false;
  const sessionId = [...sessions][0];
  if (!closeChooser) return false;
  const decision = await closeChooser(sessionId, dirty);
  if (decision.choice === "cancel") return false;
  if (decision.choice === "discard") {
    try {
      for (const handle of dirty) await handle.discard();
    } catch {
      return false;
    }
    return true;
  }
  const receipts = await persistLockedSessionModels(sessionId);
  if (receipts.length === 0) return false;
  for (const handle of dirty) {
    const current = handle.getState();
    if (!receipts.some((receipt) => receipt.entry_id === handle.id && receipt.content_id === current.content_id)) {
      return false;
    }
  }
  if (decision.choice === "keep") return true;
  const expectedRevision = sessionRevision(sessionId);
  const job = await saveLockedCopy({
    session_id: sessionId,
    dest_path: decision.dest_path,
    expected_revision: expectedRevision,
  });
  await job.completion;
  // A copy never marks the original clean; the pending receipts remain.
  return true;
}

let registered = false;

/** Static registration only. The app host calls this once at startup. */
export function registerLockedDocumentProvider(
  registry: { register(provider: DocumentProvider): void } = DocumentRegistry,
): void {
  if (registered) return;
  registered = true;
  registry.register(new LockedProvider());
  registerDocumentControllerFactory(LOCKED_TEXT_HANDLER_ID, controllerFactory);
  registerDocumentClosePolicy("locked", { prepareClose: lockedClosePolicy });
  registerLockedModelPersister(persistLockedSessionModels);
}

export function __resetLockedProviderForTests(): void {
  for (const model of models.values()) {
    model.original?.fill(0);
    model.edited?.fill(0);
  }
  models.clear();
  sessionsByContainer.clear();
  sessionRevisions.clear();
  closeChooser = null;
  registered = false;
}

export async function chooseRecoveryForTests(
  sessionId: string,
  recoveryId: string,
  action: LockedRecoveryAction,
) {
  return chooseLockedRecovery(sessionId, recoveryId, action);
}

export async function recoveryItemsForTests(sessionId: string) {
  return listLockedRecovery(sessionId);
}

export function isLockedEntry(entry: LockedEntry): boolean {
  return entry.kind === "file" || entry.kind === "folder";
}
