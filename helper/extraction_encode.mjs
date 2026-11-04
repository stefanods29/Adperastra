// Encodes one reviewed extraction snapshot into a separate DOCX, Markdown,
// text, XLSX or CSV file (Step 17d T5, decisions D6/D7).
//
// This module is plain Node/browser ESM shared by the isolated encode helper
// and its tests. It never reads or writes a user path: bytes are returned to
// the parent, which owns staging, flush, no-replace publication and history.
// Only the pinned docx 9.15.0 and ExcelJS 4.4.0 encoders are used; there is
// no Office engine, no macro, no formula evaluation and no raster page.

import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import ExcelJS from "exceljs";

export const EXTRACTION_ENCODER_VERSION = "1";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MIMES = {
  docx: DOCX_MIME,
  xlsx: XLSX_MIME,
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
};

/** Text that a spreadsheet might execute is stored literally with the
 * apostrophe prefix; the warning `formula_safety_prefix` discloses it. */
export function spreadsheetCell(value, type = "text") {
  const text = value === null || value === undefined ? "" : String(value);
  if (type === "number" && /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
    const number = Number(text.replace(/,/g, ""));
    if (Number.isFinite(number)) return number;
  }
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export function needsFormulaSafety(values) {
  return values.some((value) => /^[=+\-@\t\r]/.test(String(value ?? "")));
}

/** RFC 4180 quoting with an explicit delimiter; quotes are doubled. */
export function csvField(value, delimiter = ",") {
  const text = String(value ?? "");
  const needsQuotes = text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export function delimiterOf(name) {
  if (name === "semicolon") return ";";
  if (name === "tab") return "\t";
  return ",";
}

function csvBytes(rows, delimiter) {
  const text = rows.map((row) => row.map((cell) => csvField(cell, delimiter)).join(delimiter)).join("\r\n");
  return new TextEncoder().encode(`\uFEFF${text}\r\n`);
}

function selectedTable(snapshot) {
  const review = snapshot.review;
  const publish = snapshot.publish;
  if (publish.table_id) {
    const table = review.tables.find((entry) => entry.id === publish.table_id);
    if (table) return table;
  }
  if (review.tables.length > 0) return review.tables[0];
  if (review.receipts.length > 0) return review.receipts[0].line_items;
  return null;
}

function columnNames(table) {
  return table ? table.columns.map((column) => column.name.value) : [];
}

function tableRows(table) {
  return table ? table.rows.map((row) => row.cells.map((cell) => cell.value)) : [];
}

function receiptRows(snapshot) {
  const labels = snapshot.labels?.receipt_columns;
  if (!Array.isArray(labels) || labels.length !== 7) return null;
  return {
    columns: labels.slice(0, 7),
    rows: snapshot.review.receipts.map((receipt) => [
      receipt.vendor.value,
      receipt.date.value,
      receipt.tax_id.value,
      receipt.currency.value,
      receipt.subtotal.value,
      receipt.tax.value,
      receipt.total.value,
    ]),
  };
}

/** The reading-order document model, with real headings/lists/tables and no
 * image-as-page substitute. */
export function docxModelFromSnapshot(snapshot) {
  const review = snapshot.review;
  const blocks = [];
  for (const block of review.blocks) {
    if (block.kind === "heading" && block.text) {
      blocks.push({ type: "heading", level: block.heading_level ?? 1, text: block.text.value });
    } else if (block.kind === "paragraph" && block.text) {
      blocks.push({ type: "paragraph", text: block.text.value });
    } else if (block.kind === "list") {
      blocks.push({ type: "list", items: block.list_items.map((item) => item.value) });
    } else if (block.kind === "table") {
      const table = review.tables.find((entry) => entry.id === block.table_id);
      if (table) {
        blocks.push({ type: "table", columns: columnNames(table), rows: tableRows(table) });
      }
    }
  }
  const table = selectedTable(snapshot);
  if (table && !blocks.some((block) => block.type === "table")) {
    blocks.push({ type: "table", columns: columnNames(table), rows: tableRows(table) });
  }
  return { title: snapshot.publish.name, blocks };
}

function headingLevel(level) {
  const levels = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  return levels[level] ?? HeadingLevel.HEADING_1;
}

function docxParagraph(text, bold = false) {
  return new Paragraph({ children: [new TextRun({ text: String(text ?? ""), bold })] });
}

function docxTable(columns, rows) {
  const header = columns.map((text) => new TableCell({ children: [docxParagraph(text, true)] }));
  const body = rows.map(
    (row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [docxParagraph(cell)] })) }),
  );
  return new Table({ rows: [new TableRow({ children: header }), ...body] });
}

/** Real editable DOCX structure (no raster page, no image). */
export async function encodeDocx(snapshot) {
  const model = docxModelFromSnapshot(snapshot);
  const children = [];
  for (const block of model.blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ heading: headingLevel(block.level), children: [new TextRun(block.text)] }));
    } else if (block.type === "paragraph") {
      children.push(docxParagraph(block.text));
    } else if (block.type === "list") {
      for (const item of block.items) {
        children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
      }
    } else if (block.type === "table") {
      children.push(docxTable(block.columns, block.rows));
    }
  }
  const document = new Document({
    creator: "Adperastra",
    title: model.title,
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function safeSheetName(name) {
  const cleaned = String(name ?? "")
    .replace(/[\\/?*[\]:]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 31);
  return cleaned === "" ? "Review" : cleaned;
}

export function spreadsheetRows(snapshot) {
  const receipts = receiptRows(snapshot);
  if (receipts) return receipts;
  const table = selectedTable(snapshot);
  return { columns: columnNames(table), rows: tableRows(table) };
}

/** Literal typed cells, one workbook, one sheet plus a source-reference sheet. */
export async function encodeXlsx(snapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "Adperastra";
  const sheet = book.addWorksheet(safeSheetName(snapshot.publish.name));
  const { columns, rows } = spreadsheetRows(snapshot);
  const types = selectedTable(snapshot)?.columns.map((column) => column.type) ?? [];
  if (columns.length > 0) {
    sheet.addRow(columns);
    sheet.getRow(1).font = { bold: true };
  }
  for (const row of rows) {
    sheet.addRow(row.map((cell, index) => spreadsheetCell(cell, types[index] ?? "text")));
  }
  const labels = Array.isArray(snapshot.source_labels)
    ? snapshot.source_labels
    : Array.isArray(snapshot.labels?.source_labels)
      ? snapshot.labels.source_labels
      : [];
  if (labels.length > 0) {
    const sources = book.addWorksheet("Sources");
    sources.addRow(["Source"]);
    for (const label of labels) sources.addRow([String(label)]);
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

function markdownFromSnapshot(snapshot) {
  const model = docxModelFromSnapshot(snapshot);
  const lines = [];
  for (const block of model.blocks) {
    if (block.type === "heading") {
      lines.push(`${"#".repeat(Math.min(6, Math.max(1, block.level)))} ${block.text}`, "");
    } else if (block.type === "paragraph") {
      lines.push(block.text, "");
    } else if (block.type === "list") {
      for (const item of block.items) lines.push(`- ${item}`);
      lines.push("");
    } else if (block.type === "table") {
      const escape = (cell) => String(cell ?? "").replace(/\|/g, "\\|");
      lines.push(`| ${block.columns.map(escape).join(" | ")} |`);
      lines.push(`| ${block.columns.map(() => "---").join(" | ")} |`);
      for (const row of block.rows) lines.push(`| ${row.map(escape).join(" | ")} |`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function textFromSnapshot(snapshot) {
  const model = docxModelFromSnapshot(snapshot);
  const lines = [];
  for (const block of model.blocks) {
    if (block.type === "heading" || block.type === "paragraph") {
      lines.push(block.text, "");
    } else if (block.type === "list") {
      for (const item of block.items) lines.push(item);
      lines.push("");
    } else if (block.type === "table") {
      lines.push(block.columns.join("\t"));
      for (const row of block.rows) lines.push(row.join("\t"));
      lines.push("");
    }
  }
  return lines.join("\n");
}

function csvFromSnapshot(snapshot, options) {
  const delimiter = delimiterOf(options.delimiter ?? "comma");
  const { columns, rows } = spreadsheetRows(snapshot);
  // CSV has no cell types: formula-like text is stored literally behind the
  // apostrophe prefix, exactly like the workbook path.
  return csvBytes([columns, ...rows.map((row) => row.map((cell) => spreadsheetCell(cell)))], delimiter);
}

/** Encode one format and return the parent-owned output draft metadata. */
export async function encodeExtractionOutput(snapshot, format, options = {}) {
  if (!MIMES[format]) throw new Error("ai_extract.unsupported");
  let bytes;
  let warnings = [];
  if (format === "docx") bytes = await encodeDocx(snapshot);
  else if (format === "xlsx") {
    bytes = await encodeXlsx(snapshot);
    if (needsFormulaSafety(spreadsheetRows(snapshot).rows.flat())) warnings.push("formula_safety_prefix");
  } else if (format === "csv") {
    bytes = csvFromSnapshot(snapshot, options);
    if (needsFormulaSafety(spreadsheetRows(snapshot).rows.flat())) warnings.push("formula_safety_prefix");
  } else if (format === "md") bytes = new TextEncoder().encode(markdownFromSnapshot(snapshot));
  else bytes = new TextEncoder().encode(textFromSnapshot(snapshot));
  if (format === "docx" || format === "md" || format === "txt") warnings = ["layout_loss"];
  return {
    bytes,
    draft: {
      name_hint: snapshot.publish.name,
      name_part: { kind: "none" },
      mime: MIMES[format],
      input_indices: [0],
    },
    warnings,
  };
}
