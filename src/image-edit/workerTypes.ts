import type { ImageAdjustments, ImageGeometry, ImageOverlay, ImageSize, Rect, TileRef } from "./types";

/** Messages between the editor and its rendering worker. Fields are imported
 * from `types.ts`; this file adds only the transport envelope. Bytes are
 * transferred as `ArrayBuffer`s, never JSON numbers. */

export interface WorkerTile {
  ref: TileRef;
  /** Owned copy of the tile's RGBA bytes. */
  bytes: ArrayBuffer;
}

export interface RenderWorkerRequest {
  type: "render";
  request_id: string;
  document_id: string;
  source_size: ImageSize;
  layer_tiles: TileRef[];
  original_tiles: TileRef[];
  geometry: ImageGeometry;
  adjustments: ImageAdjustments;
  overlays: ImageOverlay[];
  /** Maximum edge in output pixels, 1..8192. */
  edge: number;
  region?: Rect;
  compare_original: boolean;
  tiles: WorkerTile[];
}

export interface RenderWorkerResult {
  type: "result";
  request_id: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
  text_pending: boolean;
}

export interface RenderWorkerFailure {
  type: "failure";
  request_id: string;
  error: string;
}
