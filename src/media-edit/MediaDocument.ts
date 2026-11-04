import type { DocumentControllerBinding, DocumentControllerContext } from "../documents/controller";
import { documentControllerFactory, registerDocumentControllerFactory } from "../documents/controller";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import { isTauriRuntime } from "../services/settings";
import type { DocumentHandle } from "../documents/types";
import type {
  ExportSnapshot,
  SnapshotBeginRequest,
} from "../services/exportSnapshots";
import {
  appendExportSnapshot,
  authorizeNewSnapshot,
  beginExportSnapshot,
  finishExportSnapshot,
  releaseExportSnapshot,
} from "../services/exportSnapshots";
import type { MediaEditOperation, MediaRecipe } from "./types";
import {
  MEDIA_EDIT_MIME,
  MAX_MEDIA_HISTORY,
  MAX_MEDIA_RECIPE_BYTES,
  cloneMediaRecipe,
  decodeMediaRecipe,
  freezeMediaRecipe,
  mediaEditFail,
  mediaRecipeBytes,
  newMediaId,
  validateMediaRecipe,
} from "./types";
import { applyMediaEditOperation } from "./operations";
import { mediaRecipeDurationUs } from "./timing";

/**
 * The recipe document controller (`E1`/`E2`, `D1`).
 *
 * A recipe is owned by one document and shared by every view of it. Applying
 * one operation swaps the whole immutable recipe; a refused operation leaves
 * the previous recipe, history and content id exactly as they were. Capture
 * freezes the requested revision/content id before the first await and
 * verifies the same tuple in the finished 08a snapshot, so a later edit can
 * never relabel old recipe bytes as a newer revision.
 */

/** The handler id shared with the media-recipe handler and 09a. */
export const MEDIA_RECIPE_HANDLER_ID = "media-recipe";

/** Largest single read accepted by the 09a document handle. */
const DOCUMENT_READ_CHUNK = 4 * 1024 * 1024;
/** Largest upload chunk accepted by 08a. */
const SNAPSHOT_CHUNK = 1024 * 1024;
/** Exported for the 09a factory bridge and tests. */
export interface MediaEditorHooks {
  /** Called once after every committed transaction, including Undo/Redo. */
  onContentChanged?: (contentId: string, revision: number) => void;
  /** Called when the controller can accept its first transaction. */
  onReady?: () => void;
}

export interface MediaEditController {
  getRecipe: () => Readonly<MediaRecipe>;
  subscribe: (listener: (recipe: Readonly<MediaRecipe>) => void) => () => void;
  apply: (operation: MediaEditOperation) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  capture: (capturedRevision: number, contentId: string) => Promise<ExportSnapshot>;
  /**
   * Captures the same immutable recipe for a 15 export job. It uses the 08a
   * new-document authority because an export only needs those bytes; the
   * document-bound `capture` above is the one Save Copy must use.
   */
  captureForExport: (capturedRevision: number, contentId: string) => Promise<ExportSnapshot>;
  /** Restores the last saved bytes without keeping any newer edit. */
  discardToSaved: (savedId: string) => Promise<void>;
  /** 09a editing switch; a read-only recipe refuses every transaction. */
  setEditingEnabled: (enabled: boolean) => void;
  release: () => void;
  /** Additive read helper: true when the model differs from its saved id. */
  isDirty: () => boolean;
  /** Additive read helper: monotonically growing edit revision. */
  getRevision: () => number;
  /** Additive read helpers for the ribbon's Undo/Redo state. */
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface Entry {
  controller: MediaEditController;
  documentId: string;
  /** Views plus the 09a binding hold one reference each. */
  references: number;
  /** Extra 09a document references acquired by `acquireMediaEditor`. */
  registryRefs: number;
}

const entries = new Map<string, Entry>();

async function readOriginalBytes(document: DocumentHandle): Promise<Uint8Array> {
  if (document.info.size > MAX_MEDIA_RECIPE_BYTES) mediaEditFail("media_edit.too_large");
  const length = document.info.size;
  if (length <= 0) mediaEditFail("media_edit.bad_request");
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < length) {
    const wanted = Math.min(DOCUMENT_READ_CHUNK, length - offset);
    const chunk = await document.readRange(offset, wanted);
    if (chunk.byteLength === 0) break;
    chunks.push(chunk);
    offset += chunk.byteLength;
    if (chunks.length > MAX_MEDIA_RECIPE_BYTES / DOCUMENT_READ_CHUNK + 1) mediaEditFail("media_edit.too_large");
  }
  if (offset === 0 || offset > MAX_MEDIA_RECIPE_BYTES) mediaEditFail("media_edit.too_large");
  const bytes = new Uint8Array(offset);
  let write = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, write);
    write += chunk.byteLength;
  }
  return bytes;
}

async function recipeForDocument(document: DocumentHandle): Promise<MediaRecipe> {
  const isRecipeDocument =
    document.info.ext.toLowerCase() === "admedia" || document.info.mime === MEDIA_EDIT_MIME;
  // Only a recipe document may own a recipe controller. A media document
  // stays an ordinary player: attaching a recipe to it would let Save write
  // recipe bytes over the user's video (`D1`, R-SAFE-1). The coordinator
  // creates a separate recipe document for "Edit media".
  if (!isRecipeDocument) mediaEditFail("media_edit.unsupported");
  const bytes = await readOriginalBytes(document);
  const recipe = decodeMediaRecipe(bytes);
  // The document is the authority for the live content identity.
  return validateMediaRecipe({ ...recipe, content_id: document.getState().content_id });
}

function verifySnapshot(
  snapshot: ExportSnapshot,
  documentId: string,
  revision: number,
  contentId: string,
  byteLength: number,
): void {
  if (
    snapshot.document_id !== documentId ||
    snapshot.revision !== revision ||
    snapshot.content_id !== contentId ||
    snapshot.mime !== MEDIA_EDIT_MIME ||
    snapshot.byte_len !== byteLength
  ) {
    mediaEditFail("media_edit.changed");
  }
}

async function appendAndFinish(
  metadata: SnapshotBeginRequest,
  bytes: Uint8Array,
): Promise<ExportSnapshot> {
  const started = await beginExportSnapshot(metadata);
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + SNAPSHOT_CHUNK));
      await appendExportSnapshot(started.snapshot_id, started.upload_token, offset, chunk);
      offset += chunk.byteLength;
    }
    return await finishExportSnapshot(started.snapshot_id);
  } catch (error) {
    await releaseExportSnapshot(started.snapshot_id).catch(() => undefined);
    throw error;
  }
}

/** Capture through a brand-new 08a authority (export and standalone tests). */
async function captureWithNewAuthority(
  frozen: MediaRecipe,
  revision: number,
  contentId: string,
): Promise<ExportSnapshot> {
  const bytes = mediaRecipeBytes(frozen);
  const authority = await authorizeNewSnapshot(
    frozen.project_id.length > 0 ? `${frozen.project_id}.admedia` : "media.admedia",
    MEDIA_EDIT_MIME,
  );
  // The native authority decides whether this MIME is encodable; a provider
  // that omits it must fail rather than mislabel the recipe.
  if (authority.mime !== MEDIA_EDIT_MIME) mediaEditFail("media_edit.unsupported");
  const snapshot = await appendAndFinish(
    {
      document_id: authority.document_id,
      revision,
      content_id: contentId,
      mime: MEDIA_EDIT_MIME,
      byte_len: bytes.byteLength,
    },
    bytes,
  );
  verifySnapshot(snapshot, authority.document_id, revision, contentId, bytes.byteLength);
  return snapshot;
}

/** Capture for the live document/Save Copy; the document id must match. */
async function captureForLiveDocument(
  documentId: string,
  frozen: MediaRecipe,
  revision: number,
  contentId: string,
): Promise<ExportSnapshot> {
  const bytes = mediaRecipeBytes(frozen);
  const snapshot = await appendAndFinish(
    {
      document_id: documentId,
      revision,
      content_id: contentId,
      mime: MEDIA_EDIT_MIME,
      byte_len: bytes.byteLength,
    },
    bytes,
  );
  verifySnapshot(snapshot, documentId, revision, contentId, bytes.byteLength);
  return snapshot;
}

export interface MediaControllerOptions {
  /** The live 09a document whose authority may capture `capture`. */
  documentId?: string;
  /** True for the 09a binding: `capture` uses that document id, never a new one. */
  strictCapture?: boolean;
  /** False for a document the registry opened read-only. */
  initialEditable?: boolean;
}

/** Creates a controller around an already validated recipe (tests, 19a). */
export function createMediaEditorController(
  initial: MediaRecipe,
  hooks: MediaEditorHooks = {},
  registryKey?: string,
  initialRevision = 1,
  options: MediaControllerOptions = {},
): MediaEditController {
  let recipe = freezeMediaRecipe(validateMediaRecipe(initial));
  let revision = Number.isSafeInteger(initialRevision) && initialRevision >= 1 ? initialRevision : 1;
  let savedContentId = recipe.content_id;
  const history: MediaRecipe[] = [cloneMediaRecipe(recipe)];
  let index = 0;
  let released = false;
  let editingEnabled = options.initialEditable !== false;
  const listeners = new Set<(next: Readonly<MediaRecipe>) => void>();
  const documentId = registryKey ?? recipe.project_id;

  const notify = () => {
    const current = recipe;
    for (const listener of [...listeners]) listener(current);
  };

  const assertWritable = () => {
    if (released || !editingEnabled) mediaEditFail("media_edit.read_only");
  };

  const commit = (next: MediaRecipe) => {
    assertWritable();
    const checked = validateMediaRecipe({ ...next, project_id: recipe.project_id, content_id: newMediaId() });
    recipe = freezeMediaRecipe(checked);
    revision += 1;
    history.splice(index + 1);
    history.push(cloneMediaRecipe(recipe));
    index = history.length - 1;
    if (history.length > MAX_MEDIA_HISTORY) {
      history.shift();
      index -= 1;
    }
    notify();
    hooks.onContentChanged?.(recipe.content_id, revision);
  };

  const releaseRegistryRefs = (entry: Entry) => {
    const count = entry.registryRefs;
    entry.registryRefs = 0;
    for (let acquired = 0; acquired < count; acquired += 1) {
      DocumentRegistry.release(entry.documentId);
    }
  };

  const finalize = () => {
    if (released) return;
    released = true;
    listeners.clear();
    const entry = entries.get(documentId);
    if (!entry || entry.controller !== controller) return;
    entry.references = 0;
    entries.delete(documentId);
    releaseRegistryRefs(entry);
  };

  const controller: MediaEditController = {
    getRecipe: () => recipe,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply: async (operation) => {
      // Validation and the whole swap happen in one synchronous transaction.
      commit(applyMediaEditOperation(recipe, operation));
    },
    undo: async () => {
      assertWritable();
      if (index <= 0) return;
      index -= 1;
      recipe = freezeMediaRecipe(cloneMediaRecipe(history[index]));
      revision += 1;
      notify();
      hooks.onContentChanged?.(recipe.content_id, revision);
    },
    redo: async () => {
      assertWritable();
      if (index >= history.length - 1) return;
      index += 1;
      recipe = freezeMediaRecipe(cloneMediaRecipe(history[index]));
      revision += 1;
      notify();
      hooks.onContentChanged?.(recipe.content_id, revision);
    },
    capture: async (capturedRevision, contentId) => {
      // Freeze the tuple and the recipe before any await.
      const frozen = cloneMediaRecipe(recipe);
      if (revision !== capturedRevision || recipe.content_id !== contentId) {
        mediaEditFail("media_edit.changed");
      }
      if (options.strictCapture && options.documentId) {
        return captureForLiveDocument(options.documentId, frozen, capturedRevision, contentId);
      }
      return captureWithNewAuthority(frozen, capturedRevision, contentId);
    },
    captureForExport: async (capturedRevision, contentId) => {
      const frozen = cloneMediaRecipe(recipe);
      if (revision !== capturedRevision || recipe.content_id !== contentId) {
        mediaEditFail("media_edit.changed");
      }
      return captureWithNewAuthority(frozen, capturedRevision, contentId);
    },
    discardToSaved: async (savedId) => {
      assertWritable();
      const handle = DocumentRegistry.get(documentId);
      if (!handle) mediaEditFail("media_edit.read_only");
      const bytes = await readOriginalBytes(handle);
      const saved = validateMediaRecipe({ ...decodeMediaRecipe(bytes), content_id: savedId });
      const frozen = freezeMediaRecipe(saved);
      recipe = frozen;
      savedContentId = frozen.content_id;
      history.splice(0, history.length, cloneMediaRecipe(frozen));
      index = 0;
      notify();
    },
    setEditingEnabled: (enabled) => {
      editingEnabled = enabled;
    },
    release: () => {
      if (released) return;
      const entry = entries.get(documentId);
      if (!entry || entry.controller !== controller) {
        finalize();
        return;
      }
      // The binding owns the first reference and releases it through
      // `dispose`; each view owns one more. A view closing must never
      // release the controller another view is still using.
      entry.references -= 1;
      if (entry.references > 0) {
        // With no view left, the extra registry handle `acquireEditor`
        // added is no longer needed. Releasing it here lets the document's
        // own last reference dispose the binding normally.
        if (entry.references === 1) releaseRegistryRefs(entry);
        return;
      }
      finalize();
    },
    isDirty: () => recipe.content_id !== savedContentId,
    getRevision: () => revision,
    canUndo: () => index > 0,
    canRedo: () => index < history.length - 1,
  };
  hooks.onReady?.();
  return controller;
}

/** Creates the 09a binding controller for one open recipe document. */
async function createBoundController(
  document: DocumentHandle,
  context: DocumentControllerContext,
): Promise<MediaEditController> {
  const existing = entries.get(document.id);
  if (existing) {
    // The binding takes its own reference even when a standalone view
    // created the controller first.
    existing.references += 1;
    const readOnly =
      document.info.read_only === true || document.getState().read_only_reason != null;
    context.notifyReady({
      editing_enabled: !readOnly,
      can_save_existing: !readOnly,
      can_save_copy: true,
    });
    return existing.controller;
  }
  const initial = await recipeForDocument(document);
  const controller = createMediaEditorController(
    initial,
    {
      onContentChanged: (contentId) => {
        context.notifyContentChanged(contentId);
      },
      onReady: () => {
        const readOnly =
          document.info.read_only === true || document.getState().read_only_reason != null;
        context.notifyReady({
          editing_enabled: !readOnly,
          can_save_existing: !readOnly,
          can_save_copy: true,
        });
      },
    },
    document.id,
    document.getState().revision,
    {
      documentId: document.id,
      strictCapture: true,
      initialEditable:
        document.info.read_only !== true && document.getState().read_only_reason == null,
    },
  );
  entries.set(document.id, {
    controller,
    documentId: document.id,
    references: 1,
    registryRefs: 0,
  });
  return controller;
}

function installDocumentFactory(): void {
  if (documentControllerFactory(MEDIA_RECIPE_HANDLER_ID)) return;
  registerDocumentControllerFactory(MEDIA_RECIPE_HANDLER_ID, async (context) => {
    const document = DocumentRegistry.get(context.document_id);
    const isRecipe =
      document !== null &&
      (document.info.ext.toLowerCase() === "admedia" || document.info.mime === MEDIA_EDIT_MIME);
    if (!document || !isRecipe) {
      // A media file stays an ordinary player; a recipe has its own document.
      throw new Error("media_edit.unsupported");
    }
    const controller = await createBoundController(document, context);
    const binding: DocumentControllerBinding = {
      handler_id: MEDIA_RECIPE_HANDLER_ID,
      capture: (revision, contentId) => controller.capture(revision, contentId),
      discardToSaved: (savedContentId) => controller.discardToSaved(savedContentId),
      setEditingEnabled: async (enabled) => {
        const readOnly =
          document.info.read_only === true || document.getState().read_only_reason != null;
        const editable = enabled && !readOnly;
        controller.setEditingEnabled(editable);
        context.notifyReady({
          editing_enabled: editable,
          can_save_existing: editable,
          can_save_copy: true,
        });
      },
      dispose: async () => controller.release(),
    };
    return binding;
  });
}

/**
 * Registers the recipe document controller at startup with the handler, so
 * FileTabView can acquire the editable document before the lazy editor loads.
 * Idempotent; a test that clears the controller registry can install again.
 */
export function installMediaRecipeController(): void {
  installDocumentFactory();
}

/**
 * Acquires the one controller for a document (`E1`). A second view receives
 * the same object, so both views always see the same transaction.
 */
export async function acquireMediaEditor(
  document: DocumentHandle,
  hooks: MediaEditorHooks = {},
): Promise<MediaEditController> {
  const existing = entries.get(document.id);
  if (existing) {
    existing.references += 1;
    return existing.controller;
  }
  installDocumentFactory();
  if (isTauriRuntime()) {
    try {
      const editor = await DocumentRegistry.acquireEditor(document.source, MEDIA_RECIPE_HANDLER_ID);
      const bound = entries.get(editor.id);
      if (bound) {
        bound.references += 1;
        bound.registryRefs += 1;
        return bound.controller;
      }
      DocumentRegistry.release(editor.id);
    } catch {
      // A handle that is not a registered recipe document (tests, 19a import)
      // gets the standalone controller below. It can export but not save.
    }
  }
  const recipe = await recipeForDocument(document);
  const state = document.getState();
  const controller = createMediaEditorController(recipe, hooks, document.id, state.revision, {
    initialEditable: document.info.read_only !== true && state.read_only_reason == null,
  });
  entries.set(document.id, {
    controller,
    documentId: document.id,
    references: 1,
    registryRefs: 0,
  });
  return controller;
}

/** The total playable duration of a controller's recipe. */
export function controllerDurationUs(controller: MediaEditController): number {
  return mediaRecipeDurationUs(controller.getRecipe());
}
