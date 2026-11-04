import { parentPathOf } from "../services/explorer";
import type {
  ConversionInput,
  ConversionReport,
  ConversionWarningCode,
  ConverterSpec,
  ConvertOptions,
  DocumentConversionOptions,
  FormatId,
  ImageOptions,
  MediaConversionOptions,
  MetadataCategory,
  OptionSpec,
} from "./types";
import { defaultImageOptions } from "./types";

/** Pure option helpers for the Quick Convert dialog (Step 08a T5/T6). */

/** Most images one `images/pdf` invocation can combine. Mirrors the native
 * limit (`conversion_pdf::MAX_COMBINE_IMAGES`, the PDF helper's 256 grants). */
export const MAX_COMBINE_IMAGES = 256;

/** Source metadata an image loses when it becomes a PDF page: the route
 * embeds pixels, not a metadata container. */
const IMAGE_PDF_METADATA_LOSSES: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "author",
  "comments",
  "icc",
  "xmp",
  "iptc",
];

/** Changes the UI must disclose for a route whose native preview is not
 * available (the combine route has no single-output preview in this round). */
export interface PreviewAcknowledgements {
  warnings: ConversionWarningCode[];
  metadata_lost: MetadataCategory[];
}

/** The static acknowledgements for a route whose exact native preview is not
 * available: `images/pdf` and the media engine conversions. Every other
 * adapter gets its exact list from the native preview. */
export function staticPreviewChanges(
  spec: ConverterSpec,
  inputs: readonly ConversionInput[],
): PreviewAcknowledgements {
  // A GIF always quantizes to a palette, so that code is required for every
  // source; the other GIF warnings depend on the probed source (audio,
  // alpha and exact frame timing) and are checked again natively before any
  // output begins. Media has no 08a still preview in this round.
  if (spec.id === "media/gif") {
    return { warnings: ["palette_reduction"], metadata_lost: [] };
  }
  if (spec.id !== "images/pdf") return { warnings: [], metadata_lost: [] };
  const animated = inputs.some((input) => formatOfInput(input) === "gif");
  return {
    warnings: animated ? ["animation_first_frame"] : [],
    metadata_lost: [...IMAGE_PDF_METADATA_LOSSES],
  };
}

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
    // Media formats the 12b engine converters accept. The extension mapping
    // mirrors `FormatId::from_extension`; an unknown extension still means no
    // converter is offered.
    mp4: "mp4",
    m4v: "mp4",
    m4a: "mp4",
    mkv: "mkv",
    mov: "mov",
    qt: "mov",
    webm: "webm",
    mp3: "mp3",
    wav: "wav",
    flac: "flac",
    ogg: "ogg",
    oga: "ogg",
    opus: "opus",
    aac: "aac",
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

/** A positive integer option, or `null` for the option's 0 sentinel. */
function optionalPositive(
  values: Readonly<Record<string, boolean | number | string>>,
  id: string,
): number | null {
  const value = values[id];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** The exact `media` option object the 12b engine validates. Codec values
 * stay `auto` (only the audited build's fixed table is offered), subtitles
 * off, and speed/volume at their neutral values; the dialog only exposes the
 * bounded integer options and the metadata switch. */
export function mediaOptionsFromValues(
  values: Readonly<Record<string, boolean | number | string>>,
): MediaConversionOptions {
  return {
    start_ms: optionalPositive(values, "start_ms"),
    end_ms: optionalPositive(values, "end_ms"),
    width: optionalPositive(values, "width"),
    height: optionalPositive(values, "height"),
    video_codec: "auto",
    audio_codec: "auto",
    bitrate_kbps: optionalPositive(values, "bitrate_kbps"),
    sample_rate: optionalPositive(values, "sample_rate"),
    keep_metadata: values.keep_metadata !== false,
    burn_subtitles: false,
    speed: 1,
    volume: 1,
  };
}

/** Build the exact tagged options object for one adapter. */
export function optionsFromValues(
  spec: ConverterSpec,
  values: Readonly<Record<string, boolean | number | string>>,
): ConvertOptions {
  if (spec.engine_id === "media") {
    return { kind: "media", value: mediaOptionsFromValues(values) };
  }
  if (spec.id === "images/pdf") {
    return { kind: "document", value: documentOptionsFromValues(spec, values) };
  }
  return { kind: "image", value: imageOptionsFromValues(spec, values) };
}

/** The document options the native `images/pdf` route accepts. The route
 * embeds images, so `include_images` is always true and the text-only
 * `sanitize`/`encoding` fields stay at their fixed values. */
export function documentOptionsFromValues(
  spec: ConverterSpec,
  values: Readonly<Record<string, boolean | number | string>>,
): DocumentConversionOptions {
  const pageOption = spec.options.find((option) => option.id === "page_size");
  const allowed = pageOption?.choices?.map((choice) => choice.value) ?? [];
  const pageValue = values.page_size;
  const pageSize: DocumentConversionOptions["page_size"] =
    typeof pageValue === "string" && allowed.includes(pageValue)
      ? (pageValue as DocumentConversionOptions["page_size"])
      : (pageOption?.default as DocumentConversionOptions["page_size"]) ?? "source";
  const marginOption = spec.options.find((option) => option.id === "margin_mm");
  const rawMargin = numericValue(marginOption, 20, values);
  const minMargin = marginOption?.min ?? 0;
  const maxMargin = marginOption?.max ?? 50;
  const margin = Math.min(maxMargin, Math.max(minMargin, Math.round(rawMargin)));
  return {
    include_images: true,
    page_size: pageSize,
    margin_mm: margin,
    sanitize: true,
    encoding: "utf8",
  };
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
