/**
 * Pure AI-upscale UI logic and the one Apply transaction (Step 14c, E6).
 * A preview only reads an immutable artifact; it never marks a document dirty.
 */

import type { ConversionInput } from "../convert/types";
import { errorCode } from "../services/errors";
import { describeAiArtifact, readAiArtifact, releaseAiArtifact } from "../services/localAiArtifacts";
import type { AiTaskResult, AiDevice, ImageRect, UpscaleModel, UpscaleScale } from "../services/localAiTypes";
import { isUpscaleResult } from "../services/localAiTypes";
import type { TileRef } from "../image-edit/types";

const GIB = 1_073_741_824;
export const PREVIEW_SOURCE_EDGE = 256;
export const PREVIEW_OUTPUT_EDGE = 1_024;
export const MAX_AI_ARTIFACT_CHUNK = 8 * 1024 * 1024;

export interface UpscaleUiOptions {
  scale: UpscaleScale;
  model: UpscaleModel;
  device: AiDevice;
  region: ImageRect | null;
}

export interface UpscaleOptionState {
  revision: number;
  options: UpscaleUiOptions;
}

export function initialUpscaleState(region: ImageRect | null = null): UpscaleOptionState {
  return {
    revision: 1,
    options: { scale: 4, model: "general", device: "auto", region },
  };
}

/** Every option change invalidates older previews immediately. */
export function updateUpscaleOptions(
  state: UpscaleOptionState,
  patch: Partial<UpscaleUiOptions>,
): UpscaleOptionState {
  return { revision: state.revision + 1, options: { ...state.options, ...patch } };
}

export interface PreviewEnvelope {
  revision: number;
  contentId: string | null;
  result: AiTaskResult;
}

/**
 * A result is displayable only when both its option revision and its captured
 * content identity are current. An older generation never wins a race.
 */
export function canDisplayPreview(
  preview: PreviewEnvelope | null,
  currentRevision: number,
  expectedContentId: string | null,
): boolean {
  return Boolean(
    preview &&
      preview.revision === currentRevision &&
      !(expectedContentId !== null && preview.contentId !== expectedContentId) &&
      isUpscaleResult(preview.result),
  );
}

export function defaultCrop(width: number, height: number): ImageRect {
  if (width <= 0 || height <= 0) throw new Error("ai.bad_request");
  if (width <= PREVIEW_SOURCE_EDGE && height <= PREVIEW_SOURCE_EDGE) {
    return { x: 0, y: 0, width, height };
  }
  const side = Math.min(width, height, PREVIEW_SOURCE_EDGE);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side };
}

export function validateCrop(region: ImageRect, width: number, height: number): boolean {
  return (
    Number.isInteger(region.x) &&
    Number.isInteger(region.y) &&
    Number.isInteger(region.width) &&
    Number.isInteger(region.height) &&
    region.width > 0 &&
    region.height > 0 &&
    region.width <= PREVIEW_SOURCE_EDGE &&
    region.height <= PREVIEW_SOURCE_EDGE &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.x + region.width <= width &&
    region.y + region.height <= height
  );
}

export function outputDimensions(
  region: ImageRect,
  scale: UpscaleScale,
): { width: number; height: number } {
  return { width: region.width * scale, height: region.height * scale };
}

/** Keyboard Compare: arrows 1, Shift+arrow 10, Home 0, End 100. */
export function comparisonKeyboard(current: number, key: string, shift: boolean): number {
  const step = shift ? 10 : 1;
  if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, current - step);
  if (key === "ArrowRight" || key === "ArrowUp") return Math.min(100, current + step);
  if (key === "Home") return 0;
  if (key === "End") return 100;
  return current;
}

/** ETA only after three completed tiles of the same model/device. */
export function approximateEta(
  completedTiles: number,
  elapsedMs: number,
  remainingTiles: number,
): number | null {
  if (completedTiles < 3 || elapsedMs <= 0 || remainingTiles <= 0) return null;
  return Math.round((elapsedMs / completedTiles) * remainingTiles);
}

export function recommendUpscaleDevice(vramBytes: number | null): AiDevice {
  return vramBytes !== null && vramBytes >= GIB ? "auto" : "cpu";
}

/** Read a whole immutable image artifact in 8 MiB public ranges. */
export async function readWholeArtifact(id: string): Promise<Uint8Array> {
  const info = await describeAiArtifact(id);
  if (info.kind !== "image" || info.byte_len === 0 || info.byte_len > Number.MAX_SAFE_INTEGER) {
    throw new Error("ai.model_output");
  }
  const out = new Uint8Array(info.byte_len);
  let offset = 0;
  while (offset < info.byte_len) {
    const length = Math.min(MAX_AI_ARTIFACT_CHUNK, info.byte_len - offset);
    const chunk = await readAiArtifact(id, offset, length);
    out.set(chunk, offset);
    offset += length;
  }
  return out;
}

async function pngToRgba(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const blob = new Blob([bytes.slice().buffer], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("ai.failed");
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close();
  return { width: canvas.width, height: canvas.height, rgba: new Uint8Array(data) };
}

/**
 * Apply one accepted suggestion to the open image. The content identity is
 * checked by the shared 14b transaction; a mismatch becomes `ai.source_changed`.
 * Exactly one transaction and therefore one Undo entry is created.
 */
export async function applyUpscale(
  documentId: string,
  expectedContentId: string,
  result: AiTaskResult,
): Promise<void> {
  if (!isUpscaleResult(result)) throw new Error("ai.model_output");
  if (result.result.mime !== "image/png") throw new Error("ai.model_output");
  if (!documentId || !expectedContentId) throw new Error("ai.bad_request");
  const bytes = await readWholeArtifact(result.result.artifact_id);
  const decoded = await pngToRgba(bytes);
  if (decoded.width !== result.result.width || decoded.height !== result.result.height) {
    throw new Error("ai.model_output");
  }
  const { getImageTileStore } = await import("../image-edit/tiles");
  const { commitImageTransaction } = await import("../image-edit/transactions");
  const store = getImageTileStore(documentId);
  const tiles: TileRef[] = [];
  for (let y = 0; y < decoded.height; y += 256) {
    for (let x = 0; x < decoded.width; x += 256) {
      const width = Math.min(256, decoded.width - x);
      const height = Math.min(256, decoded.height - y);
      const rgba = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        const source = ((y + row) * decoded.width + x) * 4;
        rgba.set(decoded.rgba.subarray(source, source + width * 4), row * width * 4);
      }
      tiles.push(await store.publish(width, height, rgba));
    }
  }
  try {
    await commitImageTransaction(documentId, expectedContentId, (current) => {
      const raster = current.layers[0];
      if (!raster || raster.kind !== "raster") throw new Error("image_edit.bad_request");
      return {
        ...current,
        width: decoded.width,
        height: decoded.height,
        original_tiles: tiles,
        layers: [{ ...raster, tiles }],
        geometry: {
          crop: { x: 0, y: 0, width: decoded.width, height: decoded.height },
          quarter_turns: 0,
          angle_degrees: 0,
          flip_x: false,
          flip_y: false,
          output_size: { width: decoded.width, height: decoded.height },
        },
        adjustments: {
          preset: "original",
          brightness: 0,
          contrast: 0,
          saturation: 0,
          warmth: 0,
          sharpness: 0,
          blur: 0,
        },
        overlays: [],
      };
    });
  } catch (error) {
    // Published tiles are immutable and become unreferenced; the controller
    // releases them with the document. No undo entry exists on failure.
    if (errorCode(error) === "image_edit.changed") {
      throw new Error("ai.source_changed");
    }
    throw error;
  } finally {
    await releaseAiArtifact(result.result.artifact_id).catch(() => undefined);
  }
}

/** The preview may only show a snapshot, never a bare unauthorized path. */
export function previewInput(input: ConversionInput): ConversionInput {
  if (input.kind === "file") throw new Error("ai.bad_request");
  return input;
}

/** Compare the captured content id with the document's current identity. */
export function assertApplyIdentity(
  expectedContentId: string,
  capturedContentId: string | null,
): void {
  if (!capturedContentId || capturedContentId !== expectedContentId) {
    throw new Error("ai.source_changed");
  }
}

/** Only call this when the user explicitly discards a preview. */
export async function discardPreview(artifactId: string): Promise<void> {
  await releaseAiArtifact(artifactId).catch(() => undefined);
}
