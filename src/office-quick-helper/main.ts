import {
  onHelperRequest,
  sendHelperReply,
  uploadHelperOutput,
  type HelperAction,
  type HelperOutputDTO,
  type HelperOutputReservation,
  type HelperRequestEnvelope,
} from "../services/helperBridge";
import type {
  OfficeComment,
  OfficeFormat,
  OfficeOutlineNode,
  OfficeSection,
} from "../services/officeViewTypes";

/** The isolated structural-preview helper (Step 13 T2). It receives only
 * granted XML through 07d, repeats DTD/entity/URL checks, and never evaluates
 * a formula/macro or inserts document markup into the DOM. A quick page is a
 * deliberately approximate text image; the accurate engine is separate. */

type QuickPart =
  | "document"
  | "styles"
  | "comments"
  | "notes"
  | "relationships"
  | "slide"
  | "sheet"
  | "shared_strings";

interface QuickEntryRef {
  part: QuickPart;
  grant_id: string;
  name: string;
  section_id: string;
  index: number;
}

interface QuickOpenRequest {
  format: OfficeFormat;
  sections: OfficeSection[];
  entries: QuickEntryRef[];
}

interface QuickOpenReply {
  document_page_count: number;
  sections: OfficeSection[];
  comments: OfficeComment[];
  outline: OfficeOutlineNode[];
  warnings: string[];
}

interface QuickPageRequest {
  section_id: string;
  page: number;
  scale: number;
}

interface QuickPageReply {
  section_id: string;
  page: number;
  width_pt: number;
  height_pt: number;
  output: HelperOutputDTO;
}

interface ParsedDocument {
  paragraphs: string[];
  documentLines: string[];
  slides: Map<string, string[]>;
  comments: OfficeComment[];
  outline: OfficeOutlineNode[];
  warnings: string[];
}

const QUICK_ACTIONS = new Set<string>(["office.quick.open", "office.quick.page"]);
const MAX_TEXT = 8_192;
const MAX_PARAGRAPHS = 8_000;
const DOCUMENT_LINES_PER_PAGE = 42;
const MAX_SLIDES = 1_000;
const MAX_PAGE_PIXELS = 4_194_304;
const LOCAL_ORIGIN = "http://adpfile.localhost";
let parsed: ParsedDocument | null = null;
let sections: OfficeSection[] = [];
let format: OfficeFormat = "docx";
let busy = false;

function isQuickAction(value: unknown): value is HelperAction {
  return typeof value === "string" && QUICK_ACTIONS.has(value);
}

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^office\.[a-z_]+$/.test(message) ? message : "office.unsupported";
}

async function replyOk<T>(
  request: HelperRequestEnvelope<unknown>,
  payload: T,
  outputs: HelperOutputDTO[] = [],
): Promise<void> {
  await sendHelperReply({
    status: "ok",
    protocol_version: 1,
    request_id: request.request_id,
    payload,
    outputs,
  });
}

async function replyError(request: HelperRequestEnvelope<unknown>, error: unknown): Promise<void> {
  await sendHelperReply({
    status: "error",
    protocol_version: 1,
    request_id: request.request_id,
    error_code: codeOf(error).slice(0, 128),
  });
}

function isLocalGrantUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === LOCAL_ORIGIN && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function decodeXml(bytes: Uint8Array, name: string): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const lower = text.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<!entity")) {
    throw new Error("office.unsupported");
  }
  if (name.length > 1_024) throw new Error("office.too_large");
  return text;
}

function parseXml(text: string): Document {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("office.unsupported");
  }
  return document;
}

async function readGrant(
  request: HelperRequestEnvelope<QuickOpenRequest>,
  entry: QuickEntryRef,
): Promise<string> {
  const grant = request.inputs.find((input) => input.grant_id === entry.grant_id);
  if (!grant || !isLocalGrantUrl(grant.token_url) || grant.name !== entry.name) {
    throw new Error("office.bad_request");
  }
  if (grant.mime !== "text/xml" && grant.mime !== "application/xml" && grant.mime !== "text/plain") {
    throw new Error("office.bad_request");
  }
  const response = await fetch(grant.token_url);
  if (!response.ok) throw new Error("office.changed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) {
    throw new Error("office.too_large");
  }
  return decodeXml(bytes, entry.name);
}

function localName(element: Element): string {
  return element.localName ?? element.tagName.split(":").pop() ?? element.tagName;
}

function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function childTexts(root: Document, names: readonly string[]): string[] {
  const wanted = new Set(names);
  const out: string[] = [];
  for (const element of Array.from(root.getElementsByTagName("*"))) {
    if (wanted.has(localName(element))) {
      const text = textOf(element);
      if (text) out.push(text);
      if (out.length >= MAX_PARAGRAPHS) break;
    }
  }
  return out;
}

function paragraphsOf(root: Document, formatName: string): string[] {
  if (formatName === "pptx") {
    return childTexts(root, ["t"]);
  }
  // ODF text (including ODP slide text) uses `text:p`/`text:h`, not `a:t`.
  return childTexts(root, ["p", "h"]);
}

function parseComments(root: Document, sectionId: string, namespace: string): OfficeComment[] {
  const comments: OfficeComment[] = [];
  const elements = Array.from(root.getElementsByTagName("*"));
  for (const element of elements) {
    const name = localName(element);
    // Word uses w:comment, ODF uses annotation and PowerPoint uses p:cm.
    if (name !== "comment" && name !== "annotation" && name !== "cm") continue;
    const text = textOf(element);
    if (!text) continue;
    const author =
      element.getAttribute("author") ??
      element.getAttribute("creator") ??
      element.getAttribute("authorId") ??
      element.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "author") ??
      "";
    const parent =
      element.getAttribute("parent") ??
      element.getAttribute("parentId") ??
      element.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "parent") ??
      null;
    const rawId =
      element.getAttribute("id") ??
      element.getAttribute("idx") ??
      element.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "id") ??
      element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") ??
      "";
    if (!rawId) continue;
    // PowerPoint keeps one comments part per slide and restarts `idx` at 1;
    // the part name keeps ids and parent links unique across those parts.
    comments.push({
      id: `${namespace}:${rawId}`.slice(0, 128),
      section_id: sectionId,
      page: 1,
      author: author.slice(0, 255),
      text: text.slice(0, MAX_TEXT),
      parent_id: parent ? `${namespace}:${parent}`.slice(0, 128) : null,
      source_anchor: { kind: "paragraph", index: comments.length },
    });
    if (comments.length >= 200) break;
  }
  return comments;
}

function headingOutline(paragraphs: string[], sectionId: string): OfficeOutlineNode[] {
  const nodes: OfficeOutlineNode[] = [];
  for (let index = 0; index < paragraphs.length && nodes.length < 200; index += 1) {
    const text = paragraphs[index];
    if (text.length > 90 || text.endsWith(".")) continue;
    nodes.push({
      id: crypto.randomUUID(),
      title: text.slice(0, 512),
      section_id: sectionId,
      page: 1,
      depth: 0,
    });
  }
  return nodes;
}

async function handleOpen(request: HelperRequestEnvelope<QuickOpenRequest>): Promise<void> {
  if (busy) throw new Error("office.engine_failed");
  busy = true;
  try {
    const entries = request.payload.entries;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256) {
      throw new Error("office.bad_request");
    }
    if (!Array.isArray(request.payload.sections) || request.payload.sections.length === 0) {
      throw new Error("office.bad_request");
    }
    const next: ParsedDocument = {
      paragraphs: [],
      documentLines: [],
      slides: new Map(),
      comments: [],
      outline: [],
      warnings: [],
    };
    for (const entry of entries) {
      const raw = await readGrant(request, entry);
      const xml = parseXml(raw);
      const entryParagraphs = paragraphsOf(xml, String(request.payload.format));
      if (entry.part === "slide") {
        if (next.slides.size >= MAX_SLIDES) throw new Error("office.too_large");
        next.slides.set(entry.section_id, entryParagraphs);
      } else if (entry.part === "document") {
        next.paragraphs.push(...entryParagraphs);
        next.outline.push(...headingOutline(entryParagraphs, entry.section_id));
      } else if (entry.part === "comments") {
        next.comments.push(...parseComments(xml, entry.section_id, entry.name));
        if (next.comments.length > 200) next.comments.length = 200;
      } else if (entry.part === "relationships") {
        if (/targetmode\s*=\s*["']external["']/i.test(raw)) throw new Error("office.unsupported");
      }
    }
    const hasDocument = request.payload.sections.some((section) => section.kind === "document");
    if (hasDocument) {
      next.documentLines = next.paragraphs.flatMap((paragraph) =>
        paragraph.match(/.{1,90}(?:\s|$)|.{1,90}/gu)?.map((line) => line.trim()) ?? [],
      );
    }
    const documentPageCount = Math.max(1, Math.ceil(next.documentLines.length / DOCUMENT_LINES_PER_PAGE));
    if (documentPageCount > 10_000) throw new Error("office.too_large");
    parsed = next;
    sections = request.payload.sections;
    format = request.payload.format;
    const reply: QuickOpenReply = {
      document_page_count: documentPageCount,
      sections,
      comments: next.comments,
      outline: next.outline.slice(0, 10_000),
      warnings: next.warnings,
    };
    await replyOk(request, reply);
  } finally {
    busy = false;
  }
}

function textForPage(request: QuickPageRequest): string[] {
  if (!parsed) throw new Error("office.changed");
  if (request.section_id.startsWith("slide:")) {
    return parsed.slides.get(request.section_id) ?? parsed.paragraphs;
  }
  const start = (request.page - 1) * DOCUMENT_LINES_PER_PAGE;
  return parsed.documentLines.slice(start, start + DOCUMENT_LINES_PER_PAGE);
}

function canvasFor(formatName: string): { canvas: HTMLCanvasElement; widthPt: number; heightPt: number } {
  const slide = formatName === "pptx" || formatName === "odp";
  const width = slide ? 1_280 : 1_200;
  const height = slide ? 720 : 1_600;
  if (width * height > MAX_PAGE_PIXELS) throw new Error("office.too_large");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, widthPt: slide ? 960 : 612, heightPt: slide ? 540 : 792 };
}

async function renderQuickPage(
  request: QuickPageRequest,
  reservation: HelperOutputReservation,
): Promise<QuickPageReply> {
  const document = sections.find((section) => section.id === request.section_id)?.kind === "document";
  const pageCount = document ? Math.max(1, Math.ceil((parsed?.documentLines.length ?? 0) / DOCUMENT_LINES_PER_PAGE)) : 1;
  if (!Number.isInteger(request.page) || request.page < 1 || request.page > pageCount) {
    throw new Error("office.bad_request");
  }
  if (!Number.isFinite(request.scale) || request.scale < 0.25 || request.scale > 4) {
    throw new Error("office.bad_request");
  }
  const lines = textForPage(request);
  const { canvas, widthPt, heightPt } = canvasFor(String(format));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("office.unsupported");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.font = "24px sans-serif";
  context.textBaseline = "top";
  const margin = 72;
  const lineHeight = 34;
  const maxLines = Math.floor((canvas.height - margin * 2) / lineHeight);
  let y = margin;
  for (const line of lines.slice(0, maxLines)) {
    context.fillText(line, margin, y, canvas.width - margin * 2);
    y += lineHeight;
    if (y > canvas.height - margin) break;
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("office.engine_failed"))), "image/png");
  });
  canvas.width = 0;
  canvas.height = 0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > reservation.max_bytes) {
    throw new Error("office.too_large");
  }
  const output = await uploadHelperOutput(reservation, bytes);
  return {
    section_id: request.section_id,
    page: request.page,
    width_pt: widthPt,
    height_pt: heightPt,
    output,
  };
}

async function handlePage(request: HelperRequestEnvelope<QuickPageRequest>): Promise<void> {
  if (busy) throw new Error("office.engine_failed");
  if (request.output_reservations.length !== 1 || request.output_reservations[0].mime !== "image/png") {
    throw new Error("office.bad_request");
  }
  if (!request.payload.section_id || request.payload.section_id.length > 64) {
    throw new Error("office.bad_request");
  }
  if (!sections.some((section) => section.id === request.payload.section_id)) {
    throw new Error("office.bad_request");
  }
  busy = true;
  try {
    const reply = await renderQuickPage(request.payload, request.output_reservations[0]);
    await replyOk(request, reply, [reply.output]);
  } finally {
    busy = false;
  }
}

void onHelperRequest<QuickOpenRequest | QuickPageRequest>({
  action: isQuickAction,
  handler: (request) => {
    void (async () => {
      try {
        const action = String(request.action);
        if (action === "office.quick.open") {
          await handleOpen(request as HelperRequestEnvelope<QuickOpenRequest>);
        } else if (action === "office.quick.page") {
          await handlePage(request as HelperRequestEnvelope<QuickPageRequest>);
        } else {
          throw new Error("office.bad_request");
        }
      } catch (error) {
        await replyError(request as HelperRequestEnvelope<unknown>, error);
      }
    })();
  },
});
