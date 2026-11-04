import { applyAffine } from "./coordinates";
import type { DocumentHandle } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { createTransfer } from "../services/contentTransfer";
import type { TransferAction, TransferEnvelope, TransferReceipt, TransferTarget } from "../transfer/types";
import { applyLayerOperation, createRasterLayerFromPixels } from "./layers";
import { validateLayerModel } from "./layerTypes";
import { selectedPixels, selectedPixelsSize } from "./selectionPixels";
import { materializeSelection } from "./selectionRaster";
import { getImageTileStore } from "./tiles";
import { commitImageTransaction } from "./transactions";
import {
  fail,
  newUuid,
  sourceSizeOf,
  type ImageModel,
  type RasterLayer,
  type TileRef,
} from "./types";
import type { SelectionMask } from "./selectionTypes";

/** Safe selected-content transfer (Step 18a T5). A copy is an encoded 09c
 * image envelope; a cut publishes its one transaction only after that offer
 * exists. Paste adds one raster layer through E1 (one Undo). */

export interface CopySelectionOptions {
  /** Only a user decision may let sensitive source bytes leave. */
  allowSensitiveCopy?: boolean;
}

export interface CopiedSelection {
  envelope: TransferEnvelope;
  width: number;
  height: number;
}

export async function copySelection(
  document: DocumentHandle,
  model: Readonly<ImageModel>,
  capturedRevision: number,
  selection: SelectionMask,
  layerId: string | null,
  options: CopySelectionOptions = {},
): Promise<CopiedSelection> {
  if (document.info.sensitive && options.allowSensitiveCopy !== true) {
    throw new Error("transfer.sensitive");
  }
  const size = selectedPixelsSize(selection);
  const snapshot = await selectedPixels(model, capturedRevision, selection, layerId);
  const envelope = await createTransfer(model.document_id, {
    kind: "image",
    snapshot,
    width: size.width,
    height: size.height,
  });
  return { envelope, width: size.width, height: size.height };
}

interface ClearResult {
  model: ImageModel;
  changedBytes: number;
  changed: boolean;
}

async function clearSelectedPixels(
  documentId: string,
  model: Readonly<ImageModel>,
  layerId: string,
  selection: SelectionMask,
): Promise<ClearResult> {
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "raster") fail("image_layers.bad_request");
  if (layer.locked) fail("image_layers.locked");
  const alpha = materializeSelection(selection);
  const store = getImageTileStore(documentId);
  const work = new Map<string, { ref: TileRef; bytes: Uint8Array; dirty: boolean }>();
  for (const ref of layer.tiles) {
    const bytes = await store.read(ref.id);
    if (bytes.byteLength !== ref.byte_len) fail("image_layers.bad_request");
    work.set(ref.id, { ref, bytes, dirty: false });
  }
  if (!selection.bounds) return { model: { ...model } as ImageModel, changedBytes: 0, changed: false };
  for (const item of work.values()) {
    for (let row = 0; row < item.ref.height; row += 1) {
      for (let column = 0; column < item.ref.width; column += 1) {
        // Layer pixels are local; the selection is in canonical canvas
        // coordinates, so map the local center through the layer transform.
        const canvas = applyAffine(
          {
            x: item.ref.tile_x + column + 0.5,
            y: item.ref.tile_y + row + 0.5,
          },
          layer.transform,
        );
        const selectionX = Math.floor(canvas.x);
        const selectionY = Math.floor(canvas.y);
        if (selectionX < 0 || selectionY < 0 || selectionX >= selection.width || selectionY >= selection.height) continue;
        const coverage = alpha[selectionY * selection.width + selectionX] / 255;
        if (coverage <= 0) continue;
        const offset = (row * item.ref.width + column) * 4 + 3;
        const nextAlpha = Math.max(0, Math.min(255, Math.round(item.bytes[offset] * (1 - coverage))));
        if (nextAlpha === item.bytes[offset]) continue;
        item.bytes[offset] = nextAlpha;
        if (nextAlpha === 0) {
          item.bytes[offset - 3] = 0;
          item.bytes[offset - 2] = 0;
          item.bytes[offset - 1] = 0;
        }
        item.dirty = true;
      }
    }
  }
  let changedBytes = 0;
  const changedRefs = new Map<string, TileRef>();
  for (const item of work.values()) {
    if (!item.dirty) continue;
    const ref = await publishAt(store, item.ref, item.bytes);
    changedRefs.set(item.ref.id, ref);
    changedBytes += item.ref.byte_len;
  }
  if (changedRefs.size === 0) return { model: { ...model } as ImageModel, changedBytes: 0, changed: false };
  const nextLayer: RasterLayer = {
    ...layer,
    tiles: layer.tiles.map((ref) => changedRefs.get(ref.id) ?? ref),
  };
  const next: ImageModel = {
    ...model,
    layers: model.layers.map((candidate) => (candidate.id === layer.id ? nextLayer : candidate)),
    content_id: newUuid(),
  };
  validateLayerModel(next);
  return { model: next, changedBytes, changed: true };
}

async function publishAt(
  store: ReturnType<typeof getImageTileStore>,
  ref: TileRef,
  bytes: Uint8Array,
): Promise<TileRef> {
  const published = await store.publish(ref.width, ref.height, bytes);
  return { ...published, tile_x: ref.tile_x, tile_y: ref.tile_y };
}

export async function cutSelection(
  document: DocumentHandle,
  model: Readonly<ImageModel>,
  capturedRevision: number,
  selection: SelectionMask,
  layerId: string | null,
  options: CopySelectionOptions = {},
): Promise<{ envelope: TransferEnvelope; model: ImageModel; changed: boolean }> {
  if (layerId === null) fail("image_layers.bad_request");
  const target = model.layers.find((candidate) => candidate.id === layerId);
  if (!target || target.kind !== "raster") fail("image_layers.bad_request");
  if (target.locked) fail("image_layers.locked");
  // The offer must exist before any pixel changes.
  const copied = await copySelection(document, model, capturedRevision, selection, layerId, options);
  const cleared = await clearSelectedPixels(model.document_id, model, layerId, selection);
  if (!cleared.changed) {
    return { envelope: copied.envelope, model: cleared.model, changed: false };
  }
  // The document history reserves the inverse itself; pass the exact changed
  // tile bytes once instead of keeping a second, never-released ledger.
  await commitImageTransaction(model.document_id, model.content_id, () => cleared.model, cleared.changedBytes);
  return { envelope: copied.envelope, model: cleared.model, changed: true };
}

export async function pasteImageLayer(
  documentId: string,
  expectedContentId: string,
  width: number,
  height: number,
  rgba: Uint8Array,
  name: string,
  index: number,
): Promise<RasterLayer> {
  const layer = await createRasterLayerFromPixels(documentId, width, height, rgba, name);
  await applyLayerOperation(documentId, expectedContentId, { kind: "add", layer, index });
  return layer;
}

export interface ImageLayerTransferOptions {
  targetId: string;
  document: DocumentHandle;
  documentId: string;
  getModel: () => Readonly<ImageModel>;
  getExpectedContentId: () => string;
  decodeSnapshot: (snapshot: ExportSnapshot) => Promise<{ width: number; height: number; rgba: Uint8Array }>;
  layerName: string;
  confirmSensitive?: (envelope: TransferEnvelope) => Promise<boolean>;
}

function editable(document: DocumentHandle): boolean {
  const state = document.getState();
  return state.editing_enabled === true && document.info.read_only !== true;
}

function imageAction(): TransferAction {
  return { id: "add_layers", label_key: "transfer.layers", losses: [], mutates: true };
}

/** A statically registered 09c target. It advertises nothing on a protected
 * or read-only document and revalidates at accept time. */
export function createImageLayerTransferTarget(options: ImageLayerTransferOptions): TransferTarget {
  return {
    target_id: options.targetId,
    document_id: options.documentId,
    accepted_kinds: ["image"],
    describe(envelope: TransferEnvelope): readonly TransferAction[] {
      if (!editable(options.document)) return [];
      if (envelope.payload.kind !== "image") return [];
      return [imageAction()];
    },
    async accept(envelope: TransferEnvelope, actionId: string): Promise<TransferReceipt> {
      if (!editable(options.document)) throw new Error("transfer.read_only");
      if (actionId !== "add_layers" || envelope.payload.kind !== "image") throw new Error("transfer.unsupported");
      if (envelope.sensitive) {
        const allowed = options.confirmSensitive ? await options.confirmSensitive(envelope) : false;
        if (!allowed) throw new Error("transfer.sensitive");
      }
      const image = await options.decodeSnapshot(envelope.payload.snapshot);
      const model = options.getModel();
      if (image.width * image.height * 4 !== image.rgba.byteLength) throw new Error("transfer.invalid");
      await pasteImageLayer(
        options.documentId,
        options.getExpectedContentId(),
        image.width,
        image.height,
        image.rgba,
        options.layerName,
        model.layers.length,
      );
      const state = options.document.getState();
      return {
        transaction_id: newUuid(),
        target_document_id: options.documentId,
        revision: state.revision,
        inserted_count: 1,
        losses: [],
        complete: true,
      };
    },
  };
}

export function selectionCanvasSize(model: Readonly<ImageModel>): { width: number; height: number } {
  return sourceSizeOf(model);
}
