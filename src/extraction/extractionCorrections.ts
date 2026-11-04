import type {
  ExtractionAnchor,
  ExtractionCorrection,
  ExtractionReview,
  ExtractionTable,
  ExtractionValue,
} from "../services/aiExtractionTypes";
import { validateExtractionCorrection } from "../services/aiExtractionValidation";

/** Typed corrections for one immutable review (Step 17d T4, D4).
 *
 * The source never changes: a correction edits only the reviewed model. Every
 * call is one revision (CAS): the expected revision must still be current and
 * each edited value must still hold the text the user saw. A batch produces
 * one new revision and one new content id, and never leaves a non-rectangular
 * table.
 */

export const MAX_CORRECTIONS = 1000;
export const MAX_TABLE_COLUMNS = 100;

function cloneReview(review: ExtractionReview): ExtractionReview {
  return JSON.parse(JSON.stringify(review)) as ExtractionReview;
}

export function newUuid(): string {
  const generator = globalThis.crypto?.randomUUID;
  if (typeof generator === "function") return generator.call(globalThis.crypto);
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

interface ValueSlot {
  value: ExtractionValue;
  replace: (next: ExtractionValue) => void;
}

function tableSlots(review: ExtractionReview): Array<{ table: ExtractionTable; replace: (next: ExtractionTable) => void }> {
  const slots = review.tables.map((table, index) => ({
    table,
    replace: (next: ExtractionTable) => {
      review.tables[index] = next;
    },
  }));
  review.receipts.forEach((receipt, index) => {
    slots.push({
      table: receipt.line_items,
      replace: (next: ExtractionTable) => {
        review.receipts[index].line_items = next;
      },
    });
  });
  return slots;
}

function findValue(review: ExtractionReview, id: string): ValueSlot | null {
  for (const block of review.blocks) {
    if (block.text && block.text.id === id) {
      const value = block.text;
      return { value, replace: (next) => (block.text = next) };
    }
    const index = block.list_items.findIndex((item) => item.id === id);
    if (index >= 0) {
      const value = block.list_items[index];
      return { value, replace: (next) => (block.list_items[index] = next) };
    }
  }
  for (const { table } of tableSlots(review)) {
    const column = table.columns.find((entry) => entry.name.id === id);
    if (column) {
      return { value: column.name, replace: (next) => (column.name = next) };
    }
    for (const row of table.rows) {
      const cell = row.cells.find((entry) => entry.id === id);
      if (cell) {
        return { value: cell, replace: (next) => Object.assign(cell, next) };
      }
    }
  }
  const receiptFields = [
    "vendor",
    "tax_id",
    "date",
    "currency",
    "subtotal",
    "tax",
    "total",
  ] as const;
  for (const receipt of review.receipts) {
    for (const key of receiptFields) {
      const value = receipt[key];
      if (value.id === id) {
        return { value, replace: (next) => Object.assign(receipt, { [key]: next }) };
      }
    }
  }
  return null;
}

function findTable(review: ExtractionReview, tableId: string): ExtractionTable | null {
  const direct = review.tables.find((table) => table.id === tableId);
  if (direct) return direct;
  return review.receipts.find((receipt) => receipt.line_items.id === tableId)?.line_items ?? null;
}

function corrected(value: ExtractionValue, next: string, revision: number): ExtractionValue {
  return {
    ...value,
    value: next,
    status: "corrected",
    correction_revision: revision,
  };
}

function applyOne(review: ExtractionReview, correction: ExtractionCorrection, revision: number): void {
  if (correction.kind === "field") {
    const slot = findValue(review, correction.id);
    if (!slot) throw new Error("ai_extract.invalid");
    if (slot.value.value !== correction.expected) throw new Error("ai_extract.changed");
    slot.replace(corrected(slot.value, correction.value, revision));
    return;
  }
  const table = findTable(review, correction.table_id);
  if (!table) throw new Error("ai_extract.invalid");
  if (correction.kind === "table_cell") {
    const columnIndex = table.columns.findIndex((column) => column.id === correction.column_id);
    const row = table.rows.find((entry) => entry.id === correction.row_id);
    if (columnIndex < 0 || !row) throw new Error("ai_extract.invalid");
    const cell = row.cells[columnIndex];
    if (!cell) throw new Error("ai_extract.invalid");
    if (cell.value !== correction.expected) throw new Error("ai_extract.changed");
    row.cells[columnIndex] = corrected(cell, correction.value, revision);
    return;
  }
  if (correction.kind === "split_column") {
    const index = table.columns.findIndex((column) => column.id === correction.column_id);
    if (index < 0) throw new Error("ai_extract.invalid");
    splitColumn(table, index, correction.separator, revision);
    return;
  }
  const indices = correction.column_ids.map((id) => table.columns.findIndex((column) => column.id === id));
  if (indices.some((value) => value < 0) || new Set(indices).size !== indices.length) {
    throw new Error("ai_extract.invalid");
  }
  mergeColumns(table, indices, correction.separator, revision);
}

function splitParts(text: string, separator: string): string[] {
  return text.split(separator).map((part) => part.trim());
}

function splitColumn(table: ExtractionTable, index: number, separator: string, revision: number): void {
  const column = table.columns[index];
  const header = splitParts(column.name.value, separator);
  // Keep every piece a cell holds: the widest split fixes the column count so
  // no data is dropped and every row stays rectangular.
  const widest = table.rows.reduce(
    (count, row) => Math.max(count, splitParts(row.cells[index]?.value ?? "", separator).length),
    header.length,
  );
  const parts = Math.max(1, widest);
  if (table.columns.length - 1 + parts > MAX_TABLE_COLUMNS) throw new Error("ai_extract.too_large");
  const names = Array.from({ length: parts }, (_, part) => header[part] ?? "");
  const columns = names.map((name) => ({
    id: newUuid(),
    name: corrected(column.name, name, revision),
    type: column.type,
  }));
  for (const row of table.rows) {
    const cell = row.cells[index];
    const pieces = splitParts(cell?.value ?? "", separator);
    const cells = Array.from({ length: parts }, (_, part) =>
      corrected(cell ?? column.name, pieces[part] ?? "", revision),
    );
    if (cells[0]) cells[0] = { ...cells[0], id: cell?.id ?? newUuid(), original: cell?.original ?? "" };
    row.cells.splice(index, 1, ...cells);
  }
  table.columns.splice(index, 1, ...columns);
}

function mergeColumns(table: ExtractionTable, indices: number[], separator: string, revision: number): void {
  const ordered = [...indices].sort((a, b) => a - b);
  const first = ordered[0];
  const columns = ordered.map((index) => table.columns[index]);
  const name = columns.map((column) => column.name.value).join(separator);
  for (const row of table.rows) {
    const cells = ordered.map((index) => row.cells[index]);
    const merged = corrected(
      cells[0],
      cells.map((cell) => cell?.value ?? "").join(separator),
      revision,
    );
    row.cells.splice(first, ordered.length, merged);
  }
  table.columns.splice(first, ordered.length, {
    id: newUuid(),
    name: corrected(columns[0].name, name, revision),
    type: columns[0].type,
  });
}

/** One atomic correction batch: revision + 1, new content id, source intact. */
export function applyCorrections(
  review: ExtractionReview,
  expectedRevision: number,
  corrections: readonly ExtractionCorrection[],
): ExtractionReview {
  if (review.revision !== expectedRevision) throw new Error("ai_extract.changed");
  if (corrections.length < 1 || corrections.length > MAX_CORRECTIONS) throw new Error("ai_extract.invalid");
  const typed = corrections.map(validateExtractionCorrection);
  const next = cloneReview(review);
  const revision = expectedRevision + 1;
  for (const correction of typed) applyOne(next, correction, revision);
  return {
    ...next,
    revision,
    content_id: newUuid(),
    next_cursor: null,
  };
}

export interface ExportBlockers {
  uncertain: number;
  inconsistent: number;
  missing: number;
  corrected: number;
}

/** Count the fields a person must review or acknowledge before export (D4). */
export function exportBlockers(review: ExtractionReview): ExportBlockers {
  const counts: ExportBlockers = { uncertain: 0, inconsistent: 0, missing: 0, corrected: 0 };
  const inspect = (value: ExtractionValue): void => {
    if (value.status === "uncertain") counts.uncertain += 1;
    else if (value.status === "inconsistent") counts.inconsistent += 1;
    else if (value.status === "missing") counts.missing += 1;
    else if (value.status === "corrected") counts.corrected += 1;
  };
  for (const block of review.blocks) {
    if (block.text) inspect(block.text);
    block.list_items.forEach(inspect);
  }
  for (const table of tableSlots(review).map((slot) => slot.table)) {
    table.columns.forEach((column) => inspect(column.name));
    table.rows.forEach((row) => row.cells.forEach(inspect));
  }
  for (const receipt of review.receipts) {
    for (const key of ["vendor", "tax_id", "date", "currency", "subtotal", "tax", "total"] as const) {
      inspect(receipt[key]);
    }
  }
  return counts;
}

/** Export is blocked until every uncertain, inconsistent or missing field is
 * explicitly reviewed (D4); corrected fields do not block. */
export function canExportReview(review: ExtractionReview): boolean {
  const blockers = exportBlockers(review);
  return blockers.uncertain === 0 && blockers.inconsistent === 0 && blockers.missing === 0;
}

export interface FieldFocus {
  value: ExtractionValue;
  source_id: string;
  page: number;
  anchor: ExtractionAnchor;
}

/** Selecting a field shows its first source anchor without moving the source
 * itself (D4). A field without an anchor cannot be located. */
export function focusAnchor(review: ExtractionReview, valueId: string): FieldFocus | null {
  const slot = findValue(review, valueId);
  if (!slot) return null;
  const anchor = slot.value.anchors[0];
  if (!anchor) return null;
  return {
    value: slot.value,
    source_id: anchor.source_id,
    page: anchor.page,
    anchor,
  };
}

/** Every table row keeps exactly one cell per column. */
export function isRectangular(table: ExtractionTable): boolean {
  return table.rows.every((row) => row.cells.length === table.columns.length);
}

/** Join cursor-bound immutable pages in order. Sources come from the first
 * page; records keep their original order and warnings stay unique. */
export function mergeReviewPages(pages: readonly ExtractionReview[]): ExtractionReview {
  if (pages.length === 0) throw new Error("ai_extract.invalid");
  const first = pages[0];
  const blocks = pages.flatMap((page) => page.blocks);
  const tables = pages.flatMap((page) => page.tables);
  const receipts = pages.flatMap((page) => page.receipts);
  const warnings: string[] = [];
  for (const page of pages) {
    for (const warning of page.warnings) {
      if (!warnings.includes(warning) && warnings.length < 32) warnings.push(warning);
    }
  }
  const last = pages[pages.length - 1];
  return {
    ...first,
    blocks,
    tables,
    receipts,
    warnings,
    complete: last.complete && last.next_cursor === null,
    next_cursor: null,
  };
}
