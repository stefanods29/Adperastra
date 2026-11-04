/** The trusted PDF-write helper entry (Step 08b D2-D4, 07d E7).
 *
 * Two actions share this one helper kind:
 * - `pdf.write_images` embeds images in selection order into one PDF.
 * - `pdf.write_blocks` either returns sanitized document blocks (for the
 *   `doc_blocks_start` job) or writes one PDF from blocks.
 *
 * Inputs are fetched through their own helper grants. No action receives a
 * path, a raw byte array through JSON or a caller-chosen output path. The one
 * output is uploaded to the reservation the native parent made. */

import {
  onHelperRequest,
  sendHelperReply,
  uploadHelperOutput,
  type HelperAction,
  type HelperGrantDTO,
  type HelperOutputDTO,
  type HelperRequestEnvelope,
} from "../services/helperBridge";
import type { DocumentSourceKind, HtmlBlock, HtmlBlockImage } from "../convert/documentTypes";
import { buildImagePdf, type ImagePdfItem, type ImagePageSize } from "./pdfImages";
import { buildBlocksPdf } from "./pdfBlocks";
import { parseDocumentBlocks, renderDocumentHtml, type ImageResolver } from "./documentParser";
import type { FontkitLike } from "./fontAdapter";
import { handlePdfEditRequest } from "./editActions";
import { isPdfEditHelperAction } from "./editTypes";
import {
  handlePrivacyXmpRequest,
  isPrivacyXmpAction,
  type PrivacyXmpPayload,
} from "./privacyXmp";

export interface PdfWriteImageInput {
  grant_id: string;
  width_px: number;
  height_px: number;
  mime: "image/png" | "image/jpeg";
}

export interface PdfWriteImagesRequest {
  images: PdfWriteImageInput[];
  page_size: ImagePageSize;
  margin_mm: number;
}

export interface PdfWriteBlocksRequest {
  /** "blocks" returns the sanitized model; "html" and "pdf" write blocks. */
  mode: "blocks" | "html" | "pdf";
  kind?: DocumentSourceKind;
  text?: string;
  blocks?: HtmlBlock[];
  page_size?: ImagePageSize;
  margin_mm?: number;
  title?: string;
  /** Local `src` values the parser may resolve to a grant. */
  image_grants?: { src: string; grant_id: string }[];
}

export interface PdfWriteImagesReply {
  page_count: number;
}

export interface PdfWriteBlocksReply {
  blocks: HtmlBlock[];
  next_cursor: string | null;
  complete: boolean;
  layout_loss: boolean;
  removed_images: number;
  removed_elements: number;
}

export interface PdfWritePdfReply {
  page_count: number;
  layout_loss: boolean;
  missing_image: boolean;
}

export interface PdfWriteHtmlReply {
  layout_loss: boolean;
}

const ACTIONS = new Set([
  "pdf.write_images",
  "pdf.write_blocks",
  "pdf.edit.inspect",
  "pdf.edit.serialize",
]);

function isHelperAction(value: unknown): value is HelperAction {
  return typeof value === "string" && (ACTIONS.has(value) || isPrivacyXmpAction(value));
}

let busy = false;

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("convert.") ||
    message.startsWith("pdf.") ||
    message.startsWith("pdf_edit.") ||
    message === "helper.busy"
  ) {
    return message;
  }
  return "convert.io";
}

async function replyOk(request: HelperRequestEnvelope<unknown>, payload: unknown, outputs: HelperOutputDTO[] = []): Promise<void> {
  await sendHelperReply({
    status: "ok",
    protocol_version: 1,
    request_id: request.request_id,
    payload,
    outputs,
  });
}

async function replyError(request: HelperRequestEnvelope<unknown>, code: string): Promise<void> {
  await sendHelperReply({
    status: "error",
    protocol_version: 1,
    request_id: request.request_id,
    error_code: code.slice(0, 128),
  });
}

function grantFor(request: HelperRequestEnvelope<unknown>, id: string): HelperGrantDTO {
  const grant = request.inputs.find((input) => input.grant_id === id);
  if (!grant) throw new Error("convert.bad_request");
  return grant;
}

async function fetchGrant(grant: HelperGrantDTO): Promise<Uint8Array> {
  const response = await fetch(grant.token_url, { cache: "no-store" });
  if (!response.ok) throw new Error("convert.changed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== grant.byte_len) throw new Error("convert.changed");
  return bytes;
}

async function handleImages(request: HelperRequestEnvelope<PdfWriteImagesRequest>): Promise<void> {
  const payload = request.payload;
  if (!Array.isArray(payload.images) || payload.images.length === 0) throw new Error("convert.bad_request");
  const reservation = request.output_reservations[0];
  if (!reservation || request.output_reservations.length !== 1 || reservation.mime !== "application/pdf") {
    throw new Error("convert.bad_request");
  }
  const items: ImagePdfItem[] = [];
  for (const image of payload.images) {
    const grant = grantFor(request, image.grant_id);
    if (grant.mime !== image.mime || (grant.mime !== "image/png" && grant.mime !== "image/jpeg")) {
      throw new Error("convert.unsupported");
    }
    items.push({
      bytes: await fetchGrant(grant),
      mime: image.mime,
      width_px: image.width_px,
      height_px: image.height_px,
    });
  }
  const bytes = await buildImagePdf(items, { page_size: payload.page_size, margin_mm: payload.margin_mm });
  const output = await uploadHelperOutput(reservation, bytes);
  const reply: PdfWriteImagesReply = { page_count: items.length };
  await replyOk(request, reply, [output]);
}

async function handleBlocks(request: HelperRequestEnvelope<PdfWriteBlocksRequest>): Promise<void> {
  const payload = request.payload;
  if (payload.mode === "blocks") {
    if (payload.kind !== "markdown" && payload.kind !== "html") throw new Error("convert.bad_request");
    // Markup bytes travel through the native-issued grant, never JSON.
    const documentGrant = request.inputs.find((input) =>
      input.mime === (payload.kind === "markdown" ? "text/markdown" : "text/html"));
    if (!documentGrant) throw new Error("convert.bad_request");
    const bytes = await fetchGrant(documentGrant);
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("convert.too_large");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const grants = new Map((payload.image_grants ?? []).map((entry) => [entry.src, entry.grant_id]));
    const resolver: ImageResolver = (src, alt): HtmlBlockImage | null => {
      const grantId = grants.get(src);
      if (!grantId) return null;
      const grant = request.inputs.find((input) => input.grant_id === grantId);
      if (!grant || !grant.mime.startsWith("image/")) return null;
      return { grant_id: grantId, mime: grant.mime, alt };
    };
    const analysis = parseDocumentBlocks({ kind: payload.kind, text }, resolver);
    const reply: PdfWriteBlocksReply = {
      blocks: analysis.blocks,
      next_cursor: null,
      complete: true,
      layout_loss: analysis.layout_loss,
      removed_images: analysis.removed_images,
      removed_elements: analysis.removed_elements,
    };
    await replyOk(request, reply);
    return;
  }

  if (payload.mode !== "pdf" && payload.mode !== "html") throw new Error("convert.bad_request");
  if (!Array.isArray(payload.blocks) || (payload.mode === "pdf" && payload.blocks.length === 0)) {
    throw new Error("convert.bad_request");
  }
  const reservation = request.output_reservations[0];
  const expectedMime = payload.mode === "pdf" ? "application/pdf" : "text/html";
  if (!reservation || request.output_reservations.length !== 1 || reservation.mime !== expectedMime) {
    throw new Error("convert.bad_request");
  }
  if (payload.mode === "html") {
    const missingImage = collectImages(payload.blocks).length > 0;
    const html = renderDocumentHtml(payload.blocks, { title: payload.title });
    const output = await uploadHelperOutput(reservation, new TextEncoder().encode(html));
    const reply: PdfWriteHtmlReply = { layout_loss: missingImage };
    await replyOk(request, reply, [output]);
    return;
  }
  const images = new Map<string, { bytes: Uint8Array; mime: "image/png" | "image/jpeg" }>();
  for (const image of collectImages(payload.blocks)) {
    if (!image.grant_id) continue;
    const grant = grantFor(request, image.grant_id);
    if (grant.mime !== "image/png" && grant.mime !== "image/jpeg") throw new Error("convert.unsupported");
    images.set(image.grant_id, { bytes: await fetchGrant(grant), mime: grant.mime });
  }
  const fontkitModule = await import("@pdf-lib/fontkit");
  const fontkit = ((fontkitModule as { default?: FontkitLike }).default ?? fontkitModule) as unknown as FontkitLike;
  const result = await buildBlocksPdf(
    payload.blocks,
    {
      page_size: payload.page_size ?? "a4",
      margin_mm: payload.margin_mm ?? 20,
      title: payload.title,
    },
    { fontkit },
    images,
  );
  const output = await uploadHelperOutput(reservation, result.bytes);
  const reply: PdfWritePdfReply = { page_count: result.page_count, layout_loss: result.layout_loss, missing_image: result.missing_image };
  await replyOk(request, reply, [output]);
}

function collectImages(blocks: readonly HtmlBlock[]): HtmlBlockImage[] {
  const images: HtmlBlockImage[] = [];
  for (const block of blocks) if (block.kind === "image") images.push(block.image);
  return images;
}

async function transcodeRaster(request: HelperRequestEnvelope<{ mode: string; quality: number }>): Promise<void> {
  if (request.inputs.length !== 1 || request.inputs[0].mime !== "image/png" || request.output_reservations.length !== 1) throw new Error("convert.bad_request");
  const reservation = request.output_reservations[0];
  if (reservation.mime !== "image/jpeg" || !Number.isInteger(request.payload.quality) || request.payload.quality < 1 || request.payload.quality > 100) throw new Error("convert.bad_request");
  const bytes = await fetchGrant(request.inputs[0]);
  const image = await createImageBitmap(new Blob([Uint8Array.from(bytes).buffer], { type: "image/png" }));
  try {
    if (image.width < 1 || image.height < 1 || image.width * image.height > 4194304) throw new Error("convert.too_large");
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("convert.io");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, image.width, image.height); context.drawImage(image, 0, 0);
    const encoded = await canvas.convertToBlob({ type: "image/jpeg", quality: request.payload.quality / 100 });
    if (encoded.type !== "image/jpeg" || encoded.size > 16 * 1024 * 1024) throw new Error("convert.too_large");
    const output = await uploadHelperOutput(reservation, new Uint8Array(await encoded.arrayBuffer()));
    await replyOk(request, { width: image.width, height: image.height }, [output]);
  } finally { image.close(); }
}

async function dispatch(request: HelperRequestEnvelope<unknown>): Promise<void> {
  if (busy) {
    await replyError(request, "helper.busy");
    return;
  }
  if (!isHelperAction(request.action)) {
    await replyError(request, "pdf.bad_request");
    return;
  }
  busy = true;
  try {
    if (isPdfEditHelperAction(request.action)) {
      await handlePdfEditRequest(request);
    } else if (isPrivacyXmpAction(request.action)) {
      await handlePrivacyXmpRequest(request as HelperRequestEnvelope<PrivacyXmpPayload>);
    } else if (request.action === "pdf.write_images" && (request.payload as { mode?: string }).mode === "raster") {
      await transcodeRaster(request as HelperRequestEnvelope<{ mode: string; quality: number }>);
    } else if (request.action === "pdf.write_images") {
      await handleImages(request as HelperRequestEnvelope<PdfWriteImagesRequest>);
    } else {
      await handleBlocks(request as HelperRequestEnvelope<PdfWriteBlocksRequest>);
    }
  } catch (error) {
    await replyError(request, codeOf(error));
  } finally {
    busy = false;
  }
}

export function startPdfWriteHelper(): Promise<void> {
  return onHelperRequest<unknown>({ action: isHelperAction, handler: (request) => void dispatch(request) }).then(() => undefined);
}

void startPdfWriteHelper();

// Keep the HTML exporter reachable for the Markdown-to-HTML adapter without
// pulling DOMPurify into the main application window.
export { renderDocumentHtml };
