import { ChevronLeft, ChevronRight, Expand, List, PanelLeft, Printer, RotateCcw, RotateCw, Scan, ZoomIn, ZoomOut } from "lucide-react";
import type { Command } from "../../commands/registry";
import {
  clampPdfZoom,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  nextPdfZoom,
  rotatedPageSize,
  type PdfFit,
  type PdfPageInfo,
  type PdfRotation,
} from "../../services/pdf";

/** The PDF tab's own state and rules (Step 07d T4).
 *
 * Everything here is pure: page bounds, the fit-to-window zoom, rotation
 * stepping, the ribbon commands and the small window of pages that may
 * render at once. The view components and the tests share them. */

/** Space between two pages on the canvas, in CSS pixels. */
export const PDF_PAGE_GAP = 24;
/** Pages around the current one that may render ahead (D5: one visible page
 * plus the adjacent ones). */
export const PDF_PREFETCH_RADIUS = 1;
/** How many page images one tab keeps leased (D6: at most 12). */
export const PDF_MAX_IMAGE_LEASES = 12;
/** The thumbnails sidebar: default and bounds, in CSS pixels (T4). */
export const PDF_SIDEBAR_WIDTH = 196;
export const PDF_SIDEBAR_MIN = 160;
export const PDF_SIDEBAR_MAX = 320;
/** One thumbnail row, including its label (T4). */
export const PDF_THUMBNAIL_ROW_HEIGHT = 144;

/** What the ribbon commands read. */
export interface PdfCommandContext {
  ready: boolean;
  page: number;
  pageCount: number;
  zoom: number;
  fit: PdfFit;
  rotation: PdfRotation;
  thumbnailsOpen: boolean;
  outlineOpen: boolean;
  canPrint: boolean;
  /** Quick preview (07b E5): no print, no printing UI. */
  previewOnly: boolean;
  printing: boolean;
}

export interface PdfActions {
  previous: () => void;
  next: () => void;
  setZoom: (zoom: number) => void;
  fitWidth: () => void;
  fitPage: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
  toggleThumbnails: () => void;
  toggleOutline: () => void;
  print: () => void;
}

/** The PDF tab's commands (contract 7). No global shortcut: Ctrl+F keeps the
 * file tab's own search box. */
export function createPdfCommands(actions: PdfActions): Command<PdfCommandContext>[] {
  return [
    {
      id: "pdf.previous",
      labelKey: "pdf.previous",
      icon: ChevronLeft,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready && ctx.page > 1,
      run: () => actions.previous(),
    },
    {
      id: "pdf.next",
      labelKey: "pdf.next",
      icon: ChevronRight,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready && ctx.page < ctx.pageCount,
      run: () => actions.next(),
    },
    {
      id: "pdf.zoomIn",
      labelKey: "viewer.zoomIn",
      icon: ZoomIn,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready && ctx.zoom < PDF_MAX_ZOOM,
      run: (ctx) => actions.setZoom(nextPdfZoom(ctx.zoom, 1)),
    },
    {
      id: "pdf.zoomOut",
      labelKey: "viewer.zoomOut",
      icon: ZoomOut,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready && ctx.zoom > PDF_MIN_ZOOM,
      run: (ctx) => actions.setZoom(nextPdfZoom(ctx.zoom, -1)),
    },
    {
      id: "pdf.fitWidth",
      labelKey: "pdf.fitWidth",
      icon: Expand,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      checkKind: "radio",
      checkedWhen: (ctx) => ctx.fit === "width",
      enabledWhen: (ctx) => ctx.ready,
      run: () => actions.fitWidth(),
    },
    {
      id: "pdf.fitPage",
      labelKey: "pdf.fitPage",
      icon: Scan,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      checkKind: "radio",
      checkedWhen: (ctx) => ctx.fit === "page",
      enabledWhen: (ctx) => ctx.ready,
      run: () => actions.fitPage(),
    },
    {
      id: "pdf.rotateLeft",
      labelKey: "pdf.rotateLeft",
      icon: RotateCcw,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready,
      run: () => actions.rotateLeft(),
    },
    {
      id: "pdf.rotateRight",
      labelKey: "pdf.rotateRight",
      icon: RotateCw,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready,
      run: () => actions.rotateRight(),
    },
    {
      id: "pdf.thumbnails",
      labelKey: "pdf.thumbnails",
      icon: PanelLeft,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      checkKind: "toggle",
      checkedWhen: (ctx) => ctx.thumbnailsOpen,
      enabledWhen: (ctx) => ctx.ready,
      run: () => actions.toggleThumbnails(),
    },
    {
      id: "pdf.outline",
      labelKey: "pdf.outline",
      icon: List,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      checkKind: "toggle",
      checkedWhen: (ctx) => ctx.outlineOpen,
      enabledWhen: (ctx) => ctx.ready,
      run: () => actions.toggleOutline(),
    },
    {
      id: "pdf.print",
      labelKey: "pdf.print",
      icon: Printer,
      risk: "read-only",
      helpSlug: "viewing-pdfs",
      enabledWhen: (ctx) => ctx.ready && ctx.canPrint && !ctx.previewOnly && !ctx.printing,
      visibleWhen: (ctx) => !ctx.previewOnly,
      run: () => actions.print(),
    },
  ];
}

/** A 1-based page clamped into the document. */
export function clampPage(page: number, pageCount: number): number {
  const last = Math.max(1, Math.floor(pageCount) || 1);
  if (!Number.isFinite(page)) return 1;
  return Math.min(last, Math.max(1, Math.floor(page)));
}

export function stepRotation(rotation: PdfRotation, direction: 1 | -1): PdfRotation {
  const next = (rotation + direction * 90 + 360) % 360;
  return next === 90 || next === 180 || next === 270 ? next : 0;
}

/**
 * The zoom a fit mode asks for. `boxWidth`/`boxHeight` are the available
 * CSS pixels (the canvas minus its 24 px padding); the answer is 10–400.
 */
export function fitZoom(
  fit: PdfFit,
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  boxWidth: number,
  boxHeight: number,
  current: number,
): number {
  if (fit === "none") return clampPdfZoom(current);
  const size = rotatedPageSize(info, 0);
  if (size.width <= 0 || size.height <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return clampPdfZoom(current);
  }
  const byWidth = (boxWidth / size.width) * 100;
  const byPage = Math.min(byWidth, (boxHeight / size.height) * 100);
  return clampPdfZoom(fit === "width" ? byWidth : byPage);
}

/** Height of one page row on the canvas, in CSS pixels. */
export function pdfPageRowHeight(
  info: Pick<PdfPageInfo, "width_pt" | "height_pt">,
  zoom: number,
  rotation: PdfRotation,
): number {
  const size = rotatedPageSize(info, rotation);
  return Math.ceil((size.height * zoom) / 100) + PDF_PAGE_GAP;
}

/**
 * The pages that may render around `page`: itself, then the next, then the
 * one before, never outside the document. Adjacent pages come after the
 * visible one so the first page always paints first (D5).
 */
export function pdfPrefetchOrder(page: number, pageCount: number): number[] {
  const order = [clampPage(page, pageCount)];
  for (let distance = 1; distance <= PDF_PREFETCH_RADIUS; distance += 1) {
    const next = page + distance;
    if (next <= pageCount) order.push(next);
    const before = page - distance;
    if (before >= 1) order.push(before);
  }
  return order;
}

/** The page window a virtualized list may keep mounted around `page`. */
export function boundedPageWindow(page: number, pageCount: number, radius = PDF_PREFETCH_RADIUS): { first: number; last: number } {
  const first = clampPage(page - radius, pageCount);
  const last = clampPage(page + radius, pageCount);
  return { first, last };
}

/** Which sidebar is open: thumbnails and the outline never share the width. */
export function pdfSidebarMode(thumbnailsOpen: boolean, outlineOpen: boolean): "thumbnails" | "outline" | "none" {
  if (thumbnailsOpen) return "thumbnails";
  if (outlineOpen) return "outline";
  return "none";
}

/** Clamp the user's sidebar drag (160–320 px). */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return PDF_SIDEBAR_WIDTH;
  return Math.min(PDF_SIDEBAR_MAX, Math.max(PDF_SIDEBAR_MIN, Math.round(width)));
}

/** The page number typed into the page box, or null while it is not a page. */
export function parsedPageBox(text: string, pageCount: number): number | null {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < 1 || value > pageCount) return null;
  return value;
}
