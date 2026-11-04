import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  appendExportSnapshot,
  beginExportSnapshot,
  finishExportSnapshot,
  releaseExportSnapshot,
} from "../services/exportSnapshots";
import { compositePixels, layerPixels } from "./composite";
import { materializeSelection, validateSelectionTile } from "./selectionRaster";
import { validateSelectionMask, type SelectionMask } from "./selectionTypes";
import {
  fail,
  MAX_SNAPSHOT_BYTES,
  sourceSizeOf,
  type ImageModel,
  type ImageSize,
  type Rect,
} from "./types";

/** E4: copy selected pixels as one encoded PNG snapshot. The model and
 * captured revision are immutable inputs; no current revision is read after
 * encoding starts. Selection masks are canvas-coordinate alpha8. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(result.subarray(4, 8 + data.byteLength)));
  return result;
}

/** A valid zlib stream with stored (uncompressed) DEFLATE blocks. This keeps
 * the selection encoder deterministic in tests and environments without
 * CompressionStream; the encoded-size cap is checked before publication. */
export function zlibStore(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.byteLength / 65_535));
  const output = new Uint8Array(2 + blocks * 5 + bytes.byteLength + 4);
  output[0] = 0x78;
  output[1] = 0x01;
  let inputOffset = 0;
  let outputOffset = 2;
  for (let block = 0; block < blocks; block += 1) {
    const length = Math.min(65_535, bytes.byteLength - inputOffset);
    output[outputOffset] = block === blocks - 1 ? 0x01 : 0x00;
    output[outputOffset + 1] = length & 0xff;
    output[outputOffset + 2] = (length >>> 8) & 0xff;
    output[outputOffset + 3] = ~length & 0xff;
    output[outputOffset + 4] = (~length >>> 8) & 0xff;
    output.set(bytes.subarray(inputOffset, inputOffset + length), outputOffset + 5);
    inputOffset += length;
    outputOffset += 5 + length;
  }
  const adler = adler32(bytes);
  output[outputOffset] = (adler >>> 24) & 0xff;
  output[outputOffset + 1] = (adler >>> 16) & 0xff;
  output[outputOffset + 2] = (adler >>> 8) & 0xff;
  output[outputOffset + 3] = adler & 0xff;
  return output;
}

/** Exported for the pixel test and for the future native encoder bridge. */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail("image_layers.bad_request");
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== width * height * 4) fail("image_layers.bad_request");
  if (width * height * 4 > MAX_SNAPSHOT_BYTES) fail("snapshots.too_large");
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const compressed = zlibStore(raw);
  const idatChunks: Uint8Array[] = [];
  for (let offset = 0; offset < compressed.byteLength; offset += 1024 * 1024) {
    idatChunks.push(chunk("IDAT", compressed.subarray(offset, Math.min(compressed.byteLength, offset + 1024 * 1024))));
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...idatChunks,
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total > MAX_SNAPSHOT_BYTES) fail("snapshots.too_large");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export interface SelectionPixels {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function selectionRect(selection: SelectionMask): Rect {
  if (!selection.bounds) fail("image_layers.bad_request");
  return { ...selection.bounds };
}

/** Pure pixel extraction, before PNG encoding. */
export async function selectedPixelsRgba(
  model: Readonly<ImageModel>,
  selection: SelectionMask,
  layerId: string | null,
): Promise<SelectionPixels> {
  const source = sourceSizeOf(model);
  validateSelectionMask(selection, source);
  const bounds = selectionRect(selection);
  if (bounds.width * bounds.height * 4 > MAX_SNAPSHOT_BYTES) fail("snapshots.too_large");
  // The bounds are integer canvas pixels; reject a changed/hand-built mask
  // rather than silently rounding arbitrary document coordinates.
  if (
    !Number.isInteger(bounds.x) ||
    !Number.isInteger(bounds.y) ||
    !Number.isInteger(bounds.width) ||
    !Number.isInteger(bounds.height)
  ) {
    fail("image_layers.bad_request");
  }
  for (const tile of selection.tiles) validateSelectionTile(tile, selection.width, selection.height);
  const pixels =
    layerId === null
      ? await compositePixels(model, bounds)
      : await layerPixels(model, layerId, bounds);
  const coverageAlpha = materializeSelection(selection);
  const output = new Uint8Array(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row += 1) {
    for (let column = 0; column < bounds.width; column += 1) {
      const coverage = coverageAlpha[(bounds.y + row) * selection.width + bounds.x + column] / 255;
      if (coverage <= 0) continue;
      const sourceOffset = (row * pixels.width + column) * 4;
      const outputOffset = (row * bounds.width + column) * 4;
      const alpha = Math.round(pixels.rgba[sourceOffset + 3] * coverage);
      if (alpha <= 0) continue;
      output[outputOffset] = pixels.rgba[sourceOffset];
      output[outputOffset + 1] = pixels.rgba[sourceOffset + 1];
      output[outputOffset + 2] = pixels.rgba[sourceOffset + 2];
      output[outputOffset + 3] = alpha;
    }
  }
  return { width: bounds.width, height: bounds.height, rgba: output };
}

export function selectedPixelsSize(selection: SelectionMask): ImageSize {
  const rect = selectionRect(selection);
  return { width: rect.width, height: rect.height };
}

/** E4. Encoded PNG only; the immutable model supplies document_id/content_id
 * and the caller supplies the revision captured atomically with that model. */
export async function selectedPixels(
  model: Readonly<ImageModel>,
  capturedRevision: number,
  selection: SelectionMask,
  layerId: string | null,
): Promise<ExportSnapshot> {
  if (!Number.isSafeInteger(capturedRevision) || capturedRevision < 1) fail("image_layers.bad_request");
  if (typeof model.content_id !== "string" || model.content_id.length === 0) fail("image_layers.bad_request");
  const pixels = await selectedPixelsRgba(model, selection, layerId);
  const bytes = encodePngRgba(pixels.width, pixels.height, pixels.rgba);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) fail("snapshots.too_large");
  const begun = await beginExportSnapshot({
    document_id: model.document_id,
    revision: capturedRevision,
    content_id: model.content_id,
    mime: "image/png",
    byte_len: bytes.byteLength,
  });
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
      await appendExportSnapshot(
        begun.snapshot_id,
        begun.upload_token,
        offset,
        bytes.subarray(offset, Math.min(bytes.byteLength, offset + 1024 * 1024)),
      );
    }
    return await finishExportSnapshot(begun.snapshot_id);
  } catch (error) {
    await releaseExportSnapshot(begun.snapshot_id).catch(() => undefined);
    throw error;
  }
}
