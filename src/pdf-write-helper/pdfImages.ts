/** Images to one PDF, inside the trusted PDF-write helper (Step 08b D2).
 *
 * `pdf-lib` 1.17.1 creates the document and embeds each image in the exact
 * order of the conversion selection, one image per page. The source image is
 * never modified. Page sizes are the same pure values as
 * `crates/convert/src/pdf.rs`; both sides are tested against the same
 * oracles.
 *
 * Only PNG and JPEG bytes reach this module. Every other input format is
 * converted to PNG by the Step 08a image helper first, which also applies the
 * EXIF orientation. */

import { PDFDocument } from "pdf-lib";

export const IMAGE_PDF_MAX_IMAGES = 1_000;
export const IMAGE_PDF_MAX_PAGES = 10_000;
export const IMAGE_PDF_DEFAULT_DPI = 96;
export const IMAGE_PDF_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
export const LETTER_WIDTH_PT = 612;
export const LETTER_HEIGHT_PT = 792;

export type ImagePageSize = "source" | "a4" | "letter";

export interface ImagePdfItem {
  /** Decoded bytes, already orientation-normalized. */
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width_px: number;
  height_px: number;
}

export interface ImagePdfOptions {
  page_size: ImagePageSize;
  margin_mm: number;
}

export interface ImagePlacement {
  page_width_pt: number;
  page_height_pt: number;
  draw_width_pt: number;
  draw_height_pt: number;
  x_pt: number;
  y_pt: number;
}

/** The same page/draw math as the native pure module. */
export function imagePlacements(
  images: readonly Pick<ImagePdfItem, "width_px" | "height_px">[],
  options: ImagePdfOptions,
): ImagePlacement[] {
  if (images.length === 0 || images.length > IMAGE_PDF_MAX_IMAGES) throw new Error("convert.too_large");
  if (!Number.isInteger(options.margin_mm) || options.margin_mm < 0 || options.margin_mm > 50) {
    throw new Error("convert.bad_request");
  }
  const margin = (options.margin_mm * 72) / 25.4;
  const placements: ImagePlacement[] = [];
  for (const image of images) {
    if (!positiveInteger(image.width_px) || !positiveInteger(image.height_px)) {
      throw new Error("convert.bad_request");
    }
    const sourceWidth = (image.width_px * 72) / IMAGE_PDF_DEFAULT_DPI;
    const sourceHeight = (image.height_px * 72) / IMAGE_PDF_DEFAULT_DPI;
    let pageWidth: number;
    let pageHeight: number;
    let usableWidth: number;
    let usableHeight: number;
    switch (options.page_size) {
      case "source":
        pageWidth = sourceWidth;
        pageHeight = sourceHeight;
        usableWidth = sourceWidth;
        usableHeight = sourceHeight;
        break;
      case "a4":
        pageWidth = A4_WIDTH_PT;
        pageHeight = A4_HEIGHT_PT;
        usableWidth = A4_WIDTH_PT - 2 * margin;
        usableHeight = A4_HEIGHT_PT - 2 * margin;
        break;
      case "letter":
        pageWidth = LETTER_WIDTH_PT;
        pageHeight = LETTER_HEIGHT_PT;
        usableWidth = LETTER_WIDTH_PT - 2 * margin;
        usableHeight = LETTER_HEIGHT_PT - 2 * margin;
        break;
      default:
        throw new Error("convert.bad_request");
    }
    if (usableWidth <= 0 || usableHeight <= 0) throw new Error("convert.bad_request");
    const scale = Math.min(usableWidth / sourceWidth, usableHeight / sourceHeight, 1);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    placements.push({
      page_width_pt: pageWidth,
      page_height_pt: pageHeight,
      draw_width_pt: drawWidth,
      draw_height_pt: drawHeight,
      x_pt: (pageWidth - drawWidth) / 2,
      y_pt: (pageHeight - drawHeight) / 2,
    });
  }
  return placements;
}

/** Build one PDF. Page order is the input order, exactly. */
export async function buildImagePdf(
  images: readonly ImagePdfItem[],
  options: ImagePdfOptions,
  isCancelled: () => boolean = () => false,
): Promise<Uint8Array> {
  const placements = imagePlacements(images, options);
  const pdf = await PDFDocument.create();
  for (let index = 0; index < images.length; index += 1) {
    if (isCancelled()) throw new Error("convert.cancelled");
    const item = images[index];
    const placement = placements[index];
    const embedded = item.mime === "image/png" ? await pdf.embedPng(item.bytes) : await pdf.embedJpg(item.bytes);
    const page = pdf.addPage([placement.page_width_pt, placement.page_height_pt]);
    page.drawImage(embedded, {
      x: placement.x_pt,
      y: placement.y_pt,
      width: placement.draw_width_pt,
      height: placement.draw_height_pt,
    });
  }
  if (isCancelled()) throw new Error("convert.cancelled");
  const bytes = await pdf.save({ useObjectStreams: false });
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_PDF_MAX_OUTPUT_BYTES) {
    throw new Error("convert.too_large");
  }
  return bytes;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
