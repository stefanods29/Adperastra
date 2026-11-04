import { getImageEditorModel } from "./ImageDocument";
import { applyTransformToLayers } from "./layerTransform";
import {
  MAX_LAYERS,
  validateLayerModel,
  validateLayerName,
  validateLayerOperation,
  type LayerOperation,
} from "./layerTypes";
import { compositePixels, layersPixels } from "./composite";
import { getImageTileStore, publishCanvasTiles, publishTileAt } from "./tiles";
import { commitImageTransaction } from "./transactions";
import {
  assertPixels,
  fail,
  MAX_DOCUMENT_TILE_BYTES,
  newUuid,
  registerImageModelValidator,
  sourceSizeOf,
  TILE_EDGE,
  type ImageLayer,
  type ImageMask,
  type ImageModel,
  type RasterLayer,
  type Rect,
} from "./types";

// The 14b controller validates every commit. Register the 18a extension once
// so multi-layer/mask models pass the same one commit path.
registerImageModelValidator(validateLayerModel);

/** E1: immutable layer operations. Each call produces one complete model,
 * reserves its inverse once, then delegates to 14b E6. A failed operation
 * never mutates the shared controller. */

function copyLayer(layer: ImageLayer): ImageLayer {
  // Digits only: generated layer names are document data, not UI copy.
  const name = Array.from(`${layer.name} 2`).slice(0, 128).join("");
  switch (layer.kind) {
    case "raster":
      return { ...layer, id: newUuid(), name, tiles: [...layer.tiles], mask_id: layer.mask_id };
    case "text":
      return { ...layer, id: newUuid(), name };
    case "shape":
      return { ...layer, id: newUuid(), name, overlay: { ...layer.overlay, points: [...layer.overlay.points] } };
    case "adjustment":
      return { ...layer, id: newUuid(), name, adjustment: { ...layer.adjustment } };
    default:
      fail("image_layers.bad_request");
  }
}

function pruneMasks(model: ImageModel): ImageMask[] {
  const used = new Set(model.layers.flatMap((layer) => (layer.mask_id ? [layer.mask_id] : [])));
  return model.masks.filter((mask) => used.has(mask.id));
}

function tileBytesOf(layer: RasterLayer): number {
  return layer.tiles.reduce((total, tile) => total + tile.byte_len, 0);
}

export async function createBlankRasterLayer(
  documentId: string,
  width: number,
  height: number,
  name: string,
): Promise<RasterLayer> {
  assertPixels(width, height);
  validateLayerName(name);
  const store = getImageTileStore(documentId);
  if (store.byteLength() + width * height * 4 > MAX_DOCUMENT_TILE_BYTES) fail("image_layers.too_large");
  const tiles: RasterLayer["tiles"] = [];
  for (let tileY = 0; tileY < height; tileY += TILE_EDGE) {
    const tileHeight = Math.min(TILE_EDGE, height - tileY);
    for (let tileX = 0; tileX < width; tileX += TILE_EDGE) {
      const tileWidth = Math.min(TILE_EDGE, width - tileX);
      const ref = await publishTileAt(
        store,
        tileX,
        tileY,
        tileWidth,
        tileHeight,
        new Uint8Array(tileWidth * tileHeight * 4),
      );
      tiles.push(ref);
    }
  }
  return {
    kind: "raster",
    id: newUuid(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    tiles,
  };
}

export async function createRasterLayerFromPixels(
  documentId: string,
  width: number,
  height: number,
  rgba: Uint8Array,
  name: string,
): Promise<RasterLayer> {
  assertPixels(width, height);
  validateLayerName(name);
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== width * height * 4) fail("image_layers.bad_request");
  const store = getImageTileStore(documentId);
  if (store.byteLength() + rgba.byteLength > MAX_DOCUMENT_TILE_BYTES) fail("image_layers.too_large");
  const tiles = await publishCanvasTiles(store, width, height, rgba);
  return {
    kind: "raster",
    id: newUuid(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    tiles,
  };
}

function replaceLayer(model: ImageModel, id: string, replacement: ImageLayer): ImageModel {
  return { ...model, layers: model.layers.map((layer) => (layer.id === id ? replacement : layer)) };
}

async function mergeDown(model: ImageModel, id: string, documentId: string): Promise<{ model: ImageModel; changedBytes: number }> {
  const index = model.layers.findIndex((layer) => layer.id === id);
  if (index < 1) fail("image_layers.bad_request");
  const lower = model.layers[index - 1];
  const upper = model.layers[index];
  if (lower.kind !== "raster" || upper.kind !== "raster" || lower.locked || upper.locked) {
    fail(lower.locked || upper.locked ? "image_layers.locked" : "image_layers.bad_request");
  }
  const source = sourceSizeOf(model);
  const pixels = await layersPixels(model, [lower.id, upper.id], { x: 0, y: 0, ...source }, false);
  const merged = await createRasterLayerFromPixels(documentId, pixels.width, pixels.height, pixels.rgba, upper.name);
  merged.visible = lower.visible || upper.visible;
  const layers = [...model.layers];
  layers.splice(index - 1, 2, merged);
  const next = { ...model, layers };
  return { model: { ...next, masks: pruneMasks(next) }, changedBytes: pixels.rgba.byteLength };
}

async function flatten(model: ImageModel, documentId: string): Promise<{ model: ImageModel; changedBytes: number }> {
  if (model.layers.some((layer) => layer.locked)) fail("image_layers.locked");
  // Text/shape layers are Step 18b. Until their typed renderer exists,
  // refuse to flatten rather than silently dropping their pixels.
  if (model.layers.some((layer) => layer.kind !== "raster" && layer.kind !== "adjustment")) {
    fail("image_layers.failed");
  }
  const source = sourceSizeOf(model);
  // `compositePixels` includes visible adjustment layers over the layers
  // below them; hidden layers are intentionally left out of the result.
  const pixels = await compositePixels(model, { x: 0, y: 0, width: source.width, height: source.height });
  const name = model.layers[0]?.name ?? "Image";
  const flattened = await createRasterLayerFromPixels(documentId, pixels.width, pixels.height, pixels.rgba, name);
  return {
    model: { ...model, layers: [flattened], masks: [] },
    changedBytes: pixels.rgba.byteLength,
  };
}

/** Pure model transformation used by the UI and by tests. The caller still
 * needs E6 to compare content identity and publish one history state. */
export async function applyLayerOperationToModel(
  model: Readonly<ImageModel>,
  operation: LayerOperation,
  documentId = model.document_id,
): Promise<{ model: ImageModel; changedBytes: number }> {
  validateLayerOperation(model, operation);
  let next: ImageModel = model as ImageModel;
  let changedBytes = 0;
  switch (operation.kind) {
    case "add": {
      const layers = [...model.layers];
      layers.splice(operation.index, 0, operation.layer);
      next = { ...model, layers };
      changedBytes = tileBytesOf(operation.layer);
      break;
    }
    case "duplicate": {
      const index = model.layers.findIndex((layer) => layer.id === operation.id);
      const duplicate = copyLayer(model.layers[index]);
      const layers = [...model.layers];
      layers.splice(index + 1, 0, duplicate);
      next = { ...model, layers };
      break;
    }
    case "remove": {
      const removed = new Set(operation.ids);
      const layers = model.layers.filter((layer) => !removed.has(layer.id));
      if (layers.length < 1) fail("image_layers.last_layer");
      next = { ...model, layers };
      next = { ...next, masks: pruneMasks(next) };
      break;
    }
    case "reorder": {
      const byId = new Map(model.layers.map((layer) => [layer.id, layer]));
      next = { ...model, layers: operation.ids.map((id) => byId.get(id) as ImageLayer) };
      break;
    }
    case "rename": {
      const layer = model.layers.find((candidate) => candidate.id === operation.id) as ImageLayer;
      next = replaceLayer(model, operation.id, { ...layer, name: validateLayerName(operation.name) } as ImageLayer);
      break;
    }
    case "visibility": {
      const layer = model.layers.find((candidate) => candidate.id === operation.id) as ImageLayer;
      next = replaceLayer(model, operation.id, { ...layer, visible: operation.visible } as ImageLayer);
      break;
    }
    case "lock": {
      const layer = model.layers.find((candidate) => candidate.id === operation.id) as ImageLayer;
      next = replaceLayer(model, operation.id, { ...layer, locked: operation.locked } as ImageLayer);
      break;
    }
    case "opacity": {
      const layer = model.layers.find((candidate) => candidate.id === operation.id) as ImageLayer;
      next = replaceLayer(model, operation.id, { ...layer, opacity: operation.opacity } as ImageLayer);
      break;
    }
    case "blend": {
      const layer = model.layers.find((candidate) => candidate.id === operation.id) as ImageLayer;
      next = replaceLayer(model, operation.id, { ...layer, blend: operation.blend } as ImageLayer);
      break;
    }
    case "transform": {
      const result = await applyTransformToLayers(model, operation.ids, operation.matrix, operation.linked_mask, documentId);
      next = result.model;
      changedBytes = result.changedBytes;
      break;
    }
    case "mask": {
      const layer = model.layers.find((candidate) => candidate.id === operation.id) as ImageLayer;
      if (operation.mask === null) {
        next = replaceLayer(model, operation.id, { ...layer, mask_id: null } as ImageLayer);
        next = { ...next, masks: pruneMasks(next) };
        break;
      }
      const existing = model.masks.find((mask) => mask.id === operation.mask?.id);
      const masks = existing ? model.masks : [...model.masks, operation.mask];
      next = replaceLayer(model, operation.id, { ...layer, mask_id: operation.mask.id } as ImageLayer);
      next = { ...next, masks };
      changedBytes = operation.mask.tiles.reduce((total, tile) => total + tile.width * tile.height, 0);
      break;
    }
    case "merge_down": {
      const result = await mergeDown({ ...model } as ImageModel, operation.id, documentId);
      next = result.model;
      changedBytes = result.changedBytes;
      break;
    }
    case "flatten": {
      const result = await flatten({ ...model } as ImageModel, documentId);
      next = result.model;
      changedBytes = result.changedBytes;
      break;
    }
    default:
      fail("image_layers.bad_request");
  }
  const committed: ImageModel = { ...next, content_id: newUuid() };
  validateLayerModel(committed);
  return { model: committed, changedBytes };
}

/** E1. The controller lookup is a small producer extension: `ImageDocument`
 * exposes the already-existing entry map so a document-id-only consumer can
 * obtain the immutable model without a second registry. */
export async function applyLayerOperation(
  documentId: string,
  expectedContentId: string,
  operation: LayerOperation,
): Promise<void> {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_layers.bad_request");
  if (typeof expectedContentId !== "string" || expectedContentId.length === 0) fail("image_layers.bad_request");
  const current = getImageEditorModel(documentId);
  if (!current) fail("image_layers.changed");
  if (current.content_id !== expectedContentId) fail("image_layers.changed");
  const result = await applyLayerOperationToModel(current, operation, documentId);
  // The document history reserves the inverse before mutating; include the
  // exact changed tile bytes instead of keeping a second, never-released
  // ledger that would eventually refuse every later operation.
  await commitImageTransaction(documentId, expectedContentId, () => result.model, result.changedBytes);
}

export function selectedLayerIds(model: Readonly<ImageModel>, ids: readonly string[]): string[] {
  const available = new Set(model.layers.map((layer) => layer.id));
  const selected = [...new Set(ids.filter((id) => available.has(id)))];
  return selected.length > 0 ? selected : model.layers.slice(-1).map((layer) => layer.id);
}

export function layerIndex(model: Readonly<ImageModel>, id: string): number {
  return model.layers.findIndex((layer) => layer.id === id);
}

export function fullCanvasRect(model: Readonly<ImageModel>): Rect {
  const source = sourceSizeOf(model);
  return { x: 0, y: 0, width: source.width, height: source.height };
}

export { MAX_LAYERS };
