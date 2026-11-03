/** PSD validation and composite adapter (Step 07g T5/D7).
 *
 * The header and the layer section are checked before ag-psd sees a byte.
 * readPsd never receives linked-file data, layer pixels or a composite it
 * is allowed to fabricate. Layer names are plain text, never HTML. */

import { readPsd } from "ag-psd";
import type { PsdLayerInfo } from "../services/specialViews";

export const PSD_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const PSD_MAX_PIXELS = 100_000_000;
export const PSD_MAX_LAYERS = 1_000;
export const PSD_MAX_DEPTH = 32;
export const PSD_MEMORY_LIMIT = 268_435_456;

export interface PsdHeader {
  width: number;
  height: number;
  depth: number;
  layers: number;
}

export interface PsdLayerSource {
  name?: string;
  hidden?: boolean;
  opacity?: number;
  children?: PsdLayerSource[];
}

export interface PsdDocument {
  width: number;
  height: number;
  /** Raw RGBA composite, or null when the file has no saved composite. */
  composite: { width: number; height: number; data: Uint8ClampedArray } | null;
  layers: PsdLayerInfo[];
}

function corrupt(): never {
  throw new Error("special_view.corrupt");
}

function tooLarge(): never {
  throw new Error("special_view.too_large");
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) corrupt();
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) corrupt();
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function i16(bytes: Uint8Array, offset: number): number {
  const value = u16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

/** Validate signature, version, channels, dimensions, depth and the layer
 * count before the library is called. Version 2 (PSB) is a supported
 * fallback to the chosen app, not a library experiment. */
export function inspectPsdHeader(bytes: Uint8Array): PsdHeader {
  if (bytes.length > PSD_MAX_SOURCE_BYTES) tooLarge();
  if (bytes.length < 26) corrupt();
  if (bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) corrupt();
  if (u16(bytes, 4) !== 1) throw new Error("special_view.unsupported");
  const channels = u16(bytes, 12);
  const height = u32(bytes, 14);
  const width = u32(bytes, 18);
  const depth = u16(bytes, 22);
  const colorMode = u16(bytes, 24);
  if (channels < 1 || channels > 56) corrupt();
  if (width === 0 || height === 0 || width > 300_000 || height > 300_000) corrupt();
  if (width * height > PSD_MAX_PIXELS) tooLarge();
  if (![1, 8, 16, 32].includes(depth)) throw new Error("special_view.unsupported");
  if (colorMode > 9) throw new Error("special_view.unsupported");

  let offset = 26;
  offset = skipSection(bytes, offset);
  offset = skipSection(bytes, offset);
  const layerAndMask = u32(bytes, offset);
  if (layerAndMask === 0) return { width, height, depth, layers: 0 };
  offset += 4;
  if (offset + 4 > bytes.length) corrupt();
  const layerInfoLength = u32(bytes, offset);
  if (layerInfoLength === 0) return { width, height, depth, layers: 0 };
  offset += 4;
  if (offset + 2 > bytes.length) corrupt();
  const rawCount = i16(bytes, offset);
  const layers = Math.abs(rawCount);
  if (layers > PSD_MAX_LAYERS) tooLarge();
  return { width, height, depth, layers };
}

function skipSection(bytes: Uint8Array, offset: number): number {
  const length = u32(bytes, offset);
  const next = offset + 4 + length;
  if (next > bytes.length) corrupt();
  return next;
}

/** A stable traversal order, max 1,000 layers and depth 32. */
export function flattenPsdLayers(children: readonly PsdLayerSource[]): PsdLayerInfo[] {
  const result: PsdLayerInfo[] = [];
  const visit = (layer: PsdLayerSource, parent: number | null, depth: number) => {
    if (result.length >= PSD_MAX_LAYERS) tooLarge();
    if (depth > PSD_MAX_DEPTH) tooLarge();
    const id = result.length;
    const kids = layer.children ?? [];
    result.push({
      id,
      parent,
      name: escapeLayerName(layer.name ?? ""),
      visible: layer.hidden !== true,
      opacity: typeof layer.opacity === "number" && Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity)) : 1,
      children_count: kids.length,
    });
    for (const child of kids) visit(child, id, depth + 1);
  };
  for (const layer of children) visit(layer, null, 0);
  return result;
}

/** Layer names are text. Control characters are removed; the result is
 * rendered as React text, never as markup. */
export function escapeLayerName(name: string): string {
  return Array.from(name.replace(/[\u0000-\u001f\u007f]/g, " "))
    .slice(0, 512)
    .join("");
}

export interface PsdDependencies {
  readPsd: typeof readPsd;
}

/** Preflight, then one bounded readPsd call. `skipLinkedFilesData` means no
 * linked smart object is requested; no URL or path is ever opened. */
export function readPsdDocument(bytes: Uint8Array, dependencies: PsdDependencies = { readPsd }): PsdDocument {
  const header = inspectPsdHeader(bytes);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const psd = dependencies.readPsd(buffer as ArrayBuffer, {
    skipLayerImageData: true,
    skipCompositeImageData: false,
    skipLinkedFilesData: true,
    useImageData: true,
    totalMemoryLimit: PSD_MEMORY_LIMIT,
  }) as {
    width?: number;
    height?: number;
    imageData?: { width: number; height: number; data: Uint8ClampedArray };
    children?: PsdLayerSource[];
  };
  const width = typeof psd.width === "number" && psd.width > 0 ? psd.width : header.width;
  const height = typeof psd.height === "number" && psd.height > 0 ? psd.height : header.height;
  if (width * height > PSD_MAX_PIXELS) tooLarge();
  const composite = psd.imageData && psd.imageData.data.length === width * height * 4
    ? { width, height, data: psd.imageData.data }
    : null;
  const layers = flattenPsdLayers(psd.children ?? []);
  if (layers.length > header.layers && header.layers !== 0) tooLarge();
  return { width, height, composite, layers };
}

/** Encode the saved composite at or below `maxEdge`; a missing composite is
 * null (the UI shows the explicit empty-composite state). */
export async function encodePsdComposite(
  document: PsdDocument,
  maxEdge: number,
): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  if (!document.composite) return null;
  const { width, height, data } = document.composite;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const source = new ImageData(new Uint8ClampedArray(data), width, height);
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("special_view.unsupported");
  if (scale === 1) {
    context.putImageData(source, 0, 0);
  } else {
    const temporary = globalThis.document.createElement("canvas");
    temporary.width = width;
    temporary.height = height;
    const tempContext = temporary.getContext("2d");
    if (!tempContext) throw new Error("special_view.unsupported");
    tempContext.putImageData(source, 0, 0);
    context.drawImage(temporary, 0, 0, targetWidth, targetHeight);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("special_view.unsupported");
  return { png: new Uint8Array(await blob.arrayBuffer()), width: targetWidth, height: targetHeight };
}
