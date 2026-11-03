import { describe, expect, it } from "vitest";
import {
  boundedPageWindow,
  clampPage,
  clampSidebarWidth,
  createPdfCommands,
  fitZoom,
  parsedPageBox,
  pdfPageRowHeight,
  pdfPrefetchOrder,
  pdfSidebarMode,
  stepRotation,
  type PdfActions,
  type PdfCommandContext,
} from "../handlers/pdf/pdfState";
import { flattenOutline } from "../handlers/pdf/PdfOutline";
import type { PdfOutlineNode } from "../services/pdf";

/** The PDF tab's pure rules (Step 07d T4/T5). */

const A4 = { width_pt: 595, height_pt: 842 };

function actions(): PdfActions {
  return {
    previous: () => undefined,
    next: () => undefined,
    setZoom: () => undefined,
    fitWidth: () => undefined,
    fitPage: () => undefined,
    rotateLeft: () => undefined,
    rotateRight: () => undefined,
    toggleThumbnails: () => undefined,
    toggleOutline: () => undefined,
    print: () => undefined,
  };
}

function context(patch: Partial<PdfCommandContext> = {}): PdfCommandContext {
  return {
    ready: true,
    page: 1,
    pageCount: 3,
    zoom: 100,
    fit: "width",
    rotation: 0,
    thumbnailsOpen: true,
    outlineOpen: false,
    canPrint: true,
    previewOnly: false,
    printing: false,
    ...patch,
  };
}

describe("pdf state", () => {
  it("clamps pages and steps rotation in fours", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(4, 3)).toBe(3);
    expect(clampPage(Number.NaN, 3)).toBe(1);
    expect(stepRotation(0, -1)).toBe(270);
    expect(stepRotation(270, 1)).toBe(0);
    expect(stepRotation(90, 1)).toBe(180);
  })

  it("fits the width and the whole page inside the box", () => {
    // 595 pt wide in a 500 px box -> 84 %.
    expect(fitZoom("width", A4, 500, 1000, 100)).toBe(84);
    // The page limit wins when the height is the smaller side.
    expect(fitZoom("page", { width_pt: 595, height_pt: 842 }, 595, 421, 100)).toBe(50);
    expect(fitZoom("none", A4, 500, 500, 175)).toBe(175);
    // Nonsense boxes keep the current zoom.
    expect(fitZoom("width", A4, 0, 0, 120)).toBe(120);
  })

  it("keeps the page window and the prefetch bounded", () => {
    expect(pdfPrefetchOrder(1, 3)).toEqual([1, 2]);
    expect(pdfPrefetchOrder(2, 3)).toEqual([2, 3, 1]);
    expect(pdfPrefetchOrder(3, 3)).toEqual([3, 2]);
    expect(boundedPageWindow(1, 1000)).toEqual({ first: 1, last: 2 });
    expect(boundedPageWindow(500, 1000)).toEqual({ first: 499, last: 501 });
    expect(pdfPageRowHeight(A4, 100, 0)).toBe(866);
  })

  it("shows one sidebar at a time and clamps its width", () => {
    expect(pdfSidebarMode(true, true)).toBe("thumbnails");
    expect(pdfSidebarMode(false, true)).toBe("outline");
    expect(pdfSidebarMode(false, false)).toBe("none");
    expect(clampSidebarWidth(10)).toBe(160);
    expect(clampSidebarWidth(999)).toBe(320);
    expect(clampSidebarWidth(Number.NaN)).toBe(196);
  })

  it("accepts a page only when the box holds a real page", () => {
    expect(parsedPageBox(" 2 ", 3)).toBe(2);
    expect(parsedPageBox("0", 3)).toBeNull();
    expect(parsedPageBox("4", 3)).toBeNull();
    expect(parsedPageBox("2.5", 3)).toBeNull();
    expect(parsedPageBox("", 3)).toBeNull();
  })

  it("registers the nine ribbon commands with their exact ids and keys", () => {
    const commands = createPdfCommands(actions());
    const ids = commands.map((command) => command.id);
    for (const id of [
      "pdf.previous",
      "pdf.next",
      "pdf.fitWidth",
      "pdf.fitPage",
      "pdf.rotateLeft",
      "pdf.rotateRight",
      "pdf.thumbnails",
      "pdf.outline",
      "pdf.print",
    ]) {
      expect(ids).toContain(id);
    }
    const print = commands.find((command) => command.id === "pdf.print");
    expect(print?.labelKey).toBe("pdf.print");
    expect(print?.helpSlug).toBe("viewing-pdfs");
    expect(print?.visibleWhen?.(context())).toBe(true);
    expect(print?.visibleWhen?.(context({ previewOnly: true }))).toBe(false);
    expect(print?.enabledWhen(context({ canPrint: false }))).toBe(false);
    expect(print?.enabledWhen(context({ previewOnly: true }))).toBe(false);
    expect(print?.enabledWhen(context())).toBe(true);
    const previous = commands.find((command) => command.id === "pdf.previous");
    expect(previous?.enabledWhen(context({ page: 1 }))).toBe(false);
    expect(previous?.enabledWhen(context({ page: 2 }))).toBe(true);
    // No global shortcut is taken from the file tab.
    expect(commands.every((command) => command.shortcut === undefined)).toBe(true);
  })

  it("bounds an enormous or deep outline without freezing", () => {
    const deep = (depth: number): PdfOutlineNode => ({
      id: `n-${depth}`,
      title: "level",
      page: 1,
      children: depth === 0 ? [] : [deep(depth - 1)],
    });
    const wide: PdfOutlineNode[] = Array.from({ length: 5_001 }, (_, index) => ({
      id: `w-${index}`,
      title: `node ${index}`,
      page: 1,
      children: [],
    }));
    const wideResult = flattenOutline(wide);
    expect(wideResult.rows.length).toBeLessThanOrEqual(5_000);
    expect(wideResult.truncated).toBe(true);
    const deepResult = flattenOutline([deep(33)]);
    expect(deepResult.rows.length).toBeLessThanOrEqual(33);
    expect(deepResult.truncated).toBe(true);
    const small = flattenOutline([
      { id: "a", title: "A", page: 1, children: [{ id: "b", title: "B", page: null, children: [] }] },
    ]);
    expect(small.rows.map((row) => row.depth)).toEqual([0, 1]);
    expect(small.truncated).toBe(false);
  })
})
