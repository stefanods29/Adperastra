import type {
  ConversionInput,
  ConversionRequest,
  ConversionWarningCode,
  ConvertOptions,
  ConverterSpec,
  FormatId,
} from "./types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type { ExtractionOutputFormat, ExtractionPublish, ExtractionReview, ExtractionTable } from "../services/aiExtractionTypes";

/** The five static extraction converters (Step 17d T5, decision D6/D7).
 *
 * Encoding happens in the isolated helper; this module only declares the
 * static adapters and builds the exact 08a request. The parent owns naming,
 * staging, no-replace publication and history; no file writer exists here.
 */

/** Additive format id for the captured extraction model (08a `FormatId`
 * gains `extraction_json`; IDs are only added, never renamed). */
export const EXTRACTION_SNAPSHOT_FORMAT = "extraction_json" as FormatId;
export const EXTRACTION_PROVIDER_VERSION = "1";
export const EXTRACTION_FORMATS: readonly ExtractionOutputFormat[] = ["docx", "md", "txt", "xlsx", "csv"];

const HELP_SLUGS: Record<ExtractionOutputFormat, string> = {
  docx: "turning-scans-into-documents",
  md: "turning-scans-into-documents",
  txt: "turning-scans-into-documents",
  xlsx: "extracting-tables",
  csv: "extracting-tables",
};

export function extractionConverterId(format: ExtractionOutputFormat): string {
  return `extraction_${format}`;
}

function spec(format: ExtractionOutputFormat): ConverterSpec {
  return {
    id: extractionConverterId(format),
    inputs: [EXTRACTION_SNAPSHOT_FORMAT],
    output: format as FormatId,
    options: [],
    // One capture produces exactly one document or one workbook (D7).
    input_mode: "each",
    max_input_bytes: 16 * 1024 * 1024,
    max_output_bytes: 512 * 1024 * 1024,
    lossy: false,
    preserves: [],
    engine_id: "extraction-encode",
    available: true,
    help_slug: HELP_SLUGS[format],
  };
}

export const EXTRACTION_CONVERTERS: readonly ConverterSpec[] = EXTRACTION_FORMATS.map(spec);

/** Static app registration; duplicate ids are refused by 08a. */
export function registerExtractionConverters(register: (spec: ConverterSpec) => void): void {
  for (const converter of EXTRACTION_CONVERTERS) register(converter);
}

export function conversionOptionsFor(
  format: ExtractionOutputFormat,
  title?: string,
): ConvertOptions {
  if (format === "xlsx" || format === "csv") {
    return {
      kind: "table",
      value: {
        delimiter: "comma",
        header: true,
        formulas: "text",
        dates: "iso",
        newline: "crlf",
      },
    };
  }
  return {
    kind: "document",
    value: {
      include_images: true,
      page_size: "a4",
      margin_mm: 20,
      sanitize: true,
      encoding: "utf8",
      ...(title ? { title } : {}),
    },
  };
}

/** The snapshot identity is the only input; no review object or path. */
export function conversionInput(snapshot: ExportSnapshot): ConversionInput {
  return {
    kind: "snapshot",
    snapshot_id: snapshot.snapshot_id,
    document_id: snapshot.document_id,
    revision: snapshot.revision,
  };
}

/** The exact 08a request: keep the original, no replace, acknowledged
 * losses, one UTC date captured on confirmation and the parent's naming. */
export function buildConversionRequest(
  publish: ExtractionPublish,
  snapshot: ExportSnapshot,
  capturedUtc: string,
  acceptedWarnings?: readonly ConversionWarningCode[],
): ConversionRequest {
  const warnings = [...(acceptedWarnings ?? publish.accepted_warning_codes)].filter(
    (code, index, all) => all.indexOf(code) === index,
  );
  return {
    inputs: [conversionInput(snapshot)],
    converter_id: extractionConverterId(publish.format),
    options: conversionOptionsFor(publish.format, publish.name),
    dest_dir: publish.dest_dir,
    keep_original: true,
    accepted_losses: [],
    accepted_warning_codes: warnings,
    request_revision: 1,
    naming: { pattern: "{stem}.{ext}", date_utc: capturedUtc, start_index: 1 },
  };
}

/** Winning cells keep their text; nothing is executed or evaluated. */
export interface OutputTable {
  name: string;
  columns: string[];
  rows: string[][];
}

export interface OutputBlock {
  type: "heading" | "paragraph" | "list" | "table";
  level?: number;
  text?: string;
  items?: string[];
  table?: OutputTable;
}

/** The inert model handed to the encoder: no paths, tokens or formulas. */
export interface ExtractionOutputModel {
  schema: 1;
  title: string;
  blocks: OutputBlock[];
  selected_table: OutputTable | null;
  source_labels: string[];
  sensitive: boolean;
}

function rowsOf(table: ExtractionTable): OutputTable {
  return {
    name: table.columns.map((column) => column.name.value).join(" / ").slice(0, 120),
    columns: table.columns.map((column) => column.name.value),
    rows: table.rows.map((row) => row.cells.map((cell) => cell.value)),
  };
}

/** Receipt column labels come from the translated UI, never from code. */
export interface OutputLabels {
  receipt_columns?: readonly string[];
}

/** Build the output document model from the captured review revision. The
 * caller passes one immutable review (or capture), never live UI state. */
export function buildOutputModel(
  review: ExtractionReview,
  publish: ExtractionPublish,
  labels: OutputLabels = {},
): ExtractionOutputModel {
  const blocks: OutputBlock[] = [];
  for (const block of review.blocks) {
    if (block.kind === "heading" && block.text) {
      blocks.push({ type: "heading", level: block.heading_level ?? 1, text: block.text.value });
    } else if (block.kind === "paragraph" && block.text) {
      blocks.push({ type: "paragraph", text: block.text.value });
    } else if (block.kind === "list") {
      blocks.push({ type: "list", items: block.list_items.map((item) => item.value) });
    } else if (block.kind === "table") {
      const table = review.tables.find((entry) => entry.id === block.table_id);
      if (table) blocks.push({ type: "table", table: rowsOf(table) });
    }
  }
  let selected: OutputTable | null = null;
  if (publish.table_id) {
    const table = review.tables.find((entry) => entry.id === publish.table_id);
    if (table) selected = rowsOf(table);
  } else if (review.tables.length > 0) {
    selected = rowsOf(review.tables[0]);
  }
  if (!selected && review.receipts.length > 0) {
    const receiptColumns = labels.receipt_columns?.slice(0, 7);
    const combined: OutputTable = receiptColumns && receiptColumns.length === 7
      ? {
          name: "receipts",
          columns: [...receiptColumns],
          rows: review.receipts.map((receipt) => [
            receipt.vendor.value,
            receipt.date.value,
            receipt.tax_id.value,
            receipt.currency.value,
            receipt.subtotal.value,
            receipt.tax.value,
            receipt.total.value,
          ]),
        }
      : {
          name: "line_items",
          columns: review.receipts[0].line_items.columns.map((column) => column.name.value),
          rows: review.receipts.flatMap((receipt) =>
            receipt.line_items.rows.map((row) => row.cells.map((cell) => cell.value)),
          ),
        };
    selected = combined;
  }
  return {
    schema: 1,
    title: publish.name,
    blocks,
    selected_table: selected,
    // Sensitive labels are logical only; a disk path never leaves the app.
    source_labels:
      publish.include_source_labels && !review.sensitive
        ? review.sources.map((source) => source.display_name)
        : [],
    sensitive: review.sensitive,
  };
}

/** The warnings this format requires before the request may start. */
export function requiredExtractionWarnings(
  model: ExtractionOutputModel,
): ConversionWarningCode[] {
  const warnings: ConversionWarningCode[] = [];
  if (model.blocks.length > 0) warnings.push("layout_loss");
  const cells = model.selected_table?.rows.flat() ?? [];
  if (cells.some((cell) => /^[=+\-@\t\r]/.test(cell))) {
    warnings.push("formula_safety_prefix");
  }
  return warnings;
}

/** True when every required warning was acknowledged. */
export function warningsAcknowledged(
  required: readonly ConversionWarningCode[],
  accepted: readonly string[],
): boolean {
  return required.every((code) => accepted.includes(code));
}
