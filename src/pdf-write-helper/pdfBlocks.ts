/** Sanitized blocks to PDF (Step 08b D4, E6/E7).
 *
 * The writer draws plain text with the embedded Inter fonts, tables with
 * 8 pt cell padding and a repeated header, and authorized local images. It
 * never runs document markup, never loads a remote resource and never
 * substitutes a glyph. A table wider than the page is a `layout_loss`; a
 * long word is split at a code-point boundary. */

import { PDFDocument } from "pdf-lib";
import type { HtmlBlock } from "../convert/documentTypes";
import {
  BODY_SIZE_PT,
  HEADING_SIZES_PT,
  LINE_HEIGHT,
  TABLE_CELL_PADDING_PT,
  pageBox,
  tableColumnWidths,
  wrapParagraph,
  type FontId,
  type MeasuredFont,
  type PageSizeId,
} from "./documentLayout";
import { assertCanDisplay, loadEmbeddedFonts, type EmbeddedExportFont, type FontkitLike } from "./fontAdapter";

export const BLOCKS_PDF_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

export interface BlocksPdfImage {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
}

export interface BlocksPdfOptions {
  page_size: PageSizeId;
  margin_mm: number;
  title?: string;
}

export interface BlocksPdfResult {
  bytes: Uint8Array;
  page_count: number;
  layout_loss: boolean;
  missing_image: boolean;
}

/** Build one PDF from already sanitized blocks. */
export async function buildBlocksPdf(
  blocks: readonly HtmlBlock[],
  options: BlocksPdfOptions,
  fonts: Readonly<Record<FontId, EmbeddedExportFont>> | { fontkit: FontkitLike; base?: string },
  images: ReadonlyMap<string, BlocksPdfImage>,
  isCancelled: () => boolean = () => false,
): Promise<BlocksPdfResult> {
  const pdf = await PDFDocument.create();
  if (options.title) pdf.setTitle(options.title);
  const box = pageBox(options.page_size, options.margin_mm);
  const embeddedFonts = "fontkit" in fonts ? await loadEmbeddedFonts(pdf, fonts.fontkit, fonts.base ?? "") : fonts;
  const measured = measuredFont(embeddedFonts);
  let pageCount = 0;
  let current = newPage();
  let layoutLoss = false;
  let missingImage = false;

  function newPage() {
    const page = pdf.addPage([box.width_pt, box.height_pt]);
    pageCount += 1;
    return { page, y: box.height_pt - box.margin_pt };
  }

  function ensure(height: number): void {
    if (current.y - height < box.margin_pt) current = newPage();
  }

  function drawTable(cells: readonly (readonly string[])[], header: boolean): void {
    if (cells.length === 0) return;
    const columns = Math.max(1, ...cells.map((row) => row.length));
    if (columns > 100) {
      layoutLoss = true;
      return;
    }
    const widths = tableColumnWidths(cells, measured, BODY_SIZE_PT, box.available_width_pt);
    const rowHeight = (row: readonly string[]) => {
      const lines = row.map((cell, column) =>
        wrapParagraph(cell, measured, BODY_SIZE_PT, Math.max(1, widths[column] - 2 * TABLE_CELL_PADDING_PT)),
      );
      return Math.max(1, ...lines.map((value) => value.length)) * BODY_SIZE_PT * LINE_HEIGHT + 2 * TABLE_CELL_PADDING_PT;
    };
    const headerHeight = header ? rowHeight(cells[0]) : 0;
    const drawRow = (row: readonly string[], top: number, bold: boolean) => {
      let x = box.margin_pt;
      row.forEach((cell, column) => {
        const fontId: FontId = bold ? "inter-bold" : "inter-regular";
        assertCanDisplay(embeddedFonts[fontId].kit, cell);
        const lines = wrapParagraph(cell, measured, BODY_SIZE_PT, Math.max(1, widths[column] - 2 * TABLE_CELL_PADDING_PT), fontId);
        let y = top - TABLE_CELL_PADDING_PT - BODY_SIZE_PT;
        for (const line of lines) {
          current.page.drawText(line.text, {
            x: x + TABLE_CELL_PADDING_PT,
            y,
            size: BODY_SIZE_PT,
            font: embeddedFonts[fontId].font,
          });
          y -= BODY_SIZE_PT * LINE_HEIGHT;
        }
        x += widths[column];
      });
    };
    const drawRule = (top: number) => {
      current.page.drawLine({
        start: { x: box.margin_pt, y: top },
        end: { x: box.margin_pt + box.available_width_pt, y: top },
        thickness: 0.5,
      });
    };
    if (header) ensure(headerHeight);
    if (header) {
      drawRow(cells[0], current.y, true);
      drawRule(current.y);
      current.y -= headerHeight;
    }
    for (let index = header ? 1 : 0; index < cells.length; index += 1) {
      const height = rowHeight(cells[index]);
      if (current.y - height < box.margin_pt) {
        current = newPage();
        if (header) {
          drawRow(cells[0], current.y, true);
          drawRule(current.y);
          current.y -= headerHeight;
        }
      }
      drawRow(cells[index], current.y, false);
      drawRule(current.y);
      current.y -= height;
    }
    current.y -= 6;
  }

  for (const block of blocks) {
    if (isCancelled()) throw new Error("convert.cancelled");
    if (block.kind === "image") {
      const key = block.image.grant_id;
      const image = key ? images.get(key) : undefined;
      if (!image) {
        missingImage = true;
        layoutLoss = true;
        continue;
      }
      const embedded = image.mime === "image/png" ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes);
      const width = Math.min(box.available_width_pt, embedded.width);
      const height = (embedded.height * width) / embedded.width;
      if (height > box.available_height_pt) {
        layoutLoss = true;
        continue;
      }
      ensure(height);
      current.page.drawImage(embedded, {
        x: box.margin_pt + (box.available_width_pt - width) / 2,
        y: current.y - height,
        width,
        height,
      });
      current.y -= height + 6;
      continue;
    }
    if (block.kind === "table") {
      drawTable(block.cells, block.header);
      continue;
    }
    const size = block.kind === "heading" ? HEADING_SIZES_PT[block.level] : BODY_SIZE_PT;
    const fontId: FontId = block.kind === "heading" || block.kind === "list_item" ? "inter-bold" : "inter-regular";
    assertCanDisplay(embeddedFonts[fontId].kit, block.text);
    const indent = block.kind === "list_item" ? block.level * 12 : 0;
    const lines = wrapParagraph(block.text, measured, size, box.available_width_pt - indent, fontId);
    for (const line of lines) {
      if (line.split) layoutLoss = true;
      ensure(size * LINE_HEIGHT);
      current.page.drawText(line.text, {
        x: box.margin_pt + indent,
        y: current.y - size,
        size,
        font: embeddedFonts[fontId].font,
      });
      current.y -= size * LINE_HEIGHT;
    }
    current.y -= 4;
  }

  if (isCancelled()) throw new Error("convert.cancelled");
  const bytes = await pdf.save({ useObjectStreams: false });
  if (bytes.byteLength === 0 || bytes.byteLength > BLOCKS_PDF_MAX_OUTPUT_BYTES) throw new Error("convert.too_large");
  return { bytes, page_count: pageCount, layout_loss: layoutLoss, missing_image: missingImage };
}

function measuredFont(fonts: Readonly<Record<FontId, EmbeddedExportFont>>): MeasuredFont {
  return {
    measure(text, sizePt, font) {
      return fonts[font].font.widthOfTextAtSize(text, sizePt);
    },
    canDisplay(text, font) {
      for (const character of Array.from(text)) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) continue;
        if (!fonts[font].kit.hasGlyphForCodePoint(codePoint)) return false;
      }
      return true;
    },
  };
}
