import { parentPathOf } from "../services/explorer";
import type {
  ConversionInput,
  ConversionReport,
  ConverterSpec,
  ConvertOptions,
  FormatId,
  ImageOptions,
  OptionSpec,
} from "./types";
import { defaultImageOptions } from "./types";

/** Pure option helpers for the Quick Convert dialog (Step 08a T5/T6). */

/** The source format named by a file input, or null for a snapshot. */
export function formatOfInput(input: ConversionInput): FormatId | null {
  if (input.kind !== "file") return null;
  const name = input.path.split("\\").filter(Boolean).pop() ?? input.path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  const map: Record<string, FormatId> = {
    png: "png",
    jpg: "jpeg",
    jpeg: "jpeg",
    jfif: "jpeg",
    webp: "webp",
    bmp: "bmp",
    gif: "gif",
    tif: "tiff",
    tiff: "tiff",
    ico: "ico",
    svg: "svg",
  };
  return map[extension] ?? null;
}

/** Every distinct format the file inputs name. A snapshot is a wildcard:
 * the native parent authorizes its real format before any output starts. */
export function inputFormats(inputs: readonly ConversionInput[]): FormatId[] {
  const known = inputs
    .map(formatOfInput)
    .filter((format): format is FormatId => format !== null);
  return [...new Set(known)];
}

/** Every converter that accepts all of the selected input formats. */
export function convertersForInputs(
  all: readonly ConverterSpec[],
  inputs: readonly ConversionInput[],
): readonly ConverterSpec[] {
  if (inputs.some((input) => input.kind === "file" && formatOfInput(input) === null)) return [];
  const formats = inputFormats(inputs);
  return all.filter(
    (spec) => spec.available && formats.every((format) => spec.inputs.includes(format)),
  );
}

/** A fileName without its last extension (the `{stem}` value). */
export function stemOf(input: ConversionInput): string {
  if (input.kind === "snapshot") return "document";
  const name = input.path.split("\\").filter(Boolean).pop() ?? input.path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function inputLabel(input: ConversionInput): string {
  if (input.kind === "snapshot") {
    return input.document_id.length > 12
      ? `${input.document_id.slice(0, 12)}…`
      : input.document_id;
  }
  return input.path.split("\\").filter(Boolean).pop() ?? input.path;
}

/** Default options from the adapter's own option specs. */
export function valuesFromSpec(spec: ConverterSpec): Record<string, boolean | number | string> {
  const values: Record<string, boolean | number | string> = {};
  for (const option of spec.options) {
    values[option.id] = option.default;
  }
  return values;
}

export function imageOptionsFromValues(
  spec: ConverterSpec,
  values: Readonly<Record<string, boolean | number | string>>,
): ImageOptions {
  const base = defaultImageOptions(
    numericValue(spec.options.find((option) => option.id === "quality"), 90),
  );
  const width = numericValue(spec.options.find((option) => option.id === "width"), 0);
  const height = numericValue(spec.options.find((option) => option.id === "height"), 0);
  return {
    ...base,
    quality: numericValue(
      spec.options.find((option) => option.id === "quality"),
      base.quality,
      values,
    ),
    width: numericValue(
      spec.options.find((option) => option.id === "width"),
      0,
      values,
    ) || undefined,
    height: numericValue(
      spec.options.find((option) => option.id === "height"),
      0,
      values,
    ) || undefined,
    keep_aspect: booleanValue(
      spec.options.find((option) => option.id === "keep_aspect"),
      true,
      values,
    ),
    allow_upscale: booleanValue(
      spec.options.find((option) => option.id === "allow_upscale"),
      false,
      values,
    ),
    // Background selection is not offered in 08a; the disclosure still
    // names the actual white compositing background.
    background_rgba: [255, 255, 255, 255],
    first_frame: false,
    metadata_keep: values.metadata_keep !== false,
  };
}

function numericValue(
  option: OptionSpec | undefined,
  fallback: number,
  values?: Readonly<Record<string, boolean | number | string>>,
): number {
  const value = option && values ? values[option.id] : option?.default;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(
  option: OptionSpec | undefined,
  fallback: boolean,
  values: Readonly<Record<string, boolean | number | string>>,
): boolean {
  const value = option ? values[option.id] : undefined;
  return typeof value === "boolean" ? value : fallback;
}

/** Build the exact tagged options object for one adapter. */
export function optionsFromValues(
  spec: ConverterSpec,
  values: Readonly<Record<string, boolean | number | string>>,
): ConvertOptions {
  return { kind: "image", value: imageOptionsFromValues(spec, values) };
}

/** The destination for one input (its containing folder), or "" when the
 * inputs come from different folders. */
export function defaultDestination(inputs: readonly ConversionInput[]): string {
  const folders = inputs
    .map((input) => (input.kind === "file" ? parentPathOf(input.path) : null))
    .filter((folder): folder is string => !!folder);
  if (folders.length === 0 || folders.length !== inputs.length) return "";
  const first = folders[0].toLowerCase();
  return folders.every((folder) => folder.toLowerCase() === first) ? folders[0] : "";
}

/** Only files that did not finish may be retried. */
export function retryInputs(
  report: ConversionReport,
  inputs: readonly ConversionInput[],
): ConversionInput[] {
  return inputs.filter((_, index) => {
    const item = report.items.find((row) => row.input_index === index);
    return item?.status === "failed" || item?.status === "skipped";
  });
}

/** Today's UTC date in the exact `YYYY-MM-DD` form the naming grammar
 * expects. */
export function utcToday(now = new Date()): string {
  const year = now.getUTCFullYear().toString().padStart(4, "0");
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = now.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** True when every required warning and metadata loss was accepted. */
export function lossesAccepted(
  requiredWarnings: readonly string[],
  acceptedWarnings: readonly string[],
  requiredLosses: readonly string[],
  acceptedLosses: readonly string[],
): boolean {
  return (
    requiredWarnings.every((code) => acceptedWarnings.includes(code)) &&
    requiredLosses.every((code) => acceptedLosses.includes(code))
  );
}
