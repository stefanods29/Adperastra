/** The Step 08b adapter declarations (D1, E1).
 *
 * Every new converter registers through the Step 08a registry with a typed
 * option kind, its real input mode, bounded sizes and only the metadata it
 * actually preserves. No adapter claims a capability it does not have, and
 * no second registry or job queue exists here. */

import type {
  ConverterId,
  ConverterSpec,
  ConvertOptions,
  FormatId,
  MetadataCategory,
} from "./types";

/** The one registration entry the Step 08a registry exposes. Kept
 * structural so this file imports no private registry state. */
export interface ConverterRegistration {
  registerConverter(spec: ConverterSpec): void;
}

/** The exact wire IDs this step adds. */
export const CONVERTER_IDS_08B = [
  "images/pdf",
  "pdf/png",
  "pdf/jpeg",
  "markdown/html",
  "markdown/pdf",
  "html/pdf",
  "csv/xlsx",
  "xlsx/csv",
  "zip/seven_z",
  "seven_z/zip",
] as const;

export type ConverterId08b = (typeof CONVERTER_IDS_08B)[number];

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const HELP = "converting-files";

/** The kinds of `ConvertOptions` each adapter accepts. */
export const ADAPTER_OPTION_KIND_08B: Readonly<Record<ConverterId08b, ConvertOptions["kind"]>> = {
  "images/pdf": "document",
  "pdf/png": "pdf",
  "pdf/jpeg": "pdf",
  "markdown/html": "document",
  "markdown/pdf": "document",
  "html/pdf": "document",
  "csv/xlsx": "table",
  "xlsx/csv": "table",
  "zip/seven_z": "archive",
  "seven_z/zip": "archive",
};

const TIMESTAMPS: MetadataCategory[] = ["timestamps"];

function choice(value: string, labelKey: string): { value: string; label_key: string } {
  return { value, label_key: labelKey };
}

function commonSpec(
  id: ConverterId08b,
  inputs: FormatId[],
  output: FormatId,
  options: ConverterSpec["options"],
  inputMode: ConverterSpec["input_mode"],
  maxInput: number,
  maxOutput: number,
  lossy: boolean,
  preserves: MetadataCategory[],
  engineId: string,
): ConverterSpec {
  return {
    id: id as unknown as ConverterId,
    inputs,
    output,
    options,
    input_mode: inputMode,
    max_input_bytes: maxInput,
    max_output_bytes: maxOutput,
    lossy,
    preserves,
    engine_id: engineId,
    available: true,
    help_slug: HELP,
  };
}

/** Static adapter declarations; registration order is stable. */
export const CONVERSION_ADAPTERS_08B: readonly ConverterSpec[] = [
  commonSpec(
    "images/pdf",
    ["png", "jpeg", "gif", "webp", "bmp", "tiff"],
    "pdf",
    [
      {
        id: "page_size",
        label_key: "convert.pageSize",
        kind: "choice",
        default: "source",
        choices: [
          choice("source", "convert.pageSizeSource"),
          choice("a4", "convert.pageSizeA4"),
          choice("letter", "convert.pageSizeLetter"),
        ],
      },
      { id: "margin_mm", label_key: "convert.margin", kind: "integer", default: 20, min: 0, max: 50 },
    ],
    "combine",
    512 * MIB,
    512 * MIB,
    false,
    [],
    "pdf-lib-1.17.1",
  ),
  commonSpec(
    "pdf/png",
    ["pdf"],
    "png",
    [{ id: "dpi", label_key: "convert.dpi", kind: "integer", default: 150, min: 72, max: 600 }],
    "each",
    512 * MIB,
    GIB,
    false,
    [],
    "pdfjs-6.4.299",
  ),
  commonSpec(
    "pdf/jpeg",
    ["pdf"],
    "jpeg",
    [
      { id: "dpi", label_key: "convert.dpi", kind: "integer", default: 150, min: 72, max: 600 },
      { id: "quality", label_key: "convert.quality", kind: "integer", default: 90, min: 1, max: 100 },
    ],
    "each",
    512 * MIB,
    GIB,
    true,
    [],
    "pdfjs-6.4.299",
  ),
  commonSpec(
    "markdown/html",
    ["md"],
    "html",
    [{ id: "include_images", label_key: "convert.includeImages", kind: "boolean", default: true }],
    "each",
    512 * MIB,
    512 * MIB,
    true,
    [],
    "markdown-it-15.0.3",
  ),
  commonSpec(
    "markdown/pdf",
    ["md"],
    "pdf",
    [
      { id: "include_images", label_key: "convert.includeImages", kind: "boolean", default: true },
      {
        id: "page_size",
        label_key: "convert.pageSize",
        kind: "choice",
        default: "a4",
        choices: [choice("a4", "convert.pageSizeA4"), choice("letter", "convert.pageSizeLetter")],
      },
      { id: "margin_mm", label_key: "convert.margin", kind: "integer", default: 20, min: 0, max: 50 },
    ],
    "each",
    512 * MIB,
    512 * MIB,
    true,
    [],
    "pdf-lib-1.17.1",
  ),
  commonSpec(
    "html/pdf",
    ["html"],
    "pdf",
    [
      { id: "include_images", label_key: "convert.includeImages", kind: "boolean", default: true },
      {
        id: "page_size",
        label_key: "convert.pageSize",
        kind: "choice",
        default: "a4",
        choices: [choice("a4", "convert.pageSizeA4"), choice("letter", "convert.pageSizeLetter")],
      },
      { id: "margin_mm", label_key: "convert.margin", kind: "integer", default: 20, min: 0, max: 50 },
    ],
    "each",
    512 * MIB,
    512 * MIB,
    true,
    [],
    "pdf-lib-1.17.1",
  ),
  commonSpec(
    "csv/xlsx",
    ["csv"],
    "xlsx",
    [
      {
        id: "delimiter",
        label_key: "convert.delimiter",
        kind: "choice",
        default: "comma",
        choices: [choice("comma", "convert.delimiterComma"), choice("tab", "convert.delimiterTab"), choice("semicolon", "convert.delimiterSemicolon")],
      },
      { id: "header", label_key: "convert.header", kind: "boolean", default: true },
    ],
    "each",
    512 * MIB,
    512 * MIB,
    false,
    [],
    "rust_xlsxwriter-0.102.0",
  ),
  commonSpec(
    "xlsx/csv",
    ["xlsx"],
    "csv",
    [
      {
        id: "formulas",
        label_key: "convert.formulas",
        kind: "choice",
        default: "text",
        choices: [choice("text", "convert.formulaText"), choice("preserve", "convert.formulaCached")],
      },
      {
        id: "dates",
        label_key: "convert.dates",
        kind: "choice",
        default: "iso",
        choices: [choice("iso", "convert.datesIso"), choice("text", "convert.datesText")],
      },
      {
        id: "newline",
        label_key: "convert.newline",
        kind: "choice",
        default: "crlf",
        choices: [choice("crlf", "convert.newlineCrlf"), choice("lf", "convert.newlineLf")],
      },
    ],
    "each",
    512 * MIB,
    512 * MIB,
    true,
    [],
    "calamine-0.37.0",
  ),
  commonSpec(
    "zip/seven_z",
    ["zip"],
    "seven_z",
    [
      { id: "level", label_key: "convert.compression", kind: "integer", default: 6, min: 0, max: 9 },
      { id: "encrypt_names", label_key: "convert.encryptNames", kind: "boolean", default: false },
      { id: "preserve_timestamps", label_key: "convert.preserveTimestamps", kind: "boolean", default: true },
    ],
    "each",
    8 * GIB,
    8 * GIB,
    true,
    TIMESTAMPS,
    "archive-06e",
  ),
  commonSpec(
    "seven_z/zip",
    ["seven_z"],
    "zip",
    [
      { id: "level", label_key: "convert.compression", kind: "integer", default: 6, min: 0, max: 9 },
      { id: "preserve_timestamps", label_key: "convert.preserveTimestamps", kind: "boolean", default: true },
    ],
    "each",
    8 * GIB,
    8 * GIB,
    true,
    TIMESTAMPS,
    "archive-06e",
  ),
];

/** Register all declarations once; the coordinator calls this at startup. */
export function registerConversionAdapters08b(registry: ConverterRegistration): void {
  for (const spec of CONVERSION_ADAPTERS_08B) registry.registerConverter(spec);
}

/** The option kind a converter requires, or null for an unknown ID. */
export function optionsKindForAdapter(id: string): ConvertOptions["kind"] | null {
  const known = (ADAPTER_OPTION_KIND_08B as Record<string, ConvertOptions["kind"]>)[id];
  if (known) return known;
  // Step 08a image adapters also participate in presets.
  if (["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif", "image/tiff", "svg/png"].includes(id)) {
    return "image";
  }
  return null;
}

/** True when the typed options match the adapter's declared kind. */
export function adapterAcceptsOptions(id: string, options: ConvertOptions): boolean {
  return optionsKindForAdapter(id) === options.kind;
}

/** Every adapter that accepts one input format and produces `output`. */
export function adaptersFor(output: FormatId, inputs: readonly FormatId[]): ConverterSpec[] {
  return CONVERSION_ADAPTERS_08B.filter(
    (spec) => spec.output === output && inputs.every((input) => spec.inputs.includes(input)),
  );
}

/** Canonical target extension, never guessed from a display name. */
export function extensionForConverter(id: string): string | null {
  switch (id) {
    case "images/pdf":
    case "markdown/pdf":
    case "html/pdf":
      return "pdf";
    case "pdf/png":
    case "image/png":
    case "svg/png":
      return "png";
    case "pdf/jpeg":
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/gif":
      return "gif";
    case "image/tiff":
      return "tiff";
    case "markdown/html":
      return "html";
    case "csv/xlsx":
      return "xlsx";
    case "xlsx/csv":
      return "csv";
    case "zip/seven_z":
      return "7z";
    case "seven_z/zip":
      return "zip";
    default:
      return null;
  }
}
