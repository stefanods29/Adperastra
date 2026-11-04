import { pdfInversePoint } from "../handlers/pdf/pdfCoordinates";
import {
  authorizeNewSnapshot,
  uploadSnapshot,
  type ExportSnapshot,
} from "../services/exportSnapshots";
import type { PdfPageInfo, PdfRotation } from "../services/pdf";
import {
  PDF_EDIT_MAX_AUTHOR_CHARS,
  PDF_EDIT_MAX_POINTS_PER_STROKE,
  PDF_EDIT_MAX_SIGNATURE_BYTES,
  PDF_EDIT_MAX_SIGNATURE_PIXELS,
  PDF_EDIT_MAX_TEXT_CHARS,
  isPdfEditUuid,
  newPdfEditId,
  normalizePdfRect,
  pdfEditError,
  type PdfAnnotation,
  type PdfColor,
  type PdfPoint,
  type PdfRect,
} from "./types";
import { pdfCommentAuthor } from "./comments";
import { simplifyPdfStroke } from "./types";

/** Visual signatures (Step 14a D5, T3).
 *
 * A signature is a `Stamp` annotation whose appearance is drawn by us. It
 * is never a `Sig` field, never carries a ByteRange, a certificate or a
 * private key, and never claims to be a certified digital signature. Typed
 * text and drawn strokes are serialized as bounded data; an image is an
 * immutable Step 08a snapshot (max 10 MP / 8 MiB) and is not kept for reuse. */

export type PdfSignatureKind = "draw" | "type" | "image";

export interface PdfSignatureImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg";
}

export interface PdfSignatureDraft {
  kind: PdfSignatureKind;
  strokes: PdfPoint[][];
  text: string;
  image?: PdfSignatureImage;
  /** Canvas size the drawn strokes were captured on. When present, strokes
   * are scaled from that canvas into the placement rectangle. */
  canvas_width?: number;
  canvas_height?: number;
}

export interface PdfSignaturePlacement {
  pointer: PdfPoint;
  width: number;
  height: number;
}

export function validateSignatureImage(image: PdfSignatureImage): void {
  if (image.mime !== "image/png" && image.mime !== "image/jpeg") throw pdfEditError("pdf_edit.unsupported");
  if (!(image.bytes instanceof Uint8Array)) throw pdfEditError("pdf_edit.bad_request");
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  if (image.width * image.height > PDF_EDIT_MAX_SIGNATURE_PIXELS) throw pdfEditError("pdf_edit.too_large");
  if (image.bytes.byteLength === 0 || image.bytes.byteLength > PDF_EDIT_MAX_SIGNATURE_BYTES) {
    throw pdfEditError("pdf_edit.too_large");
  }
}

export function signatureDraftError(draft: PdfSignatureDraft): "pdf_edit.bad_request" | "pdf_edit.too_large" | null {
  if (draft.kind === "draw") {
    const strokes = draft.strokes.filter((stroke) => stroke.length >= 2);
    if (strokes.length === 0) return "pdf_edit.bad_request";
    for (const stroke of strokes) if (stroke.length > PDF_EDIT_MAX_POINTS_PER_STROKE) return "pdf_edit.too_large";
    return null;
  }
  if (draft.kind === "type") {
    return draft.text.trim().length === 0 || draft.text.length > PDF_EDIT_MAX_TEXT_CHARS ? "pdf_edit.bad_request" : null;
  }
  if (!draft.image) return "pdf_edit.bad_request";
  try {
    validateSignatureImage(draft.image);
    return null;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return code === "pdf_edit.too_large" ? "pdf_edit.too_large" : "pdf_edit.bad_request";
  }
}

/** Upload a signature raster as a new ordinary 08a snapshot. There is no
 * file path: the bytes go through the bounded snapshot upload route and the
 * result is used only for this annotation. */
export async function uploadSignatureImage(image: PdfSignatureImage): Promise<ExportSnapshot> {
  validateSignatureImage(image);
  const name = image.mime === "image/jpeg" ? "signature.jpg" : "signature.png";
  const authority = await authorizeNewSnapshot(name, image.mime);
  return uploadSnapshot(
    {
      document_id: authority.document_id,
      revision: 1,
      content_id: newPdfEditId(),
      mime: image.mime,
      byte_len: image.bytes.byteLength,
    },
    image.bytes,
  );
}

/** Map a pointer on the rendered page box to a bounded signature rectangle.
 * Uses the 07d inverse viewport matrix, so a rotated page always maps back to
 * original page coordinates (never to display coordinates). */
export function signaturePlacementRect(
  placement: PdfSignaturePlacement,
  page: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
  crop: PdfRect,
): PdfRect {
  if (!Number.isFinite(placement.width) || !Number.isFinite(placement.height) || placement.width <= 0 || placement.height <= 0) {
    throw pdfEditError("pdf_edit.bad_request");
  }
  const point = pdfInversePoint(placement.pointer.x, placement.pointer.y, page, zoom, rotation);
  const width = Math.min(placement.width, crop.width);
  const height = Math.min(placement.height, crop.height);
  // CropBox-local top-left coordinates: never add the PDF CropBox origin.
  const x = Math.min(Math.max(0, point.x), crop.width - width);
  const y = Math.min(Math.max(0, point.y), crop.height - height);
  return normalizePdfRect({ x, y, width, height });
}

export interface CreateSignatureAnnotationInput {
  pageId: string;
  rect: PdfRect;
  author: string;
  anonymousLabel: string;
  createdUnix: number;
  color: PdfColor;
  opacity: number;
  imageSnapshot?: ExportSnapshot;
}

export function createPdfSignatureAnnotation(
  draft: PdfSignatureDraft,
  input: CreateSignatureAnnotationInput,
): PdfAnnotation {
  if (!isPdfEditUuid(input.pageId)) throw pdfEditError("pdf_edit.bad_request");
  const error = signatureDraftError(draft);
  if (error) throw pdfEditError(error);
  const author = pdfCommentAuthor(input.author, input.anonymousLabel).slice(0, PDF_EDIT_MAX_AUTHOR_CHARS);
  const annotation: PdfAnnotation = {
    id: newPdfEditId(),
    page_id: input.pageId,
    kind: "signature",
    rect: normalizePdfRect(input.rect),
    color: [...input.color] as PdfColor,
    opacity: input.opacity,
    author,
    created_unix: input.createdUnix,
    text: draft.kind === "type" ? draft.text.slice(0, PDF_EDIT_MAX_TEXT_CHARS) : "",
  };
  if (draft.kind === "draw") {
    const rect = annotation.rect;
    const canvasWidth = draft.canvas_width && draft.canvas_width > 0 ? draft.canvas_width : rect.width;
    const canvasHeight = draft.canvas_height && draft.canvas_height > 0 ? draft.canvas_height : rect.height;
    annotation.strokes = draft.strokes
      .filter((stroke) => stroke.length >= 2)
      .map((stroke) =>
        simplifyPdfStroke(
          stroke.map((point) => ({
            x: rect.x + (point.x / canvasWidth) * rect.width,
            y: rect.y + (point.y / canvasHeight) * rect.height,
          })),
        ),
      );
  }
  if (draft.kind === "image") {
    if (!input.imageSnapshot) throw pdfEditError("pdf_edit.unsupported");
    if (input.imageSnapshot.mime !== draft.image?.mime) throw pdfEditError("pdf_edit.bad_request");
    annotation.image = input.imageSnapshot;
  }
  return annotation;
}

/** The exact warning shown wherever a visual signature is created. */
export const PDF_VISUAL_SIGNATURE_WARNING_KEY = "pdfTools.visualWarning";
/** Shown when the source already contains a real digital signature. */
export const PDF_SIGNATURE_INVALIDATION_KEY = "pdfTools.signatureWarning";
