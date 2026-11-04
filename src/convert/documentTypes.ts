/** The sanitized document block model (Step 08b E6).
 *
 * HTML and Markdown never reach the PDF writer as markup. The trusted parser
 * turns them into this small tagged model; every string is plain text, every
 * image needs an authorized descriptor, and there is no field for raw HTML,
 * event attributes, scripts or remote URLs.
 *
 * The native mirror lives in `src-tauri/src/conversion_document_types.rs`; both sides
 * use the same field names and the same limits. */

/** Most blocks one `HtmlBlockPage` may carry (E7). */
export const MAX_BLOCKS_PER_PAGE = 256;
/** Most UTF-8 bytes one block's text may carry (E6). */
export const MAX_BLOCK_TEXT_BYTES = 64 * 1024;
/** Most cells one table may carry: 1,000 rows by 100 columns (E6). */
export const MAX_TABLE_ROWS = 1_000;
export const MAX_TABLE_COLUMNS = 100;
/** Most table cells across a whole document conversion. */
export const MAX_TABLE_CELLS = 100_000;
/** Heading levels the model supports (D4). */
export type HtmlHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** One authorized local image. A remote URL has no representation here. */
export interface HtmlBlockImage {
  /** Helper-granted local bytes, when the block is inside the helper. */
  grant_id?: string;
  /** Immutable snapshot identity from the Step 08a capture (E6/E7). */
  snapshot_id?: string;
  document_id?: string;
  revision?: number;
  content_id?: string;
  mime: string;
  alt: string;
}

export type HtmlBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: HtmlHeadingLevel; text: string }
  | { kind: "list_item"; ordered: boolean; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; cells: string[][]; header: boolean }
  | { kind: "image"; image: HtmlBlockImage };

/** One bounded page of blocks returned by `readDocumentBlocks` (E7). */
export interface HtmlBlockPage {
  blocks: HtmlBlock[];
  next_cursor?: string | null;
  complete: boolean;
}

/** What the parser accepts. Never an executable format. */
export type DocumentSourceKind = "markdown" | "html";

/** Reasons the document adapter must disclose before writing a PDF. */
export interface DocumentBlockAnalysis {
  blocks: HtmlBlock[];
  /** Some block/attribute was dropped; `layout_loss` is required. */
  layout_loss: boolean;
  /** Remote or unauthorized images were removed. */
  removed_images: number;
  /** Elements with no safe block representation were removed. */
  removed_elements: number;
  /** Characters that the export font cannot display (checked later). */
  unmappable_text: boolean;
}

/** UTF-8 byte length without allocating a second string. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** True when a block is inside every E6 field limit. */
export function isBoundedHtmlBlock(block: unknown): block is HtmlBlock {
  if (!isRecord(block) || typeof block.kind !== "string") return false;
  switch (block.kind) {
    case "paragraph":
      return boundedText(block.text);
    case "heading":
      return (
        boundedText(block.text) &&
        Number.isInteger(block.level) &&
        (block.level as number) >= 1 &&
        (block.level as number) <= 6
      );
    case "list_item":
      return (
        boundedText(block.text) &&
        typeof block.ordered === "boolean" &&
        Number.isInteger(block.level) &&
        (block.level as number) >= 0 &&
        (block.level as number) <= 8
      );
    case "code":
      return boundedText(block.text);
    case "table":
      return boundedTable(block.cells) && typeof block.header === "boolean";
    case "image":
      return boundedImage(block.image);
    default:
      return false;
  }
}

/** True for a page the native side may accept (E7). */
export function isBoundedHtmlBlockPage(page: unknown): page is HtmlBlockPage {
  if (!isRecord(page) || !Array.isArray(page.blocks)) return false;
  if (page.blocks.length > MAX_BLOCKS_PER_PAGE) return false;
  if (typeof page.complete !== "boolean") return false;
  if (page.next_cursor !== undefined && page.next_cursor !== null && !isUuid(page.next_cursor)) return false;
  return page.blocks.every(isBoundedHtmlBlock);
}

/** Only plain text leaves this model for an HTML export. */
export function escapeHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The text of a block for search, layout and accessible labels. */
export function blockPlainText(block: HtmlBlock): string {
  switch (block.kind) {
    case "paragraph":
    case "heading":
    case "code":
      return block.text;
    case "list_item":
      return block.text;
    case "table":
      return block.cells.map((row) => row.join("\t")).join("\n");
    case "image":
      return block.image.alt;
  }
}

/** Blocks the parser/page reader may return for one cursor. */
export function paginateBlocks(
  blocks: readonly HtmlBlock[],
  offset: number,
): { blocks: HtmlBlock[]; next: number | null; complete: boolean } {
  const start = Math.max(0, Math.min(blocks.length, Math.trunc(offset) || 0));
  const end = Math.min(blocks.length, start + MAX_BLOCKS_PER_PAGE);
  return { blocks: blocks.slice(start, end), next: end < blocks.length ? end : null, complete: end >= blocks.length };
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\u0000") && utf8Length(value) <= MAX_BLOCK_TEXT_BYTES;
}

function boundedTable(value: unknown): value is string[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TABLE_ROWS) return false;
  let cells = 0;
  for (const row of value) {
    if (!Array.isArray(row) || row.length > MAX_TABLE_COLUMNS) return false;
    for (const cell of row) {
      if (typeof cell !== "string" || !boundedText(cell)) return false;
      cells += 1;
    }
  }
  return cells <= MAX_TABLE_CELLS;
}

function boundedImage(value: unknown): value is HtmlBlockImage {
  if (!isRecord(value)) return false;
  if (typeof value.mime !== "string" || value.mime.length === 0 || value.mime.length > 128) return false;
  if (typeof value.alt !== "string" || value.alt.length > 512) return false;
  if (value.grant_id !== undefined && !isUuid(value.grant_id)) return false;
  if (value.snapshot_id !== undefined && !isUuid(value.snapshot_id)) return false;
  if (value.content_id !== undefined && !isUuid(value.content_id)) return false;
  if (value.document_id !== undefined && (typeof value.document_id !== "string" || value.document_id.length > 128)) {
    return false;
  }
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)) {
    return false;
  }
  return (
    value.grant_id !== undefined ||
    (value.snapshot_id !== undefined &&
      value.document_id !== undefined &&
      value.revision !== undefined &&
      value.content_id !== undefined)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
