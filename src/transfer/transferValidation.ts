import {
  documentSourceKey,
  isUuid,
  validateDocumentRef,
  type DocumentRef,
} from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  TransferBlock,
  TransferCell,
  TransferCellFormat,
  TransferEnvelope,
  TransferMark,
  TransferPayload,
  TransferRgba,
  TransferTextRun,
} from "./types";

/** Bounded validation for every transfer DTO (Step 09c D1/D5/D6/D7).
 * Every function returns a normalized, frozen copy or null. Unknown
 * fields, unknown kinds, unsorted page lists, mismatched cell values and
 * non-finite numbers are refused, never coerced. Native code repeats the
 * checks; this layer keeps malformed data out of the renderer. */

export const MAX_TRANSFER_TEXT_SCALARS = 1_048_576,
  MAX_TRANSFER_RICH_BLOCKS = 10_000,
  MAX_TRANSFER_RICH_BYTES = 8 * 1024 * 1024,
  MAX_TRANSFER_RUNS_PER_BLOCK = 1_000,
  MAX_TRANSFER_MARKS_PER_RUN = 8,
  MAX_TRANSFER_BLOCK_DEPTH = 8,
  MAX_TRANSFER_CELLS = 100_000,
  MAX_TRANSFER_CELL_BYTES = 8 * 1024 * 1024,
  MAX_TRANSFER_COLUMNS = 2_000,
  MAX_TRANSFER_CELL_TEXT_UTF16 = 32_767,
  MAX_TRANSFER_CELL_FORMAT = 128,
  MAX_TRANSFER_FILE_SOURCES = 1_000,
  MAX_TRANSFER_PDF_PAGES = 100,
  MAX_TRANSFER_SOURCE_TAB_ID = 128,
  MAX_TRANSFER_SNAPSHOT_BYTES = 256 * 1024 * 1024;

const U32_MAX = 4_294_967_295;

type Obj = Record<string, unknown>;

function shape(value: unknown, keys: readonly string[]): Obj | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Obj;
  return Object.keys(object).every((key) => keys.includes(key)) ? object : null;
}

function int(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function str(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function color(value: unknown): TransferRgba | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  for (const channel of value) {
    if (!int(channel, 0, 255)) return null;
  }
  return [value[0], value[1], value[2], value[3]] as TransferRgba;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}

function scalarCount(text: string, limit: number): number {
  let count = 0;
  for (const _character of text) {
    count += 1;
    if (count > limit) return count;
  }
  return count;
}

function mark(value: unknown): TransferMark | null {
  const source = shape(value, ["kind", "foreground_rgba"]);
  if (!source) return null;
  if (source.kind === "foreground") {
    const rgba = color(source.foreground_rgba);
    return rgba ? { kind: "foreground", foreground_rgba: rgba } : null;
  }
  const kind = source.kind;
  if (kind !== "bold" && kind !== "italic" && kind !== "underline" && kind !== "strike" && kind !== "code") {
    return null;
  }
  return Object.keys(source).length === 1 ? { kind } : null;
}

function run(value: unknown): TransferTextRun | null {
  const source = shape(value, ["text", "marks"]);
  if (!source || typeof source.text !== "string") return null;
  if (!Array.isArray(source.marks) || source.marks.length > MAX_TRANSFER_MARKS_PER_RUN) return null;
  const marks: TransferMark[] = [];
  const seen = new Set<string>();
  for (const entry of source.marks) {
    const entryMark = mark(entry);
    if (!entryMark || seen.has(entryMark.kind)) return null;
    seen.add(entryMark.kind);
    marks.push(entryMark);
  }
  return { text: source.text, marks };
}

function block(value: unknown): TransferBlock | null {
  const source = shape(value, ["kind", "runs", "level", "list_order", "depth"]);
  if (!source) return null;
  const kind = source.kind;
  if (kind !== "paragraph" && kind !== "heading" && kind !== "list_item") return null;
  if (!Array.isArray(source.runs) || source.runs.length > MAX_TRANSFER_RUNS_PER_BLOCK) return null;
  const runs: TransferTextRun[] = [];
  for (const entry of source.runs) {
    const entryRun = run(entry);
    if (!entryRun) return null;
    runs.push(entryRun);
  }
  if (!int(source.depth, 0, MAX_TRANSFER_BLOCK_DEPTH)) return null;
  const result: TransferBlock = { kind, runs, depth: source.depth };
  if (source.level !== undefined) {
    if (kind !== "heading" || !int(source.level, 1, 6)) return null;
    result.level = source.level;
  }
  if (source.list_order !== undefined) {
    if (kind !== "list_item" || (source.list_order !== "ordered" && source.list_order !== "unordered")) {
      return null;
    }
    result.list_order = source.list_order;
  }
  return result;
}

function format(value: unknown): TransferCellFormat | null {
  const source = shape(value, ["number_format", "bold", "italic", "foreground_rgba", "background_rgba"]);
  if (!source) return null;
  const result: TransferCellFormat = {};
  if (source.number_format !== undefined) {
    if (!str(source.number_format, 0, MAX_TRANSFER_CELL_FORMAT)) return null;
    result.number_format = source.number_format;
  }
  for (const key of ["bold", "italic"] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return null;
    result[key] = value;
  }
  for (const key of ["foreground_rgba", "background_rgba"] as const) {
    const value = source[key];
    if (value === undefined) continue;
    const rgba = color(value);
    if (!rgba) return null;
    result[key] = rgba;
  }
  return result;
}

function cell(value: unknown): TransferCell | null {
  const source = shape(value, ["kind", "text", "number", "boolean", "format"]);
  if (!source) return null;
  const result: TransferCell = { kind: "blank" };
  if (source.kind === "text") {
    if (!str(source.text, 0, MAX_TRANSFER_CELL_TEXT_UTF16)) return null;
    if (source.number !== undefined || source.boolean !== undefined) return null;
    result.kind = "text";
    result.text = source.text;
  } else if (source.kind === "number") {
    if (typeof source.number !== "number" || !Number.isFinite(source.number)) return null;
    if (source.text !== undefined || source.boolean !== undefined) return null;
    result.kind = "number";
    result.number = source.number;
  } else if (source.kind === "boolean") {
    if (typeof source.boolean !== "boolean" || source.text !== undefined || source.number !== undefined) {
      return null;
    }
    result.kind = "boolean";
    result.boolean = source.boolean;
  } else if (source.kind !== "blank") {
    return null;
  } else if (source.text !== undefined || source.number !== undefined || source.boolean !== undefined) {
    return null;
  }
  if (source.format !== undefined) {
    const cellFormat = format(source.format);
    if (!cellFormat) return null;
    result.format = cellFormat;
  }
  return result;
}

function sourceStamp(value: unknown): boolean {
  const source = shape(value, ["path_key", "volume_id", "file_id", "modified_ticks", "size_bytes"]);
  return Boolean(
    source &&
      typeof source.path_key === "string" &&
      typeof source.volume_id === "string" &&
      typeof source.file_id === "string" &&
      typeof source.modified_ticks === "string" &&
      int(source.size_bytes, 0),
  );
}

export function validateExportSnapshot(value: unknown): ExportSnapshot | null {
  const source = shape(value, [
    "snapshot_id",
    "document_id",
    "revision",
    "content_id",
    "mime",
    "byte_len",
    "source",
    "storage_policy",
    "expires_unix",
  ]);
  if (!source || !isUuid(source.snapshot_id) || !isUuid(source.content_id)) return null;
  if (!str(source.document_id, 1, 128) || !int(source.revision, 1)) return null;
  if (!str(source.mime, 1, 128) || !/^[\x21-\x7e]+$/.test(source.mime)) return null;
  if (!int(source.byte_len, 0, MAX_TRANSFER_SNAPSHOT_BYTES) || !int(source.expires_unix, 1)) return null;
  if (source.storage_policy !== "ordinary" && source.storage_policy !== "sensitive") return null;
  if (source.source !== undefined && !sourceStamp(source.source)) return null;
  return {
    snapshot_id: source.snapshot_id,
    document_id: source.document_id,
    revision: source.revision,
    content_id: source.content_id,
    mime: source.mime,
    byte_len: source.byte_len,
    ...(source.source === undefined ? {} : { source: source.source }),
    storage_policy: source.storage_policy,
    expires_unix: source.expires_unix,
  } as ExportSnapshot;
}

function files(value: unknown): DocumentRef[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TRANSFER_FILE_SOURCES) return null;
  const sources: DocumentRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const source = validateDocumentRef(entry);
    if (!source) return null;
    const key = documentSourceKey(source);
    if (seen.has(key)) return null;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

export function validateTransferPayload(value: unknown): TransferPayload | null {
  const source = shape(value, [
    "kind",
    "text",
    "blocks",
    "rows",
    "row_count",
    "column_count",
    "snapshot",
    "width",
    "height",
    "pages",
    "sources",
  ]);
  if (!source) return null;
  if (source.kind === "text") {
    if (Object.keys(source).length !== 2 || typeof source.text !== "string") return null;
    if (scalarCount(source.text, MAX_TRANSFER_TEXT_SCALARS) > MAX_TRANSFER_TEXT_SCALARS) return null;
    return freeze({ kind: "text", text: source.text } as TransferPayload);
  }
  if (source.kind === "rich_text") {
    if (Object.keys(source).length !== 2 || !Array.isArray(source.blocks)) return null;
    if (source.blocks.length < 1 || source.blocks.length > MAX_TRANSFER_RICH_BLOCKS) return null;
    const blocks: TransferBlock[] = [];
    for (const entry of source.blocks) {
      const entryBlock = block(entry);
      if (!entryBlock) return null;
      blocks.push(entryBlock);
    }
    if (new TextEncoder().encode(JSON.stringify(blocks)).length > MAX_TRANSFER_RICH_BYTES) return null;
    return freeze({ kind: "rich_text", blocks } as TransferPayload);
  }
  if (source.kind === "cells") {
    if (Object.keys(source).length !== 4 || !Array.isArray(source.rows)) return null;
    const { row_count: rowCount, column_count: columnCount } = source;
    if (!int(rowCount, 1, U32_MAX) || !int(columnCount, 1, MAX_TRANSFER_COLUMNS)) return null;
    if (source.rows.length !== rowCount || rowCount * columnCount > MAX_TRANSFER_CELLS) return null;
    const rows: TransferCell[][] = [];
    for (const rowValue of source.rows) {
      if (!Array.isArray(rowValue) || rowValue.length !== columnCount) return null;
      const row: TransferCell[] = [];
      for (const cellValue of rowValue) {
        const entry = cell(cellValue);
        if (!entry) return null;
        row.push(entry);
      }
      rows.push(row);
    }
    if (new TextEncoder().encode(JSON.stringify(rows)).length > MAX_TRANSFER_CELL_BYTES) return null;
    return freeze({ kind: "cells", rows, row_count: rowCount, column_count: columnCount } as TransferPayload);
  }
  if (source.kind === "image") {
    if (Object.keys(source).length !== 4) return null;
    const snapshot = validateExportSnapshot(source.snapshot);
    if (!snapshot || !snapshot.mime.toLowerCase().startsWith("image/")) return null;
    if (!int(source.width, 1, U32_MAX) || !int(source.height, 1, U32_MAX)) return null;
    return freeze({ kind: "image", snapshot, width: source.width, height: source.height } as TransferPayload);
  }
  if (source.kind === "pdf_pages") {
    if (Object.keys(source).length !== 3 || !Array.isArray(source.pages)) return null;
    const snapshot = validateExportSnapshot(source.snapshot);
    if (!snapshot || snapshot.mime.toLowerCase() !== "application/pdf") return null;
    if (source.pages.length < 1 || source.pages.length > MAX_TRANSFER_PDF_PAGES) return null;
    const pages: number[] = [];
    let previous = 0;
    for (const page of source.pages) {
      if (!int(page, 1, U32_MAX) || page <= previous) return null;
      previous = page;
      pages.push(page);
    }
    return freeze({ kind: "pdf_pages", snapshot, pages } as TransferPayload);
  }
  if (source.kind === "files") {
    if (Object.keys(source).length !== 2) return null;
    const sources = files(source.sources);
    return sources ? freeze({ kind: "files", sources } as TransferPayload) : null;
  }
  return null;
}

export function validateTransferEnvelope(value: unknown): TransferEnvelope | null {
  const source = shape(value, [
    "transfer_id",
    "source_document_id",
    "source_revision",
    "sensitive",
    "payload",
    "expires_unix",
    "source_tab_id",
  ]);
  if (!source || !isUuid(source.transfer_id) || typeof source.sensitive !== "boolean") return null;
  if (!int(source.expires_unix, 1)) return null;
  if (source.source_document_id !== undefined && !isUuid(source.source_document_id)) return null;
  if (source.source_revision !== undefined && !int(source.source_revision, 1)) return null;
  if (source.source_revision !== undefined && source.source_document_id === undefined) return null;
  if (source.source_tab_id !== undefined && !str(source.source_tab_id, 1, MAX_TRANSFER_SOURCE_TAB_ID)) {
    return null;
  }
  const payload = validateTransferPayload(source.payload);
  if (!payload) return null;
  const sourceDocumentId = source.source_document_id as string | undefined;
  const sourceRevision = source.source_revision as number | undefined;
  const sourceTabId = source.source_tab_id as string | undefined;
  const transferId = source.transfer_id as string;
  let sensitive = source.sensitive === true;
  if (payload.kind === "image" || payload.kind === "pdf_pages") {
    if (payload.snapshot.document_id !== sourceDocumentId) return null;
    if (payload.snapshot.revision !== sourceRevision) return null;
    if (payload.snapshot.storage_policy === "sensitive") sensitive = true;
  }
  return freeze({
    transfer_id: transferId,
    ...(sourceDocumentId === undefined ? {} : { source_document_id: sourceDocumentId }),
    ...(sourceRevision === undefined ? {} : { source_revision: sourceRevision }),
    sensitive,
    payload,
    expires_unix: source.expires_unix as number,
    ...(sourceTabId === undefined ? {} : { source_tab_id: sourceTabId }),
  });
}
