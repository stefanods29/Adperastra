import { invoke } from "@tauri-apps/api/core";
import type { MetadataCategory } from "../convert/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type { DocumentHandle } from "../documents/types";
import { appendExportSnapshot, beginExportSnapshot, finishExportSnapshot, releaseExportSnapshot } from "../services/exportSnapshots";
import { startDocumentCommit, type DocumentCommitResult } from "../services/documents";
import { isTauriRuntime } from "../services/settings";
import { collectRenderTiles, renderPixelsInWorker } from "./render";
import { compositeRegion } from "./composite";
import { readImageMetadata } from "./metadata";
import {
  fail,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  MAX_SNAPSHOT_BYTES,
  sourceSizeOf,
  type ImageModel,
  type MetadataBlobRef,
  type TileRef,
} from "./types";

/** Encoded capture (D9/T6). A snapshot always carries encoded bytes, never a
 * raw RGBA payload. The native encoder handles bounded RGBA bodies through a
 * raw IPC channel; the WebView PNG/JPEG/WebP writers remain the fallback and
 * the only path that embeds metadata chunks. */

export type CaptureMime = "image/png" | "image/jpeg" | "image/webp";

export interface EncodeOptions {
  mime: CaptureMime;
  quality?: number;
  background_rgba?: [number, number, number, number];
  metadata_keep?: boolean;
  accepted_losses?: MetadataCategory[];
}

export interface EncodePlan {
  mime: CaptureMime;
  payload_kind: "encoded";
  alpha_preserved: boolean;
  background: [number, number, number, number] | null;
  metadata_kept: MetadataCategory[];
  metadata_lost: MetadataCategory[];
  /** Mirrors the native `image_encode::EncodePlan` policy fields. */
  icc_preserved: boolean;
  metadata_loss_accepted: boolean;
  max_encoded_bytes: number;
  width: number;
  height: number;
}

/** The TypeScript PNG writer embeds eXIf/iCCP/iTXt chunks. The bounded
 * canvas JPEG/WebP writers do not embed metadata, so they declare every
 * category lost instead of pretending it was kept. The native adapter may
 * widen this table once its preservation is proven. */
const MIME_CATEGORIES: Record<CaptureMime, readonly MetadataCategory[]> = {
  "image/png": ["exif", "icc", "xmp"],
  "image/jpeg": [],
  "image/webp": [],
};

export function isCaptureMime(value: string): value is CaptureMime {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

/** Pure policy: alpha, background, metadata keep/loss and the encoded cap. */
export function planEncoding(model: Readonly<ImageModel>, options: EncodeOptions): EncodePlan {
  if (!options || !isCaptureMime(options.mime)) fail("image_edit.bad_request");
  if (!Number.isInteger(model.width) || !Number.isInteger(model.height) || model.width < 1 || model.height < 1) {
    fail("image_edit.bad_request");
  }
  if (model.width > MAX_IMAGE_EDGE || model.height > MAX_IMAGE_EDGE || model.width * model.height > MAX_IMAGE_PIXELS) {
    fail("image_edit.too_large");
  }
  const quality = options.quality ?? 90;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) fail("image_edit.bad_request");
  const supportsAlpha = options.mime !== "image/jpeg";
  const background = supportsAlpha ? null : (options.background_rgba ?? [255, 255, 255, 255]);
  if (background) {
    for (const channel of background) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_edit.bad_request");
    }
  }
  const metadataKeep = options.metadata_keep !== false;
  const sourceCategories = new Set(model.metadata.map((blob) => blob.category));
  const supported = new Set(MIME_CATEGORIES[options.mime]);
  const metadataKept: MetadataCategory[] = [];
  const metadataLost: MetadataCategory[] = [];
  for (const category of sourceCategories) {
    if (metadataKeep && supported.has(category)) metadataKept.push(category);
    else metadataLost.push(category);
  }
  const accepted = new Set(options.accepted_losses ?? []);
  for (const category of metadataLost) {
    if (!accepted.has(category)) throw new Error("convert.metadata_loss");
  }
  return {
    mime: options.mime,
    payload_kind: "encoded",
    alpha_preserved: supportsAlpha,
    background,
    metadata_kept: metadataKept,
    metadata_lost: metadataLost,
    icc_preserved: metadataKept.includes("icc"),
    metadata_loss_accepted: metadataLost.length > 0 && metadataLost.every((category) => accepted.has(category)),
    max_encoded_bytes: MAX_SNAPSHOT_BYTES,
    width: model.width,
    height: model.height,
  };
}

/** Mirrors `image_encode::ImageEncodePolicy`. The native encoder writes no
 * metadata chunks, so `icc_preserved` is always false and only a source ICC
 * profile can be reported as lost. */
export interface NativeEncodePolicy {
  mime: CaptureMime;
  payload_kind: "encoded";
  width: number;
  height: number;
  alpha_preserved: boolean;
  background: [number, number, number, number] | null;
  icc_preserved: boolean;
  metadata_kept: MetadataCategory[];
  metadata_lost: MetadataCategory[];
  metadata_loss_accepted: boolean;
  max_encoded_bytes: number;
}

/** Asks the native encoder for its exact policy. A source ICC profile
 * without an accepted loss throws `convert.metadata_loss`, so the caller
 * keeps the PNG metadata writer instead of silently stripping it. */
export async function planNativeEncoding(
  width: number,
  height: number,
  options: EncodeOptions,
  sourceHasIcc: boolean,
  acceptedMetadataLoss: boolean,
): Promise<NativeEncodePolicy> {
  if (!isTauriRuntime()) throw new Error("image_edit.unsupported");
  return (await invoke("image_encode_plan", {
    request: {
      mime: options.mime,
      width,
      height,
      quality: options.quality ?? 90,
      background_rgba: options.background_rgba ?? [255, 255, 255, 255],
      source_has_icc: sourceHasIcc,
      accepted_metadata_loss: acceptedMetadataLoss,
    },
  })) as NativeEncodePolicy;
}

/** Sends one bounded RGBA buffer as a raw IPC body (never JSON) and returns
 * the encoded bytes as a raw response. The 256 MiB cap is checked on both
 * sides; 08a reserves exactly the returned length before publishing. */
async function encodeNativeRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
  options: EncodeOptions,
  sourceHasIcc: boolean,
  acceptedMetadataLoss: boolean,
): Promise<Uint8Array> {
  if (!isTauriRuntime()) throw new Error("image_edit.unsupported");
  if (rgba.byteLength === 0 || rgba.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("image_edit.too_large");
  }
  const background = options.background_rgba ?? [255, 255, 255, 255];
  const response = await invoke<ArrayBuffer>("image_encode", rgba, {
    headers: {
      "x-adp-image-mime": options.mime,
      "x-adp-image-width": String(width),
      "x-adp-image-height": String(height),
      "x-adp-image-quality": String(options.quality ?? 90),
      "x-adp-image-background": background.join(","),
      "x-adp-image-source-has-icc": sourceHasIcc ? "1" : "0",
      "x-adp-image-accepted-metadata-loss": acceptedMetadataLoss ? "1" : "0",
    },
  });
  const bytes = new Uint8Array(response);
  if (bytes.byteLength === 0) throw new Error("image_edit.failed");
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("snapshots.too_large");
  return bytes;
}

/** Native encoding is an optimization: it is used only when no metadata must
 * be embedded and the RGBA buffer fits the 256 MiB body cap. Any refusal or
 * failure falls back to the bounded WebView encoder below. */
async function tryNativeEncode(
  model: Readonly<ImageModel>,
  plan: EncodePlan,
  width: number,
  height: number,
  rgba: Uint8Array,
  options: EncodeOptions,
): Promise<Uint8Array | null> {
  if (!isTauriRuntime()) return null;
  if (rgba.byteLength === 0 || rgba.byteLength > MAX_SNAPSHOT_BYTES) return null;
  if (plan.metadata_kept.length > 0) return null;
  const sourceHasIcc = model.metadata.some((blob) => blob.category === "icc");
  try {
    const policy = await planNativeEncoding(
      width,
      height,
      options,
      sourceHasIcc,
      plan.metadata_loss_accepted,
    );
    if (policy.payload_kind !== "encoded" || policy.icc_preserved) return null;
    return await encodeNativeRgba(
      width,
      height,
      rgba,
      options,
      sourceHasIcc,
      plan.metadata_loss_accepted,
    );
  } catch {
    return null;
  }
}

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

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)));
  return chunk;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const Compression = (globalThis as unknown as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!Compression) throw new Error("image_edit.failed");
  const stream = new Compression("deflate");
  const writer = stream.writable.getWriter();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();
  const writeBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await writer.write(writeBuffer);
  await writer.close();
  await pump;
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function metadataChunks(model: Readonly<ImageModel>, plan: EncodePlan): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for (const blob of model.metadata) {
    if (!plan.metadata_kept.includes(blob.category)) continue;
    const bytes = await readImageMetadata(model.document_id, blob.id);
    if (blob.category === "icc") {
      const compressed = await deflate(bytes);
      const name = new TextEncoder().encode("ICC Profile");
      const data = new Uint8Array(name.byteLength + 2 + compressed.byteLength);
      data.set(name, 0);
      data[name.byteLength] = 0;
      data[name.byteLength + 1] = 0;
      data.set(compressed, name.byteLength + 2);
      chunks.push(pngChunk("iCCP", data));
    } else if (blob.category === "exif") {
      chunks.push(pngChunk("eXIf", bytes));
    } else if (blob.category === "xmp") {
      const keyword = new TextEncoder().encode("XML:com.adobe.xmp");
      const data = new Uint8Array(keyword.byteLength + 5 + bytes.byteLength);
      data.set(keyword, 0);
      // keyword NUL, compression flag 0, method 0, empty language and
      // translated keyword, then the UTF-8 XMP packet.
      data[keyword.byteLength] = 0;
      data[keyword.byteLength + 1] = 0;
      data[keyword.byteLength + 2] = 0;
      data[keyword.byteLength + 3] = 0;
      data[keyword.byteLength + 4] = 0;
      data.set(bytes, keyword.byteLength + 5);
      chunks.push(pngChunk("iTXt", data));
    }
  }
  return chunks;
}

async function encodePng(
  model: Readonly<ImageModel>,
  width: number,
  height: number,
  rgba: Uint8Array,
  plan: EncodePlan,
): Promise<Uint8Array> {
  if (rgba.byteLength !== width * height * 4) throw new Error("image_edit.bad_request");
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const compressed = await deflate(raw);
  const chunks: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...(await metadataChunks(model, plan)),
  ];
  for (let offset = 0; offset < compressed.byteLength; offset += 1024 * 1024) {
    chunks.push(pngChunk("IDAT", compressed.subarray(offset, Math.min(compressed.byteLength, offset + 1024 * 1024))));
  }
  chunks.push(pngChunk("IEND", new Uint8Array(0)));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (total > MAX_SNAPSHOT_BYTES) throw new Error("snapshots.too_large");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function compositeBackground(rgba: Uint8Array, background: [number, number, number, number]): Uint8Array {
  const output = new Uint8Array(rgba.byteLength);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    const alpha = rgba[offset + 3] / 255;
    output[offset] = Math.round(rgba[offset] * alpha + background[0] * (1 - alpha));
    output[offset + 1] = Math.round(rgba[offset + 1] * alpha + background[1] * (1 - alpha));
    output[offset + 2] = Math.round(rgba[offset + 2] * alpha + background[2] * (1 - alpha));
    output[offset + 3] = 255;
  }
  return output;
}

async function encodeWithCanvas(
  width: number,
  height: number,
  rgba: Uint8Array,
  mime: "image/jpeg" | "image/webp",
  quality: number,
  background: [number, number, number, number] | null,
): Promise<Uint8Array> {
  const Offscreen = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  if (!Offscreen) throw new Error("image_edit.failed");
  const canvas = new Offscreen(width, height);
  const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("image_edit.failed");
  const pixels = background ? compositeBackground(rgba, background) : rgba;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
  if (blob.size > MAX_SNAPSHOT_BYTES) throw new Error("snapshots.too_large");
  return new Uint8Array(await blob.arrayBuffer());
}

function fullRenderRequest(model: Readonly<ImageModel>, tiles: Awaited<ReturnType<typeof collectRenderTiles>>) {
  const base = model.layers[0];
  if (!base || base.kind !== "raster") throw new Error("image_edit.bad_request");
  return {
    type: "render" as const,
    request_id: "encode",
    document_id: model.document_id,
    source_size: sourceSizeOf(model),
    layer_tiles: base.tiles as TileRef[],
    original_tiles: model.original_tiles,
    geometry: model.geometry,
    adjustments: model.adjustments,
    overlays: model.overlays,
    edge: Math.max(model.geometry.output_size.width, model.geometry.output_size.height),
    compare_original: false,
    tiles,
  };
}

async function compositeOutput(model: Readonly<ImageModel>): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const output = model.geometry.output_size;
  const lease = await compositeRegion(model, { x: 0, y: 0, width: output.width, height: output.height });
  try {
    const Offscreen = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
    if (!Offscreen) throw new Error("image_edit.failed");
    const canvas = new Offscreen(lease.width, lease.height);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("image_edit.failed");
    context.drawImage(lease.bitmap, 0, 0);
    const data = context.getImageData(0, 0, lease.width, lease.height);
    return { width: lease.width, height: lease.height, rgba: new Uint8Array(data.data.buffer.slice(0)) };
  } finally {
    lease.release();
  }
}

export async function encodeModel(model: Readonly<ImageModel>, options: EncodeOptions): Promise<{ bytes: Uint8Array; plan: EncodePlan }> {
  const plan = planEncoding(model, options);
  const needsComposite = model.layers.length !== 1 || model.layers[0]?.kind !== "raster";
  if (model.layers.some((layer) => layer.kind === "text" || layer.kind === "shape")) {
    // Text/shape rasterization needs the licensed font asset and is not
    // silently dropped into a flattened ordinary image.
    throw new Error("image_edit.unsupported");
  }
  let rendered: { width: number; height: number; rgba: Uint8Array; textPending: boolean };
  if (needsComposite) {
    const composited = await compositeOutput(model);
    rendered = { ...composited, textPending: false };
  } else {
    const tiles = await collectRenderTiles(model);
    rendered = await renderPixelsInWorker(fullRenderRequest(model, tiles));
  }
  if (rendered.textPending) throw new Error("image_edit.failed");
  const width = rendered.width;
  const height = rendered.height;
  const native = await tryNativeEncode(model, plan, width, height, rendered.rgba, options);
  let bytes: Uint8Array;
  if (native) bytes = native;
  else if (options.mime === "image/png") bytes = await encodePng(model, width, height, rendered.rgba, plan);
  else bytes = await encodeWithCanvas(width, height, rendered.rgba, options.mime, options.quality ?? 90, plan.background);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("snapshots.too_large");
  return { bytes, plan };
}

/** Uploads an encoded capture to 08a's immutable snapshot registry. The
 * captured revision/content_id are supplied by the controller and are not
 * read again after encoding starts. */
export async function captureEncodedSnapshot(
  document: DocumentHandle,
  model: Readonly<ImageModel>,
  revision: number,
  contentId: string,
  options: EncodeOptions = { mime: "image/png" },
): Promise<ExportSnapshot> {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("image_edit.bad_request");
  if (contentId !== model.content_id) throw new Error("image_edit.changed");
  void document;
  const { bytes } = await encodeModel(model, options);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("snapshots.too_large");
  const begun = await beginExportSnapshot({
    document_id: model.document_id,
    revision,
    content_id: contentId,
    mime: options.mime,
    byte_len: bytes.byteLength,
  });
  try {
    const chunk = 1024 * 1024;
    for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
      await appendExportSnapshot(begun.snapshot_id, begun.upload_token, offset, bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunk)));
    }
    return await finishExportSnapshot(begun.snapshot_id);
  } catch (error) {
    await releaseExportSnapshot(begun.snapshot_id).catch(() => undefined);
    throw error;
  }
}

/** Saves the exact captured revision to a new file through 09a's
 * `document_commit_start` copy mode. The native publisher resolves the
 * snapshot, writes an owned staging file and publishes it without replacing
 * an existing item; a copy never marks the document clean or rebinds it. */
export async function saveEncodedCopy(
  document: DocumentHandle,
  destPath: string,
): Promise<DocumentCommitResult> {
  if (
    typeof destPath !== "string" ||
    destPath.length === 0 ||
    destPath.length > 32_768 ||
    destPath.includes("\0")
  ) {
    throw new Error("image_edit.bad_request");
  }
  const state = document.getState();
  const snapshot = await document.captureSnapshot();
  if (snapshot.revision !== state.revision || snapshot.content_id !== state.content_id) {
    throw new Error("image_edit.changed");
  }
  const job = await startDocumentCommit({
    document_id: document.id,
    snapshot_id: snapshot.snapshot_id,
    captured_revision: snapshot.revision,
    content_id: snapshot.content_id,
    mode: "copy",
    dest_path: destPath,
  });
  return job.completion;
}

export function metadataCategoriesOf(metadata: readonly MetadataBlobRef[]): MetadataCategory[] {
  return metadata.map((blob) => blob.category);
}
