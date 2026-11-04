import { fail, MAX_HISTORY_BYTES, type ImageModel } from "./types";

/** Reserve ledger for 18a layer operations (D2). 14b's `ImageHistory` owns
 * the actual undo pairs; this ledger refuses the controller commit when the
 * inverse could not be retained. New tiles may already be immutable in the
 * tile store; they are not referenced by the shared model. The coordinator
 * should also feed `changedBytes` into the 14b history path (see the handoff
 * proposal); until then this is the conservative 18a cap. */

export interface LayerHistoryReservation {
  readonly bytes: number;
  release(): void;
}

const used = new Map<string, number>();

export function estimateLayerModelBytes(model: Readonly<ImageModel>): number {
  let bytes = 2048;
  bytes += model.layers.length * 1024;
  bytes += model.masks.length * 768;
  for (const layer of model.layers) {
    if (layer.kind === "raster") bytes += layer.tiles.length * 128;
  }
  for (const mask of model.masks) bytes += mask.tiles.length * 96;
  bytes += model.overlays.length * 256;
  bytes += model.metadata.length * 128;
  return bytes;
}

/** Unique tile bytes across the pair; duplicated/shared tiles count once. */
function tileBytesOfPair(before: Readonly<ImageModel>, after: Readonly<ImageModel>): number {
  const bytes = new Map<string, number>();
  const collect = (model: Readonly<ImageModel>) => {
    for (const tile of model.original_tiles) bytes.set(tile.id, tile.byte_len);
    for (const layer of model.layers) {
      if (layer.kind !== "raster") continue;
      for (const tile of layer.tiles) bytes.set(tile.id, tile.byte_len);
    }
    for (const mask of model.masks) {
      for (const tile of mask.tiles) bytes.set(tile.id, tile.width * tile.height);
    }
  };
  collect(before);
  collect(after);
  let total = 0;
  for (const value of bytes.values()) total += value;
  return total;
}

export function layerHistoryBytes(documentId: string): number {
  return used.get(documentId) ?? 0;
}

/** Reserves the exact before/after metadata plus every uniquely referenced
 * tile (shared tiles count once). When the result would cross 256 MiB, no
 * controller call is made. `changedBytes` is validated for the caller and is
 * already represented by the after model's tile identities. */
export function reserveLayerHistory(
  documentId: string,
  before: Readonly<ImageModel>,
  after: Readonly<ImageModel>,
  changedBytes: number,
): LayerHistoryReservation {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_layers.bad_request");
  if (!Number.isSafeInteger(changedBytes) || changedBytes < 0) fail("image_layers.bad_request");
  const cost = estimateLayerModelBytes(before) + estimateLayerModelBytes(after) + tileBytesOfPair(before, after);
  const current = used.get(documentId) ?? 0;
  if (cost > MAX_HISTORY_BYTES || current + cost > MAX_HISTORY_BYTES) {
    fail("image_layers.history_full");
  }
  used.set(documentId, current + cost);
  let released = false;
  return {
    bytes: cost,
    release: () => {
      if (released) return;
      released = true;
      const remaining = Math.max(0, (used.get(documentId) ?? 0) - cost);
      if (remaining === 0) used.delete(documentId);
      else used.set(documentId, remaining);
    },
  };
}

/** Called when the document controller is disposed or its history is reset. */
export function resetLayerHistoryBudget(documentId: string): void {
  used.delete(documentId);
}
