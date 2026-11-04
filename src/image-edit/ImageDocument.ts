import type { DocumentControllerBinding, DocumentControllerContext } from "../documents/controller";
import type { DocumentHandle } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { applyStrokeToLayer } from "./brush";
import { disposeCompositeWorker } from "./composite";
import { captureEncodedSnapshot } from "./encode";
import type { Guide } from "./guides";
import { validateLayerModel } from "./layerTypes";
import { disposeImageMetadata } from "./metadata";
import { encodeImageProject, forgetProjectExtensions } from "./projectCodec";
import { PROJECT_MIME } from "./projectTypes";
import { createDefaultAdjustments, createDefaultGeometry, newUuid, registerImageModelValidator, sourceSizeOf, validateModel, validateOperation, type ImageController, type ImageModel, type ImageOperation } from "./types";
import { addOverlay, removeOverlay, updateOverlay } from "./overlays";
import { ImageHistory } from "./history";
import { imageEditorRuntimeSettings } from "./editorSettings";
import { getImageTileStore, disposeImageTileStore, publishCanvasTiles, type ImageTileStore } from "./tiles";
import { disposeRenderWorker } from "./render";

registerImageModelValidator(validateLayerModel);

/** E1/E2: one document-owned controller and one tile store per image
 * document (D1/D2). Decoding happens once; views subscribe to the same
 * immutable model. */

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export type ImageSourceDecoder = (document: DocumentHandle) => Promise<DecodedImage>;

const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const READ_CHUNK = 4 * 1024 * 1024;

/** The default decoder uses the WebView's bounded image decoder on the
 * document's authorized original bytes. It never writes a temporary path and
 * applies EXIF orientation once. Tests register a synthetic decoder. */
export const decodeDocumentSource: ImageSourceDecoder = async (document) => {
  // SVG is markup, not raster data. The read-only image viewer keeps its
  // sandboxed handling; the editor never hands SVG bytes to a canvas decode.
  if (document.info.ext.toLowerCase() === "svg") throw new Error("image_edit.bad_request");
  const size = document.info.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES) throw new Error("image_edit.too_large");
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < size; offset += READ_CHUNK) {
    const length = Math.min(READ_CHUNK, size - offset);
    const part = await document.readRange(offset, length);
    if (!(part instanceof Uint8Array) || part.byteLength !== length) throw new Error("image_edit.bad_request");
    parts.push(part);
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    bytes.set(part, cursor);
    cursor += part.byteLength;
  }
  const blob = new Blob([bytes], { type: document.info.mime || "application/octet-stream" });
  if (typeof createImageBitmap !== "function") throw new Error("image_edit.failed");
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("image_edit.bad_request");
    if (bitmap.width > 32768 || bitmap.height > 32768 || bitmap.width * bitmap.height > 100_000_000) {
      throw new Error("image_edit.too_large");
    }
    const Offscreen = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
    let rgba: Uint8Array;
    if (Offscreen) {
      const canvas = new Offscreen(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error("image_edit.failed");
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
      rgba = new Uint8Array(data.data.buffer.slice(0));
    } else {
      if (typeof document === "undefined") throw new Error("image_edit.failed");
      const canvas = window.document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("image_edit.failed");
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
      rgba = new Uint8Array(data.data.buffer.slice(0));
    }
    return { width: bitmap.width, height: bitmap.height, rgba };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
};

let sourceDecoder: ImageSourceDecoder = decodeDocumentSource;

/** Applies the schema-48 image-editor settings; values are clamped in
 * `editorSettings.ts`, the same module the settings service uses. */
export { configureImageEditorSettings } from "./editorSettings";

export function imageEditorDefaults(): { default_mode: "edit" | "draw"; background_rgba: [number, number, number, number] } {
  const settings = imageEditorRuntimeSettings();
  return {
    default_mode: settings.default_mode,
    background_rgba: [
      settings.background_rgba[0],
      settings.background_rgba[1],
      settings.background_rgba[2],
      settings.background_rgba[3],
    ],
  };
}

/** A trusted app registration; returns the previous decoder. */
export function registerImageSourceDecoder(decoder: ImageSourceDecoder): ImageSourceDecoder {
  const previous = sourceDecoder;
  sourceDecoder = decoder;
  return previous;
}

interface Entry {
  document: DocumentHandle;
  documentId: string;
  refs: number;
  controller: ImageControllerImpl;
}

const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<Entry>>();

interface ImageProjectSettings {
  guides: readonly Guide[];
  dpi: number;
}

const projectSettings = new Map<string, ImageProjectSettings>();

/** Runtime-only project view settings; no paths or tile bytes are retained. */
export function setImageProjectSettings(documentId: string, settings: ImageProjectSettings): void {
  if (typeof documentId !== "string" || documentId.length === 0) return;
  projectSettings.set(documentId, {
    guides: settings.guides.map((guide) => ({ ...guide })),
    dpi: settings.dpi,
  });
}

export function clearImageProjectSettings(documentId: string): void {
  projectSettings.delete(documentId);
}

/** The immutable current model for trusted document-id-only consumers. */
export function getImageEditorModel(documentId: string): Readonly<ImageModel> | null {
  if (typeof documentId !== "string" || documentId.length === 0) return null;
  const entry = entries.get(documentId);
  return entry ? entry.controller.getModel() : null;
}

class ImageControllerImpl implements ImageController {
  readonly documentId: string;
  private readonly document: DocumentHandle;
  private readonly store: ImageTileStore;
  private readonly history: ImageHistory;
  private readonly listeners = new Set<(model: Readonly<ImageModel>) => void>();
  private modelValue: Readonly<ImageModel>;
  private editingEnabled: boolean;
  private revisionValue: number;
  private queue: Promise<void> = Promise.resolve();
  private viewRefs = 1;
  private disposed = false;
  private contentListener: ((contentId: string) => void) | null = null;

  constructor(document: DocumentHandle, store: ImageTileStore, model: ImageModel, revision: number, editingEnabled: boolean) {
    this.document = document;
    this.documentId = model.document_id;
    this.store = store;
    this.modelValue = model;
    this.history = new ImageHistory(model, imageEditorRuntimeSettings().history_limit_mb * 1024 * 1024);
    this.revisionValue = revision;
    this.editingEnabled = editingEnabled;
  }

  get revision(): number {
    return this.revisionValue;
  }

  getModel(): Readonly<ImageModel> {
    return this.modelValue;
  }

  subscribe(listener: (model: Readonly<ImageModel>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addRef(): void {
    if (this.disposed) throw new Error("image_edit.failed");
    this.viewRefs += 1;
  }

  setContentListener(listener: ((contentId: string) => void) | null): void {
    this.contentListener = listener;
  }

  setEditingEnabled(enabled: boolean): void {
    this.editingEnabled = enabled === true;
  }

  isEditingEnabled(): boolean {
    return this.editingEnabled;
  }

  async apply(operation: ImageOperation): Promise<void> {
    this.assertWritable();
    return this.enqueue(async () => {
      try {
        validateOperation(this.modelValue, operation);
        const changedBytes = await this.buildNext(operation);
        if (changedBytes === null) return;
      } catch (error) {
        this.store.releaseUnreferenced(this.history.retainedTileIds());
        throw error;
      }
    });
  }

  async undo(): Promise<void> {
    this.assertWritable();
    return this.enqueue(async () => {
      const next = this.history.undo();
      if (!next) return;
      this.modelValue = next;
      this.revisionValue += 1;
      this.store.releaseUnreferenced(this.history.retainedTileIds());
      this.notify();
    });
  }

  async redo(): Promise<void> {
    this.assertWritable();
    return this.enqueue(async () => {
      const next = this.history.redo();
      if (!next) return;
      this.modelValue = next;
      this.revisionValue += 1;
      this.store.releaseUnreferenced(this.history.retainedTileIds());
      this.notify();
    });
  }

  async capture(revision: number, contentId: string): Promise<ExportSnapshot> {
    if (this.disposed) throw new Error("image_edit.failed");
    if (revision !== this.revisionValue || contentId !== this.modelValue.content_id) throw new Error("image_edit.changed");
    if (this.document.info.mime === PROJECT_MIME) {
      const settings = projectSettings.get(this.documentId) ?? { guides: [], dpi: 96 };
      return encodeImageProject(this.modelValue, revision, settings.guides, settings.dpi);
    }
    return captureEncodedSnapshot(this.document, this.modelValue, revision, contentId);
  }

  release(): void {
    if (this.disposed) return;
    this.viewRefs -= 1;
    const entry = entries.get(this.documentId);
    if (entry && entry.controller === this) entry.refs = this.viewRefs;
    if (this.viewRefs > 0) return;
    this.disposed = true;
    if (!entry || entry.controller !== this) return;
    entries.delete(this.documentId);
    clearImageProjectSettings(this.documentId);
    disposeRenderWorker(this.documentId);
    disposeCompositeWorker(this.documentId);
    disposeImageTileStore(this.documentId);
  }

  /** Trusted E6 path; the callback never crosses IPC. */
  async commitTransform(
    expectedContentId: string,
    transform: (current: Readonly<ImageModel>) => ImageModel,
    changedBytes = 0,
  ): Promise<void> {
    this.assertWritable();
    return this.enqueue(async () => {
      if (this.modelValue.content_id !== expectedContentId) throw new Error("image_edit.changed");
      const result = transform(this.modelValue);
      if (!result || result.document_id !== this.modelValue.document_id) throw new Error("image_edit.bad_request");
      const next: ImageModel = { ...result, content_id: newUuid() };
      try {
        validateLayerModel(next);
        await this.commit(next, changedBytes);
      } catch (error) {
        this.store.releaseUnreferenced(this.history.retainedTileIds());
        throw error;
      }
    });
  }

  async discardToSaved(savedContentId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.modelValue.content_id === savedContentId) {
        this.history.markSaved(savedContentId);
        return;
      }
      const found = this.history.findContent(savedContentId);
      if (!found) throw new Error("image_edit.changed");
      this.history.resetTo(found);
      this.history.markSaved(savedContentId);
      this.modelValue = found;
      this.revisionValue += 1;
      this.store.releaseUnreferenced(this.history.retainedTileIds());
      this.notify();
    });
  }

  markSaved(contentId: string): void {
    this.history.markSaved(contentId);
  }

  private assertWritable(): void {
    if (this.disposed) throw new Error("image_edit.failed");
    if (!this.editingEnabled) throw new Error("image_edit.read_only");
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async buildNext(operation: ImageOperation): Promise<number | null> {
    let next: ImageModel;
    let changedBytes = 0;
    switch (operation.kind) {
      case "set_geometry":
        next = {
          ...this.modelValue,
          geometry: operation.geometry,
          width: operation.geometry.output_size.width,
          height: operation.geometry.output_size.height,
        };
        break;
      case "set_adjustments":
        next = { ...this.modelValue, adjustments: operation.adjustments };
        break;
      case "add_overlay":
        next = { ...this.modelValue, overlays: addOverlay(this.modelValue, operation.overlay, this.modelValue.geometry.output_size) };
        break;
      case "update_overlay":
        next = {
          ...this.modelValue,
          overlays: updateOverlay(this.modelValue.overlays, operation.id, operation.replacement, this.modelValue.geometry.output_size),
        };
        break;
      case "remove_overlay":
        next = { ...this.modelValue, overlays: removeOverlay(this.modelValue.overlays, operation.id) };
        break;
      case "paint_stroke": {
        const layer = this.modelValue.layers.find((candidate) => candidate.id === operation.layer_id);
        if (!layer || layer.kind !== "raster") throw new Error("image_edit.bad_request");
        const source = sourceSizeOf(this.modelValue);
        const stroke = await applyStrokeToLayer(this.documentId, layer.tiles, this.modelValue.geometry, source, {
          points: operation.points,
          color: operation.color,
          width: operation.width,
          hardness: operation.hardness,
          opacity: operation.opacity,
          mode: operation.mode,
        });
        if (!stroke) return null;
        changedBytes = stroke.changed_bytes;
        next = {
          ...this.modelValue,
          layers: this.modelValue.layers.map((candidate) => (candidate.id === layer.id ? { ...layer, tiles: stroke.tiles } : candidate)),
        };
        break;
      }
      default:
        throw new Error("image_edit.bad_request");
    }
    next.content_id = newUuid();
    validateLayerModel(next);
    await this.commit(next, changedBytes);
    return changedBytes;
  }

  private async commit(next: ImageModel, changedBytes: number): Promise<void> {
    if (!this.history.push(this.modelValue, next, changedBytes)) throw new Error("image_edit.history_full");
    this.modelValue = next;
    this.revisionValue += 1;
    this.store.releaseUnreferenced(this.history.retainedTileIds());
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.modelValue);
    this.contentListener?.(this.modelValue.content_id);
  }
}

/** E1: acquires the one controller for `document`. The returned object is
 * shared by every view; each call must be balanced with `release()`. */
export async function acquireImageEditor(document: DocumentHandle): Promise<ImageController> {
  const documentId = document.info.document_id;
  if (!documentId) throw new Error("image_edit.bad_request");
  const existing = entries.get(documentId);
  if (existing) {
    existing.controller.addRef();
    existing.refs += 1;
    return existing.controller;
  }
  const pending = loading.get(documentId);
  if (pending) {
    const entry = await pending;
    entry.controller.addRef();
    entry.refs += 1;
    return entry.controller;
  }
  if (entries.size + loading.size >= 8) throw new Error("image_edit.too_large");
  const promise = (async (): Promise<Entry> => {
    let store: ImageTileStore | null = null;
    try {
    const decoded = await sourceDecoder(document);
    if (!decoded || !Number.isInteger(decoded.width) || !Number.isInteger(decoded.height)) throw new Error("image_edit.bad_request");
    if (decoded.width < 1 || decoded.height < 1) throw new Error("image_edit.bad_request");
    if (decoded.width > 32768 || decoded.height > 32768 || decoded.width * decoded.height > 100_000_000) {
      throw new Error("image_edit.too_large");
    }
    if (decoded.rgba.byteLength !== decoded.width * decoded.height * 4) throw new Error("image_edit.bad_request");
    store = getImageTileStore(documentId);
    const originalTiles = await publishCanvasTiles(store, decoded.width, decoded.height, decoded.rgba);
    const state = document.getState();
    const snapshot = await document.captureSnapshot();
    const model: ImageModel = {
      schema_version: 1,
      document_id: documentId,
      content_id: state.content_id || newUuid(),
      width: decoded.width,
      height: decoded.height,
      source_snapshot: snapshot,
      original_tiles: originalTiles,
      layers: [
        {
          kind: "raster",
          id: newUuid(),
          name: (document.info.name || "Image").slice(0, 128),
          visible: true,
          locked: false,
          opacity: 1,
          blend: "normal",
          transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          mask_id: null,
          tiles: originalTiles,
        },
      ],
      masks: [],
      geometry: createDefaultGeometry(decoded.width, decoded.height),
      adjustments: createDefaultAdjustments(),
      overlays: [],
      metadata: [],
    };
    validateModel(model);
    // The registry creates disk entries read-only until a controller binds;
    // the editable state therefore comes from the document itself, not from
    // the pre-binding `editing_enabled` placeholder.
    const editingEnabled = !document.info.read_only && state.read_only_reason === undefined;
    const controller = new ImageControllerImpl(document, store, model, state.revision || 1, editingEnabled);
    return { document, documentId, refs: 1, controller };
    } catch (error) {
      if (store) disposeImageTileStore(documentId);
      throw error;
    }
  })();
  loading.set(documentId, promise);
  try {
    const entry = await promise;
    entries.set(documentId, entry);
    return entry.controller;
  } finally {
    loading.delete(documentId);
  }
}

/** E1 (project open): acquires the one controller for `document` from an
 * already-built model. The caller has published the model's tiles and captured
 * its source, so this never decodes the document bytes. The model must belong
 * to this document: its `document_id` and `source_snapshot.document_id` are the
 * document's id. Revision and content identity come from the document state,
 * exactly like `acquireImageEditor`, so capture, Undo/Redo, Save copy and the
 * read-only state agree with the shared registry. Each call is balanced with
 * `release()`. */
export async function acquireImageEditorForModel(
  document: DocumentHandle,
  model: ImageModel,
): Promise<ImageController> {
  const documentId = document.info.document_id;
  if (!documentId) throw new Error("image_edit.bad_request");
  if (!model || model.document_id !== documentId) throw new Error("image_edit.changed");
  const snapshot = model.source_snapshot;
  if (!snapshot || snapshot.document_id !== documentId) throw new Error("image_edit.changed");
  validateModel(model);
  const existing = entries.get(documentId);
  if (existing) {
    existing.controller.addRef();
    existing.refs += 1;
    return existing.controller;
  }
  if (loading.has(documentId)) throw new Error("image_edit.changed");
  if (entries.size + loading.size >= 8) throw new Error("image_edit.too_large");
  const state = document.getState();
  // The registry captures with its own revision/content tuple. Adopt that
  // identity so the first capture, Undo/Redo and the clean state agree.
  const contentId = state.content_id || model.content_id || newUuid();
  const boundModel: ImageModel = contentId === model.content_id ? model : { ...model, content_id: contentId };
  const editingEnabled = !document.info.read_only && state.read_only_reason === undefined;
  const controller = new ImageControllerImpl(
    document,
    getImageTileStore(documentId),
    boundModel,
    state.revision || 1,
    editingEnabled,
  );
  entries.set(documentId, { document, documentId, refs: 1, controller });
  return controller;
}

/** E6 backing: checks content_id and commits exactly one model transaction. */
export async function commitImageModel(
  documentId: string,
  expectedContentId: string,
  transform: (current: Readonly<ImageModel>) => ImageModel,
  changedBytes = 0,
): Promise<void> {
  const entry = entries.get(documentId);
  if (!entry) throw new Error("image_edit.changed");
  await entry.controller.commitTransform(expectedContentId, transform, changedBytes);
}

/** Coordinator adapter for 09a: wires capture, dirty notification and
 * disposal without exposing the controller's private state. */
export function imageControllerBinding(context: DocumentControllerContext, controller: ImageController): DocumentControllerBinding {
  const internal = controller as ImageControllerImpl;
  internal.setContentListener((contentId) => context.notifyContentChanged(contentId));
  context.notifyReady({ editing_enabled: internal.isEditingEnabled(), can_save_existing: false, can_save_copy: true });
  return {
    handler_id: context.info.mime === PROJECT_MIME ? "image-project" : "image",
    capture: (capturedRevision, contentId) => controller.capture(capturedRevision, contentId),
    discardToSaved: (savedContentId) => internal.discardToSaved(savedContentId),
    setEditingEnabled: async (enabled) => {
      internal.setEditingEnabled(enabled);
      context.notifyReady({
        editing_enabled: internal.isEditingEnabled(),
        can_save_existing: false,
        can_save_copy: true,
      });
    },
    dispose: async () => {
      clearImageProjectSettings(internal.documentId);
      forgetProjectExtensions(internal.documentId);
      disposeImageMetadata(internal.documentId);
      controller.release();
    },
  };
}
