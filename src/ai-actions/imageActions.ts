import type { AiActionOptions } from "../services/aiActionTypes";
import type { ImageModel, RasterLayer, TileRef } from "../image-edit/types";
import { commitImageTransaction } from "../image-edit/transactions";
import { getImageTileStore, publishCanvasTiles } from "../image-edit/tiles";
import type { AiActionResult } from "../services/aiActionTypes";
import { AI_ACTION_MAX_ARTIFACT_BYTES } from "../services/aiActionTypes";
import { getAiActionResult } from "../services/aiActions";
import { describeAiArtifact, readAiArtifact } from "../services/localAiArtifacts";

/**
 * Applies one local image suggestion to an open 14b image (`ai-actions-1` E5).
 *
 * The original is untouched until this call, Apply is exactly one Undo entry
 * and a changed content identity refuses the stale suggestion. The suggestion
 * itself is never a file: bytes arrive through the 14c artifact lease.
 */

export type ImageActionId = "remove_background" | "blur_background" | "erase_object";

const MAX_MODEL_EDGE = 32_768;
const MAX_MODEL_PIXELS = 100_000_000;

interface DecodedRgba {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function newUuid(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0")}`;
}

async function readArtifactBytes(artifactId: string): Promise<Uint8Array> {
  const info = await describeAiArtifact(artifactId);
  if (!info || !Number.isFinite(info.byte_len) || info.byte_len <= 0) {
    throw new Error("ai_actions.invalid");
  }
  if (info.byte_len > AI_ACTION_MAX_ARTIFACT_BYTES) throw new Error("ai_actions.too_large");
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  while (offset < info.byte_len) {
    const length = Math.min(8 * 1024 * 1024, info.byte_len - offset);
    const chunk = await readAiArtifact(artifactId, offset, length);
    if (!chunk || chunk.byteLength !== length) throw new Error("ai_actions.invalid");
    chunks.push(chunk);
    offset += length;
    total += chunk.byteLength;
    if (total > AI_ACTION_MAX_ARTIFACT_BYTES) throw new Error("ai_actions.too_large");
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return bytes;
}

/** Decodes the PNG artifact without any remote or blob URL in the CSP. */
export async function decodePngToRgba(bytes: Uint8Array): Promise<DecodedRgba> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "image/png" });
  if (typeof createImageBitmap !== "function") throw new Error("ai_actions.unsupported");
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("ai_actions.invalid");
    }
    if (width > MAX_MODEL_EDGE || height > MAX_MODEL_EDGE || width * height > MAX_MODEL_PIXELS) {
      throw new Error("ai_actions.too_large");
    }
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const context = (canvas as OffscreenCanvas).getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!context) throw new Error("ai_actions.unsupported");
    context.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    const data = context.getImageData(0, 0, width, height);
    return { width, height, rgba: new Uint8Array(data.data.buffer.slice(0)) };
  } finally {
    bitmap.close?.();
  }
}

function baseLayer(model: Readonly<ImageModel>): RasterLayer {
  if (model.layers.length !== 1 || model.layers[0].kind !== "raster") {
    throw new Error("ai_actions.unsupported");
  }
  return model.layers[0];
}

function retainedTileIds(model: Readonly<ImageModel>): string[] {
  const ids = model.original_tiles.map((tile) => tile.id);
  for (const layer of model.layers) {
    if (layer.kind === "raster") ids.push(...layer.tiles.map((tile) => tile.id));
  }
  return ids;
}

export interface ApplyImageOptions {
  /** Injected only by tests; production always uses the 14c functions. */
  loader?: (result: AiActionResult) => Promise<DecodedRgba>;
}

/**
 * One Apply = one transaction: new tiles are published first, then the
 * compare-and-commit either replaces them once or releases them.
 */
export async function applyAiImageResult(
  documentId: string,
  expectedContentId: string,
  resultId: string,
  options: ApplyImageOptions = {},
): Promise<void> {
  if (typeof documentId !== "string" || documentId.length === 0) throw new Error("ai_actions.invalid");
  if (typeof expectedContentId !== "string" || expectedContentId.length === 0) {
    throw new Error("ai_actions.invalid");
  }
  if (typeof resultId !== "string" || resultId.length === 0) throw new Error("ai_actions.invalid");
  const result = await getAiActionResult(resultId);
  if (result.payload.kind !== "image") throw new Error("ai_actions.unsupported");
  if (result.action === "upscale") throw new Error("ai_actions.unsupported");
  const payload = result.payload.image;
  if (!Number.isInteger(payload.width) || !Number.isInteger(payload.height)) {
    throw new Error("ai_actions.invalid");
  }
  const decoded = options.loader
    ? await options.loader(result)
    : await decodePngToRgba(await readArtifactBytes(payload.artifact_id));
  if (decoded.width !== payload.width || decoded.height !== payload.height) {
    throw new Error("ai_actions.invalid");
  }
  if (decoded.rgba.byteLength !== decoded.width * decoded.height * 4) {
    throw new Error("ai_actions.invalid");
  }
  const store = getImageTileStore(documentId);
  const tiles: TileRef[] = await publishCanvasTiles(store, decoded.width, decoded.height, decoded.rgba);
  let retained: string[] = [];
  try {
    await commitImageTransaction(documentId, expectedContentId, (current) => {
      if (current.width !== decoded.width || current.height !== decoded.height) {
        throw new Error("ai_actions.source_changed");
      }
      const layer = baseLayer(current);
      retained = retainedTileIds(current);
      return {
        ...current,
        content_id: newUuid(),
        layers: [{ ...layer, tiles }],
      };
    });
  } catch (error) {
    store.releaseUnreferenced(retained);
    throw error;
  }
}

/** Request options for an image action; one place, so the UI cannot drift. */
export function imageActionOptions(action: ImageActionId, radius?: number): AiActionOptions {
  if (action === "remove_background") return { kind: "remove_background" };
  if (action === "blur_background") {
    const value = Number.isInteger(radius) ? (radius as number) : 16;
    if (value < 1 || value > 64) throw new Error("ai_actions.invalid");
    return { kind: "blur_background", radius: value };
  }
  throw new Error("ai_actions.invalid");
}
