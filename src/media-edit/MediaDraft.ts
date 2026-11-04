import type { DocumentHandle, DocumentInfo, DocumentState } from "../documents/types";
import { initialDocumentState } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { authorizeNewSnapshot, uploadSnapshot } from "../services/exportSnapshots";
import { pickSavePath, saveText } from "../services/textFiles";
import { recipeDocumentName } from "./recipeCodec";
import type { MediaRecipe } from "./types";
import {
  MEDIA_EDIT_MIME,
  mediaRecipeBytes,
  mediaRecipeJson,
  validateMediaRecipe,
} from "./types";
import type { MediaEditController } from "./MediaDocument";

/**
 * The in-memory recipe document behind "Edit media" (Step 15 `D1`).
 *
 * The source media file is never modified. The draft holds only the
 * documented recipe bytes and is captured through the 08a new-document
 * authority, so its own document id never claims a native grant it does not
 * have. Saving writes a new `.admedia` file through the safe create/replace
 * text path; the referenced media stays the original file.
 */

/** Largest read served by a draft handle (same bound as 09a). */
const MAX_DRAFT_READ = 4 * 1024 * 1024;

export interface MediaDraftSaveLabels {
  /** Title of the Save dialog and the Save recipe command. */
  saveTitle: string;
  /** Filter label; the file name already carries `.admedia`. */
  filterName: string;
}

interface DraftEntry {
  info: DocumentInfo;
  state: DocumentState;
  currentRecipe: MediaRecipe;
  listeners: Set<(state: DocumentState) => void>;
  labels: MediaDraftSaveLabels;
  savedPath: string | null;
  savedSize: number | null;
  savedModifiedUnix: number | null;
  controllerUnsubscribe: (() => void) | null;
  released: boolean;
}

const drafts = new Map<string, DraftEntry>();

function emit(entry: DraftEntry): void {
  for (const listener of [...entry.listeners]) listener(entry.state);
}

function entryOf(document: DocumentHandle): DraftEntry | null {
  const entry = drafts.get(document.id);
  return entry && !entry.released ? entry : null;
}

function recipeBytes(entry: DraftEntry): Uint8Array {
  return mediaRecipeBytes(entry.currentRecipe);
}

/** Captures the current recipe through a brand-new 08a authority; the
 * draft's own id is never presented as a granted document. */
async function captureDraft(entry: DraftEntry): Promise<ExportSnapshot> {
  const state = entry.state;
  const bytes = recipeBytes(entry);
  const authority = await authorizeNewSnapshot(entry.info.name, MEDIA_EDIT_MIME);
  if (authority.mime !== MEDIA_EDIT_MIME) throw new Error("media_edit.unsupported");
  const snapshot = await uploadSnapshot(
    {
      document_id: authority.document_id,
      revision: state.revision,
      content_id: state.content_id,
      mime: MEDIA_EDIT_MIME,
      byte_len: bytes.byteLength,
    },
    bytes,
  );
  if (
    snapshot.mime !== MEDIA_EDIT_MIME ||
    snapshot.revision !== state.revision ||
    snapshot.content_id !== state.content_id ||
    snapshot.byte_len !== bytes.byteLength
  ) {
    throw new Error("media_edit.changed");
  }
  return snapshot;
}

/** Writes the current recipe bytes to a user-chosen `.admedia` file. The
 * first save creates a new file; later saves replace that exact file with
 * the last written size/time as the only expected state. */
export async function saveMediaDraftRecipe(document: DocumentHandle): Promise<boolean> {
  const entry = entryOf(document);
  if (!entry) return false;
  if (!entry.state.dirty && entry.savedPath !== null) return true;
  const recipe = entry.currentRecipe;
  let path = entry.savedPath;
  let mode: "save" | "saveAs" = "save";
  let expectedModified = entry.savedModifiedUnix;
  let expectedSize = entry.savedSize;
  if (path === null) {
    path = await pickSavePath(entry.labels.saveTitle, entry.info.name, entry.labels.filterName);
    if (path === null) return false;
    mode = "saveAs";
    expectedModified = null;
    expectedSize = null;
  }
  const saved = await saveText({
    path,
    text: mediaRecipeJson(recipe),
    encoding: "utf-8",
    table: null,
    mode,
    expected_modified_unix: expectedModified,
    expected_size: expectedSize,
    force: false,
  });
  if (saved.path.toLowerCase() !== path.toLowerCase()) throw new Error("textSave.write_failed");
  entry.savedPath = saved.path;
  entry.savedSize = saved.size;
  entry.savedModifiedUnix = saved.modified_unix;
  entry.state = {
    ...entry.state,
    saved_revision: entry.state.revision,
    saved_content_id: recipe.content_id,
    dirty: false,
  };
  emit(entry);
  return true;
}

/** Keeps the draft's shared state in step with the one editor controller.
 * Returns a no-op for a document that is not an in-memory draft. */
export function bindMediaDraftController(
  document: DocumentHandle,
  controller: MediaEditController,
): () => void {
  const entry = entryOf(document);
  if (!entry) return () => undefined;
  entry.controllerUnsubscribe?.();
  const sync = () => {
    const recipe = controller.getRecipe();
    entry.currentRecipe = recipe as MediaRecipe;
    entry.state = {
      ...entry.state,
      revision: controller.getRevision(),
      content_id: recipe.content_id,
      dirty: recipe.content_id !== entry.state.saved_content_id,
    };
    emit(entry);
  };
  sync();
  entry.controllerUnsubscribe = controller.subscribe(sync);
  return () => {
    entry.controllerUnsubscribe?.();
    entry.controllerUnsubscribe = null;
  };
}

/** Creates the draft document for one media file and returns the runtime
 * tab facts. Nothing is written to disk until the user saves the recipe. */
export function createMediaRecipeDraft(
  recipe: MediaRecipe,
  mediaName: string,
  labels: MediaDraftSaveLabels,
): { document: DocumentHandle; title: string } {
  const checked = validateMediaRecipe(recipe);
  const documentId = crypto.randomUUID();
  const name = recipeDocumentName(mediaName);
  const state: DocumentState = {
    ...initialDocumentState(checked.content_id),
    ready: true,
    editing_enabled: true,
    can_save_existing: false,
    can_save_copy: false,
  };
  const info: DocumentInfo = {
    document_id: documentId,
    source: { kind: "draft", draft_id: documentId },
    name,
    ext: "admedia",
    mime: MEDIA_EDIT_MIME,
    size: mediaRecipeBytes(checked).byteLength,
    modified_unix: 0,
    read_only: false,
    from_internet: false,
    sensitive: false,
  };
  let released = false;
  const entry: DraftEntry = {
    info,
    state,
    currentRecipe: checked,
    listeners: new Set(),
    labels,
    savedPath: null,
    savedSize: null,
    savedModifiedUnix: null,
    controllerUnsubscribe: null,
    released: false,
  };
  const document: DocumentHandle = {
    id: documentId,
    source: info.source,
    info,
    getState: () => entry.state,
    subscribe(listener) {
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    readRange: async (offset, length) => {
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("documents.invalid");
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DRAFT_READ) {
        throw new Error("documents.invalid");
      }
      const bytes = recipeBytes(entry);
      return bytes.slice(offset, Math.min(bytes.byteLength, offset + length));
    },
    captureSnapshot: () => captureDraft(entry),
    save: () => saveMediaDraftRecipe(document),
    saveCopy: async () => false,
    discard: async () => {
      entry.state = { ...entry.state, content_id: entry.state.saved_content_id, dirty: false };
      emit(entry);
    },
    release: () => {
      if (released) return;
      released = true;
      entry.released = true;
      entry.controllerUnsubscribe?.();
      entry.controllerUnsubscribe = null;
      entry.listeners.clear();
      drafts.delete(documentId);
    },
  };
  drafts.set(documentId, entry);
  return { document, title: name };
}

export function __resetMediaDraftsForTests(): void {
  for (const entry of drafts.values()) {
    entry.released = true;
    entry.controllerUnsubscribe?.();
    entry.listeners.clear();
  }
  drafts.clear();
}
