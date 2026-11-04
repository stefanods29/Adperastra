import type { PDFPageProxy } from "pdfjs-dist";
import { PDF_MAX_PNG_BYTES, pdfRasterDimensions, type PdfRasterSpec, type PdfRotation } from "../services/pdf";
import { PDF_HELPER_LIMITS } from "./types";

/** One page raster inside the helper (Step 07d D5, exact math).
 *
 * The scale comes from `pdfRasterDimensions` (the same function the UI and
 * its tests use), so a bucket or a DPI always means the same thing here, in
 * the cache key and in the print view. A render above the pixel cap is
 * refused before a canvas is allocated. */

export interface RenderedPage {
  bytes: Uint8Array;
  width: number;
  height: number;
  scale: number;
}

/** The PNG signature every accepted result starts with. */
export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

/** Width and height from the PNG's IHDR, or null when it is not one. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 8-byte signature, 4-byte length, "IHDR", then width and height (BE).
  if (bytes.length < 24) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** Check a PNG the helper is about to upload (or the parent received). */
export function validatePng(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): boolean {
  if (bytes.byteLength > PDF_HELPER_LIMITS.pngBytes) return false;
  const size = pngSize(bytes);
  return size !== null && size.width === expectedWidth && size.height === expectedHeight;
}

export class PdfRenderCancelled extends Error {
  constructor() {
    super("pdf.changed");
  }
}

/**
 * Render one page to PNG bytes. The canvas is created only after the size
 * check, the render task is cancelled when `isCancelled` turns true, and the
 * canvas is released in every path.
 */
export async function renderPageToPng(
  page: PDFPageProxy,
  raster: PdfRasterSpec,
  rotation: PdfRotation,
  isCancelled: () => boolean = () => false,
): Promise<RenderedPage> {
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const dimensions = pdfRasterDimensions({ width_pt: base.width, height_pt: base.height }, raster, rotation);
  if (dimensions.width * dimensions.height > PDF_HELPER_LIMITS.pixels) throw new Error("pdf.too_large");
  if (isCancelled()) throw new PdfRenderCancelled();
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("pdf.unavailable");
  const viewport = page.getViewport({ scale: dimensions.scale, rotation });
  const task = page.render({ canvasContext: context, viewport, canvas });
  const cancelPoll = window.setInterval(() => {
    if (isCancelled()) task.cancel();
  }, 50);
  try {
    await task.promise;
    if (isCancelled()) throw new PdfRenderCancelled();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("pdf.corrupt"));
      }, "image/png");
    });
    if (blob.size === 0 || blob.size > PDF_HELPER_LIMITS.pngBytes) throw new Error("pdf.too_large");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!validatePng(bytes, dimensions.width, dimensions.height)) throw new Error("pdf.corrupt");
    return { bytes, width: dimensions.width, height: dimensions.height, scale: dimensions.scale };
  } catch (error) {
    if (isCancelled()) throw new PdfRenderCancelled();
    if ((error as { name?: string } | null)?.name === "RenderingCancelledException") throw new PdfRenderCancelled();
    throw error;
  } finally {
    window.clearInterval(cancelPoll);
    // Give the memory back before the next page is drawn.
    canvas.width = 0;
    canvas.height = 0;
  }
}
