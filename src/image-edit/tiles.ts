import {
  fail,
  MAX_DOCUMENT_TILE_BYTES,
  MAX_TOTAL_TILE_BYTES,
  newUuid,
  TILE_EDGE,
  type MaskTileRef,
  type TileRef,
} from "./types";

/** Immutable tiled pixel storage (E7, `image-document-1`).
 *
 * Every published tile is owned by the store, has a UUID identity and is
 * never changed. Callers receive copies, so a worker or a view can never
 * mutate a tile that another model revision still references. Byte counts
 * are validated and reserved before allocation. */

export interface ImageTileStore {
  read(id: string): Promise<Uint8Array>;
  publish(width: number, height: number, rgba: Uint8Array): Promise<TileRef>;
  publishMask(width: number, height: number, alpha: Uint8Array): Promise<MaskTileRef>;
  pin(ids: readonly string[]): () => void;
  /** Drops tiles no retained model/history state references. */
  releaseUnreferenced(retainedIds: readonly string[]): void;
  /** Total bytes currently held by this document's store. */
  byteLength(): number;
}

interface StoredTile {
  ref: TileRef;
  bytes: Uint8Array;
  mask: boolean;
}

let totalBytes = 0;
const stores = new Map<string, MemoryTileStore>();

class MemoryTileStore implements ImageTileStore {
  private readonly documentId: string;
  private readonly tiles = new Map<string, StoredTile>();
  private readonly pins = new Map<string, number>();
  private bytes = 0;
  private generation = 0;

  constructor(documentId: string) {
    this.documentId = documentId;
  }

  async read(id: string): Promise<Uint8Array> {
    const tile = this.tiles.get(id);
    if (!tile) fail("image_edit.bad_request");
    return new Uint8Array(tile.bytes);
  }

  async publish(width: number, height: number, rgba: Uint8Array): Promise<TileRef> {
    const byteLen = this.checkShape(width, height, 4);
    if (!(rgba instanceof Uint8Array) || rgba.byteLength !== byteLen) fail("image_edit.bad_request");
    return this.publishBytes(width, height, new Uint8Array(rgba), false) as TileRef;
  }

  async publishMask(width: number, height: number, alpha: Uint8Array): Promise<MaskTileRef> {
    const byteLen = this.checkShape(width, height, 1);
    if (!(alpha instanceof Uint8Array) || alpha.byteLength !== byteLen) fail("image_edit.bad_request");
    const ref = this.publishBytes(width, height, new Uint8Array(alpha), true);
    return {
      id: ref.id,
      tile_x: ref.tile_x,
      tile_y: ref.tile_y,
      width: ref.width,
      height: ref.height,
      generation: ref.generation,
    };
  }

  pin(ids: readonly string[]): () => void {
    for (const id of ids) {
      if (!this.tiles.has(id)) fail("image_edit.bad_request");
    }
    for (const id of ids) this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const id of ids) {
        const count = (this.pins.get(id) ?? 0) - 1;
        if (count > 0) this.pins.set(id, count);
        else this.pins.delete(id);
      }
    };
  }

  releaseUnreferenced(retainedIds: readonly string[]): void {
    const retained = new Set(retainedIds);
    for (const [id, tile] of [...this.tiles]) {
      if (retained.has(id) || (this.pins.get(id) ?? 0) > 0) continue;
      this.tiles.delete(id);
      this.bytes -= tile.bytes.byteLength;
      totalBytes -= tile.bytes.byteLength;
    }
  }

  byteLength(): number {
    return this.bytes;
  }

  private checkShape(width: number, height: number, channels: number): number {
    if (!Number.isInteger(width) || !Number.isInteger(height)) fail("image_edit.bad_request");
    if (width < 1 || height < 1 || width > TILE_EDGE || height > TILE_EDGE) fail("image_edit.bad_request");
    const byteLen = width * height * channels;
    if (!Number.isSafeInteger(byteLen)) fail("image_edit.too_large");
    return byteLen;
  }

  private publishBytes(width: number, height: number, bytes: Uint8Array, mask: boolean): TileRef {
    const byteLen = bytes.byteLength;
    if (this.bytes + byteLen > MAX_DOCUMENT_TILE_BYTES) fail("image_edit.too_large");
    if (totalBytes + byteLen > MAX_TOTAL_TILE_BYTES) fail("image_edit.too_large");
    this.bytes += byteLen;
    totalBytes += byteLen;
    this.generation += 1;
    // The provisional position is the canvas origin; positioned callers use
    // `publishTileAt`/`publishCanvasTiles` (or layerTransfer's publishAt) to
    // replace it with the tile's real canvas cell.
    const ref: TileRef = {
      id: newUuid(),
      tile_x: 0,
      tile_y: 0,
      width,
      height,
      byte_len: mask ? width * height : byteLen,
      generation: this.generation,
    };
    this.tiles.set(ref.id, { ref, bytes, mask });
    return ref;
  }

  // `publish` callers provide only tile dimensions; positions are assigned by
  // the caller that lays out the canvas. `publishTileAt` below replaces the
  // provisional origin.
}

/** Publishes one tile at a known canvas position. Positions are part of the
 * immutable reference, so a tile cannot be silently re-used elsewhere. */
export async function publishTileAt(
  store: ImageTileStore,
  tileX: number,
  tileY: number,
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<TileRef> {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0) fail("image_edit.bad_request");
  const ref = await store.publish(width, height, rgba);
  return { ...ref, tile_x: tileX, tile_y: tileY };
}

/** Splits a full canvas into 256x256 RGBA tiles. The edge tiles keep their
 * real sizes. A failed publication releases only tiles this call published. */
export async function publishCanvasTiles(
  store: ImageTileStore,
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<TileRef[]> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail("image_edit.bad_request");
  }
  const stride = width * 4;
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== stride * height) fail("image_edit.bad_request");
  const published: TileRef[] = [];
  for (let tileY = 0; tileY < height; tileY += TILE_EDGE) {
    const tileHeight = Math.min(TILE_EDGE, height - tileY);
    for (let tileX = 0; tileX < width; tileX += TILE_EDGE) {
      const tileWidth = Math.min(TILE_EDGE, width - tileX);
      const tile = new Uint8Array(tileWidth * tileHeight * 4);
      for (let row = 0; row < tileHeight; row += 1) {
        const sourceStart = (tileY + row) * stride + tileX * 4;
        tile.set(rgba.subarray(sourceStart, sourceStart + tileWidth * 4), row * tileWidth * 4);
      }
      const ref = await store.publish(tileWidth, tileHeight, tile);
      published.push({ ...ref, tile_x: tileX, tile_y: tileY });
    }
  }
  return published;
}

export function getImageTileStore(documentId: string): ImageTileStore {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_edit.bad_request");
  const existing = stores.get(documentId);
  if (existing) return existing;
  const store = new MemoryTileStore(documentId);
  stores.set(documentId, store);
  return store;
}

/** Disposes a document's store at the last controller release. */
export function disposeImageTileStore(documentId: string): void {
  const store = stores.get(documentId);
  if (!store) return;
  const memory = store as MemoryTileStore;
  memory.releaseUnreferenced([]);
  stores.delete(documentId);
}
