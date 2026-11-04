import { mapRect } from "./coordinates";
import { outputToSourceAffine } from "./geometry";
import {
  fail,
  newUuid,
  sourceSizeOf,
  type ImageModel,
  type ImageRenderLease,
  type MaskTileRef,
  type Rect,
  type TileRef,
} from "./types";
import { getImageTileStore } from "./tiles";
import {
  runCompositeRequest,
  type CompositeOptions,
  type CompositePayload,
  type CompositePixelsResult,
  type CompositeWorkerFailure,
  type CompositeWorkerRequest,
  type CompositeWorkerResult,
} from "./compositeWorker";

/** E3: one viewport-region composite over immutable layer tiles.
 *
 * The returned `ImageRenderLease` is the same type and lifetime contract as
 * 14b's render lease: one `ImageBitmap`, idempotent `release`, no document
 * mutation. There is no second cache or second document registry. */

interface WorkerEntry {
  worker: Worker;
  pending: Map<string, { resolve: (value: CompositePixelsResult) => void; reject: (error: Error) => void }>;
}

const workers = new Map<string, WorkerEntry>();

function workerFor(documentId: string): WorkerEntry | null {
  if (typeof Worker === "undefined") return null;
  const existing = workers.get(documentId);
  if (existing) return existing;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./compositeWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  const pending = new Map<string, { resolve: (value: CompositePixelsResult) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<CompositeWorkerResult | CompositeWorkerFailure>) => {
    const message = event.data;
    const entry = pending.get(message.request_id);
    if (!entry) return;
    pending.delete(message.request_id);
    if (message.type === "failure") entry.reject(new Error(message.error));
    else entry.resolve({ width: message.width, height: message.height, rgba: new Uint8Array(message.rgba) });
  };
  worker.onerror = () => {
    for (const entry of pending.values()) entry.reject(new Error("image_layers.failed"));
    pending.clear();
  };
  const created = { worker, pending };
  workers.set(documentId, created);
  return created;
}

export function disposeCompositeWorker(documentId: string): void {
  const entry = workers.get(documentId);
  if (!entry) return;
  for (const pending of entry.pending.values()) pending.reject(new Error("image_layers.failed"));
  entry.worker.terminate();
  workers.delete(documentId);
  compositeLeaseTracker.releaseDocument(documentId);
}

function validateRegion(region: Rect, width: number, height: number): Rect {
  if (
    !region ||
    ![region.x, region.y, region.width, region.height].every((value) => typeof value === "number" && Number.isFinite(value)) ||
    region.width < 1 ||
    region.height < 1
  ) {
    fail("image_layers.bad_request");
  }
  const rawX = Math.floor(region.x);
  const rawY = Math.floor(region.y);
  const x = Math.max(0, Math.min(width - 1, rawX));
  const y = Math.max(0, Math.min(height - 1, rawY));
  const clippedWidth = Math.min(width - x, Math.max(1, Math.floor(region.width) + Math.min(0, rawX)));
  const clippedHeight = Math.min(height - y, Math.max(1, Math.floor(region.height) + Math.min(0, rawY)));
  if (clippedWidth < 1 || clippedHeight < 1) fail("image_layers.bad_request");
  return { x, y, width: clippedWidth, height: clippedHeight };
}

function intersects(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/** Reads the immutable tile identities needed for `sourceRegion` (the full
 * source when omitted). Layer transforms are accounted for when a tile's
 * canvas-space bounding box is tested; no current revision or path is read. */
export async function collectCompositePayload(
  model: Readonly<ImageModel>,
  sourceRegion?: Rect,
): Promise<CompositePayload> {
  const source = sourceSizeOf(model);
  const region = sourceRegion ?? { x: 0, y: 0, width: source.width, height: source.height };
  const padded = { x: region.x - 1, y: region.y - 1, width: region.width + 2, height: region.height + 2 };
  const store = getImageTileStore(model.document_id);
  const tileIds = new Map<string, TileRef>();
  for (const layer of model.layers) {
    if (layer.kind !== "raster") continue;
    for (const tile of layer.tiles) {
      const bounds = mapRect(
        { x: tile.tile_x, y: tile.tile_y, width: tile.width, height: tile.height },
        layer.transform,
      );
      if (intersects(bounds, padded)) tileIds.set(tile.id, tile);
    }
  }
  const maskIds = new Map<string, MaskTileRef>();
  for (const mask of model.masks) {
    for (const tile of mask.tiles) {
      if (intersects({ x: tile.tile_x, y: tile.tile_y, width: tile.width, height: tile.height }, padded)) {
        maskIds.set(tile.id, tile);
      }
    }
  }
  const tiles: CompositePayload["tiles"] = [];
  for (const ref of tileIds.values()) {
    const bytes = await store.read(ref.id);
    if (bytes.byteLength !== ref.byte_len) fail("image_layers.bad_request");
    tiles.push({ id: ref.id, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
  const masks: CompositePayload["masks"] = [];
  for (const ref of maskIds.values()) {
    const bytes = await store.read(ref.id);
    if (bytes.byteLength !== ref.width * ref.height) fail("image_layers.bad_request");
    masks.push({ id: ref.id, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
  return { model, source_size: source, tiles, masks };
}

async function runPixels(
  payload: CompositePayload,
  region: Rect,
  options: CompositeOptions,
  mode: "source" | "region",
): Promise<CompositePixelsResult> {
  const request: CompositeWorkerRequest = {
    type: "composite",
    request_id: newUuid(),
    payload,
    region,
    options,
    mode,
  };
  const entry = workerFor(payload.model.document_id);
  if (!entry) {
    return runCompositeRequest(request);
  }
  return await new Promise<CompositePixelsResult>((resolve, reject) => {
    entry.pending.set(request.request_id, { resolve, reject });
    const transfer: Transferable[] = [...payload.tiles, ...payload.masks].map((tile) => tile.bytes);
    try {
      entry.worker.postMessage(request, transfer);
    } catch (error) {
      entry.pending.delete(request.request_id);
      reject(error instanceof Error ? error : new Error("image_layers.failed"));
    }
  });
}

function createLease(width: number, height: number, rgba: Uint8Array): Promise<ImageRenderLease> {
  if (rgba.byteLength !== width * height * 4) return Promise.reject(new Error("image_layers.failed"));
  if (typeof createImageBitmap !== "function") return Promise.reject(new Error("image_edit.failed"));
  const image = new ImageData(new Uint8ClampedArray(rgba), width, height);
  return createImageBitmap(image).then((bitmap) => {
    let released = false;
    const id = newUuid();
    const release = () => {
      if (released) return;
      released = true;
      compositeLeaseTracker.release(id);
      if (typeof bitmap.close === "function") bitmap.close();
    };
    return { id, width, height, bitmap, release };
  });
}

export async function compositeRegion(model: Readonly<ImageModel>, region: Rect): Promise<ImageRenderLease> {
  const output = model.geometry.output_size;
  const clipped = validateRegion(region, output.width, output.height);
  const source = sourceSizeOf(model);
  const mapped = mapRect(clipped, outputToSourceAffine(model.geometry, source));
  const sourceX = Math.max(0, Math.min(source.width - 1, Math.floor(mapped.x) - 1));
  const sourceY = Math.max(0, Math.min(source.height - 1, Math.floor(mapped.y) - 1));
  const sourceRegion: Rect = {
    x: sourceX,
    y: sourceY,
    width: Math.max(1, Math.min(source.width - sourceX, Math.ceil(mapped.width) + 2)),
    height: Math.max(1, Math.min(source.height - sourceY, Math.ceil(mapped.height) + 2)),
  };
  const payload = await collectCompositePayload(model, sourceRegion);
  const pixels = await runPixels(payload, clipped, { respect_visibility: true }, "region");
  const lease = await createLease(pixels.width, pixels.height, pixels.rgba);
  compositeLeaseTracker.add(model.document_id, lease.id, lease.release);
  return lease;
}

/** Source-canvas composite used by wand/color selection and selected-content
 * copy. It includes visible layers only. */
export async function compositePixels(model: Readonly<ImageModel>, region: Rect): Promise<CompositePixelsResult> {
  const source = sourceSizeOf(model);
  const clipped = validateRegion(region, source.width, source.height);
  const payload = await collectCompositePayload(model, clipped);
  return await runPixels(payload, clipped, { respect_visibility: true }, "source");
}

/** One layer's pixels on the source canvas, used by copy/cut. Visibility is
 * intentionally ignored: a user can copy a layer while it is hidden. */
export async function layerPixels(
  model: Readonly<ImageModel>,
  layerId: string,
  region: Rect,
): Promise<CompositePixelsResult> {
  const layer = model.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.kind !== "raster") fail("image_layers.bad_request");
  const source = sourceSizeOf(model);
  const clipped = validateRegion(region, source.width, source.height);
  const payload = await collectCompositePayload(model, clipped);
  return await runPixels(payload, clipped, { layer_ids: [layerId], respect_visibility: false }, "source");
}

/** Two/all layers at source-canvas resolution, used by merge and flatten. */
export async function layersPixels(
  model: Readonly<ImageModel>,
  layerIds: readonly string[],
  region: Rect,
  respectVisibility = false,
): Promise<CompositePixelsResult> {
  if (!Array.isArray(layerIds) || layerIds.length < 1) fail("image_layers.bad_request");
  for (const id of layerIds) {
    const layer = model.layers.find((candidate) => candidate.id === id);
    if (!layer || layer.kind !== "raster") fail("image_layers.bad_request");
  }
  const source = sourceSizeOf(model);
  const clipped = validateRegion(region, source.width, source.height);
  const payload = await collectCompositePayload(model, clipped);
  return await runPixels(payload, clipped, { layer_ids: layerIds, respect_visibility: respectVisibility }, "source");
}

interface TrackedLease {
  documentId: string;
  lastUsed: number;
  release: () => void;
}

/** Tracks composite image leases so a view can release inactive GPU-backed
 * bitmaps after 30 s without touching active documents. */
export class CompositeLeaseTracker {
  private readonly leases = new Map<string, TrackedLease>();

  add(documentId: string, id: string, release: () => void, now = Date.now()): void {
    this.leases.set(id, { documentId, lastUsed: now, release });
  }

  touch(id: string, now = Date.now()): void {
    const lease = this.leases.get(id);
    if (lease) lease.lastUsed = now;
  }

  release(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.leases.delete(id);
    lease.release();
  }

  releaseInactive(now = Date.now(), idleMs = 30_000): number {
    let released = 0;
    for (const [id, lease] of [...this.leases]) {
      if (now - lease.lastUsed < idleMs) continue;
      this.leases.delete(id);
      lease.release();
      released += 1;
    }
    return released;
  }

  releaseDocument(documentId: string): void {
    for (const [id, lease] of [...this.leases]) {
      if (lease.documentId !== documentId) continue;
      this.leases.delete(id);
      lease.release();
    }
  }

  get size(): number {
    return this.leases.size;
  }
}

const compositeLeaseTracker = new CompositeLeaseTracker();

export function releaseInactiveCompositeLeases(now = Date.now(), idleMs = 30_000): number {
  return compositeLeaseTracker.releaseInactive(now, idleMs);
}

export function compositeLeaseCount(): number {
  return compositeLeaseTracker.size;
}
