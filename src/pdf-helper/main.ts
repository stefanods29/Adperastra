import {
  onHelperRequest,
  sendHelperReply,
  uploadHelperOutput,
  type HelperOutputDTO,
  type HelperRequestEnvelope,
} from "../services/helperBridge";
import type { PdfPageInfo, PdfRotation, PdfSearchMatch, PdfTextRun } from "../services/pdf";
import { loadPage, loadPdf, pageInfoOf, type LoadedPdf } from "./load";
import { printRange } from "./print";
import { PdfRenderCancelled, renderPageToPng } from "./render";
import { findMatchesInRuns, withPage } from "./search";
import { chunkTextRuns, readPageText } from "./text";
import {
  PDF_HELPER_LIMITS,
  type PdfHelperOpenRequest,
  type PdfHelperOpenReply,
  type PdfHelperOutlineNode,
  type PdfHelperOutlineReply,
  type PdfHelperOutlineRequest,
  type PdfHelperPrintReply,
  type PdfHelperPrintRequest,
  type PdfHelperRenderReply,
  type PdfHelperRenderRequest,
  type PdfHelperSearchPosition,
  type PdfHelperSearchReply,
  type PdfHelperSearchRequest,
  type PdfHelperTextReply,
  type PdfHelperTextRequest,
} from "./types";

/** The PDF helper's entry (Step 07d D2/D3).
 *
 * One PDF per helper process. Requests arrive from the native host after the
 * granted input is ready; every answer stays inside the bounded shapes of
 * `pdf-reader-2`. A render uploads exactly one PNG to the reservation the host
 * made; nothing here can choose a path, a URL or a second source. */

const PDF_ACTIONS = new Set([
  "pdf.open",
  "pdf.render",
  "pdf.text",
  "pdf.outline",
  "pdf.search",
  "pdf.print",
]);

function isPdfAction(value: unknown): value is "pdf.open" | "pdf.render" | "pdf.text" | "pdf.outline" | "pdf.search" | "pdf.print" {
  return typeof value === "string" && PDF_ACTIONS.has(value);
}

let loaded: LoadedPdf | null = null;
let loadedGrant: string | null = null;
let busy = false;
let cancelled = false;

const pageText = new Map<number, PdfTextRun[]>();

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("pdf.") || message === "helper.busy" || message === "helper.sensitive_unsupported") return message;
  return "pdf.corrupt";
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

function requireLoaded(): LoadedPdf {
  if (!loaded) throw new Error("pdf.changed");
  return loaded;
}

function rotationOf(value: unknown): PdfRotation {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

/** The page's own /Rotate, normalized to the four values the wire allows. */
function pageRotation(page: { rotate?: number } | null): PdfRotation {
  const raw = page?.rotate ?? 0;
  const normalized = ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

async function handleOpen(request: HelperRequestEnvelope<PdfHelperOpenRequest>): Promise<void> {
  const grant = request.inputs.find((input) => input.grant_id === request.payload.grant_id);
  if (!grant) throw new Error("pdf.bad_request");
  if (grant.mime !== "application/pdf") throw new Error("pdf.bad_request");
  if (loadedGrant !== null && loadedGrant !== grant.grant_id) {
    // A second source may never reuse the first one's content.
    pageText.clear();
  }
  if (loaded) await loaded.destroy();
  loaded = null;
  loadedGrant = grant.grant_id;
  pageText.clear();
  outlineStore = null;
  const opened = await loadPdf(grant.token_url, request.payload.password ?? null);
  loaded = opened;
  const reply: PdfHelperOpenReply = {
    page_count: opened.pageCount,
    can_copy: opened.canCopy,
    can_print: opened.canPrint,
  };
  await replyOk(request, reply);
}

async function handleRender(request: HelperRequestEnvelope<PdfHelperRenderRequest>): Promise<void> {
  const document = requireLoaded();
  const reservation = request.output_reservations[0];
  if (!reservation || request.output_reservations.length !== 1 || reservation.mime !== "image/png") {
    throw new Error("pdf.bad_request");
  }
  const proxy = await loadPage(document, request.payload.page);
  const rotation = rotationOf(request.payload.rotation);
  const rendered = await renderPageToPng(proxy, request.payload.raster, rotation, () => cancelled);
  const info = await pageInfoOf(proxy, pageRotation(proxy));
  const output = await uploadHelperOutput(reservation, rendered.bytes, () => cancelled);
  const reply: PdfHelperRenderReply = {
    info,
    render_width: rendered.width,
    render_height: rendered.height,
    resolved_scale: rendered.scale,
    rendered_rotation: rotation,
    request_revision: request.payload.request_revision,
  };
  proxy.cleanup();
  await replyOk(request, reply, [output]);
}

async function pageRuns(page: number): Promise<PdfTextRun[]> {
  const cached = pageText.get(page);
  if (cached) return cached;
  const document = requireLoaded();
  const proxy = await loadPage(document, page);
  const viewport = proxy.getViewport({ scale: 1, rotation: 0 });
  const runs = await readPageText(proxy, viewport.height);
  proxy.cleanup();
  if (pageText.size >= 2) pageText.delete(pageText.keys().next().value!);
  pageText.set(page, runs);
  return runs;
}

async function handleText(request: HelperRequestEnvelope<PdfHelperTextRequest>): Promise<void> {
  const document = requireLoaded();
  const page = request.payload.page;
  if (!Number.isInteger(page) || page < 1 || page > document.pageCount) throw new Error("pdf.bad_request");
  const runs = await pageRuns(page);
  const chunk = chunkTextRuns(runs, request.payload.after_run ?? null);
  const reply: PdfHelperTextReply = {
    page,
    runs: chunk.runs,
    next_run: chunk.next_run,
    complete: chunk.complete,
  };
  await replyOk(request, reply);
}

/** Resolve a destination to a page number, or null when it has none. */
async function pageOfDestination(document: LoadedPdf, destination: unknown): Promise<number | null> {
  try {
    if (typeof destination === "string") {
      const resolved = await document.doc.getDestination(destination);
      if (!resolved) return null;
      const index = await document.doc.getPageIndex(resolved[0] as never);
      return Number.isInteger(index) ? index + 1 : null;
    }
    if (Array.isArray(destination) && destination.length > 0) {
      const index = await document.doc.getPageIndex(destination[0] as never);
      return Number.isInteger(index) ? index + 1 : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Flatten the outline in preorder inside the node/depth limits. */
async function buildOutline(): Promise<{ nodes: PdfHelperOutlineNode[]; depth: number[] }> {
  const document = requireLoaded();
  const raw = await document.doc.getOutline();
  const nodes: PdfHelperOutlineNode[] = [];
  const depth: number[] = [];
  const walk = async (items: readonly { title?: string; dest?: unknown; items?: readonly unknown[] }[], level: number): Promise<boolean> => {
    for (const item of items) {
      if (nodes.length >= PDF_HELPER_LIMITS.outlineNodes) return false;
      if (level > PDF_HELPER_LIMITS.outlineDepth) return false;
      const title = typeof item.title === "string" ? item.title.slice(0, PDF_HELPER_LIMITS.outlineTitle) : "";
      const page = await pageOfDestination(document, item.dest);
      nodes.push({
        id: crypto.randomUUID(),
        title,
        page,
        children: [],
      });
      depth.push(level);
      if (Array.isArray(item.items) && item.items.length > 0) {
        const complete = await walk(item.items as readonly { title?: string; dest?: unknown; items?: readonly unknown[] }[], level + 1);
        if (!complete) return false;
      }
    }
    return true;
  };
  if (Array.isArray(raw)) await walk(raw as readonly { title?: string; dest?: unknown; items?: readonly unknown[] }[], 0);
  return { nodes, depth };
}

/** A slice of the preorder list, rebuilt as a forest with the right depths. */
function sliceOutline(
  nodes: readonly PdfHelperOutlineNode[],
  depth: readonly number[],
  offset: number,
): { nodes: PdfHelperOutlineNode[]; next: number | null; complete: boolean } {
  const start = Math.max(0, Math.min(nodes.length, Math.floor(offset) || 0));
  const end = Math.min(nodes.length, start + PDF_HELPER_LIMITS.outlinePage);
  const roots: PdfHelperOutlineNode[] = [];
  const stack: { node: PdfHelperOutlineNode; level: number }[] = [];
  for (let index = start; index < end; index += 1) {
    const level = depth[index] ?? 0;
    const node: PdfHelperOutlineNode = { ...nodes[index], children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length === 0 || level === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ node, level });
  }
  return { nodes: roots, next: end < nodes.length ? end : null, complete: end >= nodes.length };
}

let outlineStore: { nodes: PdfHelperOutlineNode[]; depth: number[] } | null = null;

async function handleOutline(request: HelperRequestEnvelope<PdfHelperOutlineRequest>): Promise<void> {
  requireLoaded();
  const offset = Number.isInteger(request.payload.offset) && request.payload.offset >= 0 ? request.payload.offset : 0;
  if (!outlineStore) outlineStore = await buildOutline();
  const slice = sliceOutline(outlineStore.nodes, outlineStore.depth, offset);
  const reply: PdfHelperOutlineReply = {
    nodes: slice.nodes,
    next_offset: slice.next,
    complete: slice.complete,
  };
  await replyOk(request, reply);
}

async function handleSearch(request: HelperRequestEnvelope<PdfHelperSearchRequest>): Promise<void> {
  const document = requireLoaded();
  const query = request.payload.query.slice(0, PDF_HELPER_LIMITS.searchQuery);
  if (query.trim() === "") throw new Error("pdf.bad_request");
  let page = Math.max(1, Math.min(document.pageCount, Math.floor(request.payload.page) || 1));
  let start = {
    run: Math.max(0, Math.floor(request.payload.run) || 0),
    offset: Math.max(0, Math.floor(request.payload.offset) || 0),
  };
  const matches: PdfSearchMatch[] = [];
  let scanned = 0;
  let next: PdfHelperSearchPosition | null = null;
  let complete = false;
  const startedAt = Date.now();
  while (page <= document.pageCount) {
    if (cancelled) throw new PdfRenderCancelled();
    const runs = await pageRuns(page);
    const found = findMatchesInRuns(runs, query, request.payload.match_case, start, PDF_HELPER_LIMITS.searchMatches - matches.length);
    matches.push(...withPage(found.matches, page));
    scanned += 1;
    if (matches.length >= PDF_HELPER_LIMITS.searchMatches) {
      next = found.next ? { ...found.next, page } : { page: page + 1, run: 0, offset: 0 };
      break;
    }
    if (!found.complete && found.next) {
      next = { ...found.next, page };
      break;
    }
    // Keep one request short; the parent's cursor continues from here.
    if (scanned >= 50 || Date.now() - startedAt > 4_000) {
      next = { page: page + 1, run: 0, offset: 0 };
      break;
    }
    page += 1;
    start = { run: 0, offset: 0 };
  }
  if (page > document.pageCount) {
    complete = true;
    next = null;
  }
  const reply: PdfHelperSearchReply = { matches, next_position: next, complete, scanned_pages: scanned };
  await replyOk(request, reply);
}

async function handlePrint(request: HelperRequestEnvelope<PdfHelperPrintRequest>): Promise<void> {
  const document = requireLoaded();
  const first = request.payload.first_page;
  const last = request.payload.last_page;
  if (request.payload.dpi !== PDF_HELPER_LIMITS.printDpi) throw new Error("pdf.bad_request");
  const completed = await printRange(document, first, last, () => cancelled);
  const reply: PdfHelperPrintReply = { completed };
  await replyOk(request, reply);
}

async function dispatch(request: HelperRequestEnvelope<unknown>): Promise<void> {
  if (busy) {
    await replyError(request, "helper.busy");
    return;
  }
  if (!isPdfAction(request.action)) {
    await replyError(request, "pdf.bad_request");
    return;
  }
  busy = true;
  try {
    switch (request.action) {
      case "pdf.open":
        await handleOpen(request as HelperRequestEnvelope<PdfHelperOpenRequest>);
        break;
      case "pdf.render":
        await handleRender(request as HelperRequestEnvelope<PdfHelperRenderRequest>);
        break;
      case "pdf.text":
        await handleText(request as HelperRequestEnvelope<PdfHelperTextRequest>);
        break;
      case "pdf.outline":
        await handleOutline(request as HelperRequestEnvelope<PdfHelperOutlineRequest>);
        break;
      case "pdf.search":
        await handleSearch(request as HelperRequestEnvelope<PdfHelperSearchRequest>);
        break;
      case "pdf.print":
        await handlePrint(request as HelperRequestEnvelope<PdfHelperPrintRequest>);
        break;
    }
  } catch (error) {
    if (!(error instanceof PdfRenderCancelled)) await replyError(request, codeOf(error));
  } finally {
    busy = false;
  }
}

/** Start listening. The native host only emits after the private check and
 * the input grants are ready; it re-emits the same request id while the page
 * finishes loading, so a repeated id is ignored. */
export function startPdfHelper(): Promise<void> {
  let lastRequest: string | null = null;
  return onHelperRequest<unknown>({
    action: isPdfAction,
    handler: (request) => {
      if (lastRequest === request.request_id) return;
      lastRequest = request.request_id;
      void dispatch(request);
    },
  }).then(() => undefined);
}

void startPdfHelper();
