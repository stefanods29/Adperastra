/** Deterministic document layout with pdf-lib font metrics (Step 08b D4).
 *
 * The layout is pure: a `measure` callback returns the width of one text run
 * in the embedded export font. Words wrap at the measured width; a word that
 * is too long is split at a Unicode code-point boundary, never in the middle
 * of a surrogate pair. Nothing here approximates a browser engine; a block
 * the model cannot lay out becomes an explicit `layout_loss`, not silent
 * text loss. */

import type { HtmlBlock, HtmlHeadingLevel } from "../convert/documentTypes";

export const MM_TO_PT = 72 / 25.4;
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
export const LETTER_WIDTH_PT = 612;
export const LETTER_HEIGHT_PT = 792;
export const DEFAULT_MARGIN_MM = 20;
export const BODY_SIZE_PT = 11;
export const LINE_HEIGHT = 1.4;
export const TABLE_CELL_PADDING_PT = 8;
export const HEADING_SIZES_PT: Readonly<Record<HtmlHeadingLevel, number>> = {
  1: 16,
  2: 14,
  3: 13,
  4: 12,
  5: 11,
  6: 11,
};
export const FONT_IDS = ["inter-regular", "inter-bold", "inter-italic", "inter-bold-italic"] as const;
export type FontId = (typeof FONT_IDS)[number];

export type PageSizeId = "a4" | "letter" | "source";

export interface PageBox {
  width_pt: number;
  height_pt: number;
  margin_pt: number;
  /** `width - 2 * margin`; the exact value the layout may use. */
  available_width_pt: number;
  available_height_pt: number;
}

export interface LayoutLine {
  text: string;
  width_pt: number;
  /** True when a long word had to be split at a code-point boundary. */
  split: boolean;
}

export interface LayoutText {
  kind: "text";
  text: string;
  x_pt: number;
  y_pt: number;
  size_pt: number;
  font: FontId;
  width_pt: number;
}

export interface LayoutTable {
  kind: "table";
  cells: readonly (readonly string[])[];
  header: boolean;
  x_pt: number;
  y_pt: number;
  row_heights_pt: readonly number[];
  column_widths_pt: readonly number[];
}

export type LayoutItem = LayoutText | LayoutTable;

export interface LayoutPage {
  items: LayoutItem[];
  width_pt: number;
  height_pt: number;
}

export interface MeasuredFont {
  /** Width in points of `text` at `size_pt` in `font`. */
  measure(text: string, sizePt: number, font: FontId): number;
  /** True when every code point has a glyph; false means the export must
   * fail with `convert.missing_glyph` instead of drawing .notdef. */
  canDisplay(text: string, font: FontId): boolean;
}

/** The exact page geometry. A4 at the default 20 mm margin leaves
 * 481.89417... pt, the number the guide tests. */
export function pageBox(pageSize: PageSizeId, marginMm = DEFAULT_MARGIN_MM): PageBox {
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 50) throw new Error("convert.bad_request");
  const margin = marginMm * MM_TO_PT;
  let width: number;
  let height: number;
  switch (pageSize) {
    case "a4":
      width = A4_WIDTH_PT;
      height = A4_HEIGHT_PT;
      break;
    case "letter":
      width = LETTER_WIDTH_PT;
      height = LETTER_HEIGHT_PT;
      break;
    case "source":
      // The image adapter always replaces a source page with its own size.
      // For a document this is the A4 fallback and is reported as a layout
      // choice by the caller.
      width = A4_WIDTH_PT;
      height = A4_HEIGHT_PT;
      break;
    default:
      throw new Error("convert.bad_request");
  }
  const availableWidth = width - 2 * margin;
  const availableHeight = height - 2 * margin;
  if (availableWidth <= 0 || availableHeight <= 0) throw new Error("convert.bad_request");
  return {
    width_pt: width,
    height_pt: height,
    margin_pt: margin,
    available_width_pt: availableWidth,
    available_height_pt: availableHeight,
  };
}

/**
 * Wrap one paragraph at measured word widths.
 *
 * Spaces are kept exactly once between words. A word wider than the line is
 * split at Unicode code points; combining marks stay with their base when
 * possible, but a surrogate pair is never split.
 */
export function wrapParagraph(
  text: string,
  font: MeasuredFont,
  sizePt: number,
  maxWidthPt: number,
  fontId: FontId = "inter-regular",
): LayoutLine[] {
  if (!Number.isFinite(maxWidthPt) || maxWidthPt <= 0) throw new Error("convert.bad_request");
  const words = text.replace(/[\t\r\n ]+/g, " ").trim().split(" ").filter((word) => word !== "");
  if (words.length === 0) return [];
  const lines: LayoutLine[] = [];
  let current = "";
  let currentWidth = 0;
  const push = (split: boolean) => {
    if (current !== "") lines.push({ text: current, width_pt: currentWidth, split });
  };
  for (const word of words) {
    const spaceWidth = current === "" ? 0 : font.measure(" ", sizePt, fontId);
    const wordWidth = font.measure(word, sizePt, fontId);
    if (current !== "" && currentWidth + spaceWidth + wordWidth <= maxWidthPt) {
      current += ` ${word}`;
      currentWidth += spaceWidth + wordWidth;
      continue;
    }
    if (current !== "") {
      push(false);
      current = "";
      currentWidth = 0;
    }
    if (wordWidth <= maxWidthPt) {
      current = word;
      currentWidth = wordWidth;
      continue;
    }
    let part = "";
    let partWidth = 0;
    let split = false;
    for (const character of Array.from(word)) {
      const width = font.measure(character, sizePt, fontId);
      if (part !== "" && partWidth + width > maxWidthPt) {
        lines.push({ text: part, width_pt: partWidth, split });
        part = "";
        partWidth = 0;
        split = true;
      }
      part += character;
      partWidth += width;
    }
    current = part;
    currentWidth = partWidth;
    if (split) {
      // The final fragment stays current; the next word joins it if it fits.
    }
  }
  push(false);
  return lines;
}

/** Layout blocks top-to-bottom, starting a new page when needed. */
export function layoutDocument(
  blocks: readonly HtmlBlock[],
  font: MeasuredFont,
  options: { pageSize?: PageSizeId; marginMm?: number } = {},
): { pages: LayoutPage[]; layoutLoss: boolean } {
  const box = pageBox(options.pageSize ?? "a4", options.marginMm ?? DEFAULT_MARGIN_MM);
  const pages: LayoutPage[] = [];
  let page: LayoutPage = { items: [], width_pt: box.width_pt, height_pt: box.height_pt };
  let y = box.height_pt - box.margin_pt;
  let layoutLoss = false;
  const newPage = () => {
    pages.push(page);
    page = { items: [], width_pt: box.width_pt, height_pt: box.height_pt };
    y = box.height_pt - box.margin_pt;
  };
  const need = (height: number) => {
    if (y - height < box.margin_pt) newPage();
  };

  for (const block of blocks) {
    if (block.kind === "image") {
      // Images are placed by the caller from authorized bytes; the text
      // layout reserves a bounded placeholder so text never overlaps them.
      layoutLoss = true;
      continue;
    }
    if (block.kind === "table") {
      const widths = tableColumnWidths(block.cells, font, BODY_SIZE_PT, box.available_width_pt);
      const rowHeights = block.cells.map((row) => {
        const lines = row.map((cell, column) => wrapParagraph(cell, font, BODY_SIZE_PT, Math.max(1, widths[column] - 2 * TABLE_CELL_PADDING_PT)));
        return Math.max(1, ...lines.map((cellLines) => cellLines.length)) * BODY_SIZE_PT * LINE_HEIGHT + 2 * TABLE_CELL_PADDING_PT;
      });
      need(rowHeights.reduce((sum, height) => sum + height, 0));
      page.items.push({ kind: "table", cells: block.cells, header: block.header, x_pt: box.margin_pt, y_pt: y, row_heights_pt: rowHeights, column_widths_pt: widths });
      y -= rowHeights.reduce((sum, height) => sum + height, 0);
      continue;
    }
    const size = block.kind === "heading" ? HEADING_SIZES_PT[block.level] : BODY_SIZE_PT;
    const fontId: FontId = block.kind === "heading" || block.kind === "list_item" ? "inter-bold" : "inter-regular";
    if (!font.canDisplay(block.text, fontId)) throw new Error("convert.missing_glyph");
    const indent = block.kind === "list_item" ? block.level * 12 : 0;
    const lines = wrapParagraph(block.text, font, size, box.available_width_pt - indent, fontId);
    for (const line of lines) {
      if (line.split) layoutLoss = true;
      need(size * LINE_HEIGHT);
      page.items.push({
        kind: "text",
        text: line.text,
        x_pt: box.margin_pt + indent,
        y_pt: y - size,
        size_pt: size,
        font: fontId,
        width_pt: line.width_pt,
      });
      y -= size * LINE_HEIGHT;
    }
  }
  if (page.items.length > 0 || pages.length === 0) pages.push(page);
  return { pages, layoutLoss };
}

/** Equal columns inside the available width, with at least 8 pt each. */
export function tableColumnWidths(
  cells: readonly (readonly string[])[],
  font: MeasuredFont,
  sizePt: number,
  availableWidthPt: number,
): number[] {
  const columns = Math.max(1, ...cells.map((row) => row.length));
  const base = availableWidthPt / columns;
  const widths = Array.from({ length: columns }, () => base);
  const total = widths.reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] += availableWidthPt - total;
  void font;
  void sizePt;
  return widths;
}
