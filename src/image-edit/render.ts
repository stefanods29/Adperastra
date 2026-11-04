import { getImageTileStore } from "./tiles";
import { fail, newUuid, sourceSizeOf, type ImageModel, type ImageRenderLease, type RasterLayer, type Rect } from "./types";
import { renderPixels } from "./worker";
import type { RenderWorkerFailure, RenderWorkerRequest, RenderWorkerResult, WorkerTile } from "./workerTypes";

/** E3: bounded preview rendering. Output edge is at most 8192 px; the
 * production path runs in a per-document worker. The returned lease owns one
 * `ImageBitmap`; `release` is idempotent and never touches the document. */

export interface RenderOptions {
  edge: number;
  region?: Rect;
  compare_original: boolean;
}

const workers = new Map<string, { worker: Worker; pending: Map<string, { resolve: (value: RenderWorkerResult) => void; reject: (error: Error) => void }> }>();

function workerFor(documentId: string): Worker | null {
  if (typeof Worker === "undefined") return null;
  const existing = workers.get(documentId);
  if (existing) return existing.worker;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  const pending = new Map<string, { resolve: (value: RenderWorkerResult) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<RenderWorkerResult | RenderWorkerFailure>) => {
    const message = event.data;
    const entry = pending.get(message.request_id);
    if (!entry) return;
    pending.delete(message.request_id);
    if (message.type === "failure") entry.reject(new Error(message.error));
    else entry.resolve(message);
  };
  workers.set(documentId, { worker, pending });
  return worker;
}

export function disposeRenderWorker(documentId: string): void {
  const entry = workers.get(documentId);
  if (!entry) return;
  for (const pending of entry.pending.values()) pending.reject(new Error("image_edit.failed"));
  entry.worker.terminate();
  workers.delete(documentId);
}

export async function collectRenderTiles(model: Readonly<ImageModel>): Promise<WorkerTile[]> {
  const refs = new Map<string, ImageModel["original_tiles"][number]>();
  for (const tile of model.original_tiles) refs.set(tile.id, tile);
  for (const layer of model.layers) if (layer.kind === "raster") for (const tile of layer.tiles) refs.set(tile.id, tile);
  const store = getImageTileStore(model.document_id);
  const tiles: WorkerTile[] = [];
  for (const ref of refs.values()) {
    const bytes = await store.read(ref.id);
    tiles.push({ ref, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
  return tiles;
}

function createLease(width: number, height: number, rgba: Uint8Array): Promise<ImageRenderLease> {
  if (rgba.byteLength !== width * height * 4) return Promise.reject(new Error("image_edit.failed"));
  const image = new ImageData(new Uint8ClampedArray(rgba), width, height);
  if (typeof createImageBitmap !== "function") return Promise.reject(new Error("image_edit.failed"));
  return createImageBitmap(image).then((bitmap) => {
    let released = false;
    return {
      id: newUuid(),
      width,
      height,
      bitmap,
      release: () => {
        if (released) return;
        released = true;
        if (typeof bitmap.close === "function") bitmap.close();
      },
    };
  });
}

/** Runs the pixel kernel in the document's worker and returns owned bytes.
 * The encoded-capture path uses this so a full render never blocks the UI. */
export async function renderPixelsInWorker(
  request: RenderWorkerRequest,
): Promise<{ width: number; height: number; rgba: Uint8Array; textPending: boolean }> {
  const worker = workerFor(request.document_id);
  const entry = workers.get(request.document_id);
  if (!worker || !entry) {
    const result = renderPixels(request);
    return { width: result.width, height: result.height, rgba: result.rgba, textPending: result.textPending };
  }
  return await new Promise((resolve, reject) => {
    entry.pending.set(request.request_id, {
      resolve: (result) =>
        resolve({
          width: result.width,
          height: result.height,
          rgba: new Uint8Array(result.rgba),
          textPending: result.text_pending,
        }),
      reject,
    });
    const transfer = request.tiles.map((tile) => tile.bytes);
    worker.postMessage(request, transfer);
  });
}

export async function renderImage(model: Readonly<ImageModel>, options: RenderOptions): Promise<ImageRenderLease> {
  if (!options || !Number.isFinite(options.edge) || options.edge < 1 || options.edge > 8192) fail("image_edit.bad_request");
  if (options.region) {
    const { x, y, width, height } = options.region;
    if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) fail("image_edit.bad_request");
  }
  const source = sourceSizeOf(model);
  const base = model.layers[0];
  if (!base || base.kind !== "raster") fail("image_edit.bad_request");
  const tiles = await collectRenderTiles(model);
  const request: RenderWorkerRequest = {
    type: "render",
    request_id: newUuid(),
    document_id: model.document_id,
    source_size: source,
    layer_tiles: (base as RasterLayer).tiles,
    original_tiles: model.original_tiles,
    geometry: model.geometry,
    adjustments: model.adjustments,
    overlays: model.overlays,
    edge: options.edge,
    region: options.region,
    compare_original: options.compare_original,
    tiles,
  };
  const worker = workerFor(model.document_id);
  if (worker) {
    const entry = workers.get(model.document_id);
    if (entry) {
      return await new Promise<ImageRenderLease>((resolve, reject) => {
        entry.pending.set(request.request_id, {
          resolve: (result) => {
            createLease(result.width, result.height, new Uint8Array(result.rgba)).then(resolve, reject);
          },
          reject,
        });
        const transfer = request.tiles.map((tile) => tile.bytes);
        worker.postMessage(request, transfer);
      });
    }
  }
  const result = renderPixels(request);
  return createLease(result.width, result.height, result.rgba);
}

/** Compare helper: renders the untouched oriented source, never a document
 * revision. Used by the Compare button and its tests. */
export function compareModels(left: Readonly<ImageModel>, right: Readonly<ImageModel>): boolean {
  return left.content_id === right.content_id;
}
