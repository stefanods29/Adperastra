import type { CacheLease, SourceStamp } from "../services/cache";

export type { SourceStamp } from "../services/cache";

/** Canonical conversion data shapes (Step 08a, `conversion-2`). The Rust
 * mirror is `crates/convert/src/types.rs`; the registry and every dialog
 * import these types instead of repeating them. */

export type ConverterId = string;

export type FormatId =
  | "png"
  | "jpeg"
  | "webp"
  | "bmp"
  | "gif"
  | "tiff"
  | "ico"
  | "svg"
  | "pdf"
  | "html"
  | "md"
  | "csv"
  | "xlsx"
  | "zip"
  | "seven_z"
  | "mp4"
  | "mkv"
  | "mov"
  | "webm"
  | "mp3"
  | "wav"
  | "flac"
  | "ogg"
  | "opus"
  | "aac";

export type MetadataCategory =
  | "exif"
  | "gps"
  | "camera"
  | "date"
  | "icc"
  | "xmp"
  | "iptc"
  | "author"
  | "comments"
  | "attachments"
  | "forms"
  | "annotations"
  | "scripts"
  | "timestamps"
  | "last_modified_by"
  | "company"
  | "tracked_changes"
  | "hidden_text"
  | "speaker_notes"
  | "encoder";

export type ConversionWarningCode =
  | "transparency_loss"
  | "animation_first_frame"
  | "palette_reduction"
  | "layout_loss"
  | "formula_cached_value"
  | "formula_safety_prefix"
  | "sheet_selection"
  | "audio_loss"
  | "frame_rate_change";

export interface OptionChoice {
  value: string;
  label_key: string;
}

/** One option an adapter exposes; `default` matches `kind`. */
export interface OptionSpec {
  id: string;
  label_key: string;
  kind: "boolean" | "integer" | "choice";
  default: boolean | number | string;
  min?: number;
  max?: number;
  choices?: OptionChoice[];
}

export interface ConverterSpec {
  id: ConverterId;
  inputs: FormatId[];
  output: FormatId;
  options: OptionSpec[];
  input_mode: "each" | "combine";
  max_input_bytes: number;
  max_output_bytes: number;
  lossy: boolean;
  preserves: MetadataCategory[];
  engine_id: string;
  available: boolean;
  help_slug: string;
}

export interface ImageOptions {
  quality: number;
  width?: number;
  height?: number;
  keep_aspect: boolean;
  allow_upscale: boolean;
  background_rgba: [number, number, number, number];
  first_frame: boolean;
  metadata_keep: boolean;
}

export interface PageRange {
  first: number;
  last: number;
}

export interface PdfConversionOptions {
  ranges: PageRange[];
  dpi: number;
  image_format: "png" | "jpeg";
  quality: number;
  combine: boolean;
}

export interface DocumentConversionOptions {
  include_images: boolean;
  page_size: "source" | "a4" | "letter";
  margin_mm: number;
  sanitize: true;
  encoding: "utf8";
  title?: string;
}

export interface TableConversionOptions {
  delimiter: "comma" | "tab" | "semicolon";
  header: boolean;
  sheet?: string;
  formulas: "text" | "preserve";
  dates: "iso" | "text";
  newline: "lf" | "crlf";
}

export interface ArchiveConversionOptions {
  format: "zip" | "seven_z";
  level: number;
  password?: string;
  source_password?: string;
  encrypt_names: boolean;
  preserve_timestamps: boolean;
}

export interface MediaConversionOptions {
  start_ms?: number | null;
  end_ms?: number | null;
  width?: number | null;
  height?: number | null;
  video_codec:
    | "auto"
    | "vp9"
    | "av1"
    | "h264_os"
    | "hevc_os"
    | "copy";
  audio_codec:
    | "auto"
    | "opus"
    | "vorbis"
    | "flac"
    | "pcm"
    | "mp3"
    | "aac_os"
    | "copy";
  bitrate_kbps?: number | null;
  sample_rate?: number | null;
  keep_metadata: boolean;
  burn_subtitles: boolean;
  speed: number;
  volume: number;
}

export interface OfficeConversionOptions {
  page_ranges: PageRange[];
  export_comments: boolean;
  export_notes: boolean;
  encoding: "utf8";
  preserve_metadata: boolean;
  external_links: false;
  macros: false;
}

/** Tagged exactly like Rust: `{ kind: "image", value: {...} }`. */
export type ConvertOptions =
  | { kind: "image"; value: ImageOptions }
  | { kind: "pdf"; value: PdfConversionOptions }
  | { kind: "document"; value: DocumentConversionOptions }
  | { kind: "table"; value: TableConversionOptions }
  | { kind: "archive"; value: ArchiveConversionOptions }
  | { kind: "media"; value: MediaConversionOptions }
  | { kind: "office"; value: OfficeConversionOptions };

export type ConversionInput =
  | { kind: "file"; path: string; expected?: SourceStamp }
  | { kind: "snapshot"; snapshot_id: string; document_id: string; revision: number };

/** The part of the output name an adapter contributes. Exact mirror of
 * `convert::types::OutputNamePart`; `page` is a Rust `u32`. */
export type OutputNamePart =
  | { kind: "none" }
  | { kind: "page"; page: number }
  | { kind: "sheet"; sheet: string };

export interface ConversionNaming {
  pattern: string;
  date_utc: string;
  start_index: number;
}

export interface ConversionRequest {
  inputs: ConversionInput[];
  converter_id: ConverterId;
  options: ConvertOptions;
  dest_dir: string;
  keep_original: boolean;
  accepted_losses: MetadataCategory[];
  accepted_warning_codes: ConversionWarningCode[];
  request_revision: number;
  naming: ConversionNaming;
}

/** The preview request has no destination and publishes nothing. */
export interface ConversionPreviewRequest {
  inputs: ConversionInput[];
  converter_id: ConverterId;
  options: ConvertOptions;
  request_revision: number;
}

export type WorkItemStatus = "done" | "skipped" | "failed" | "cancelled";

export interface WorkItemResult {
  input_index: number;
  source_path?: string;
  output_count: number;
  status: WorkItemStatus;
  reason?: string;
  metadata_lost: MetadataCategory[];
  bytes_written: number;
}

export interface ConversionOutput {
  output_id: string;
  input_indices: number[];
  output_index: number;
  path: string;
  byte_len: number;
}

export interface ConversionReport {
  report_id: string;
  items: WorkItemResult[];
  outputs: ConversionOutput[];
  next_cursor?: string;
  created_paths: string[];
  history_id?: string;
  input_total: number;
  done_count: number;
  failed_count: number;
  skipped_count: number;
  cancelled_count: number;
  outputs_created: number;
  cancelled: boolean;
  job_finished: boolean;
  complete: boolean;
}

export interface ConversionPreview {
  image: CacheLease;
  input_revision: number;
  width: number;
  height: number;
  estimated_bytes?: number;
  estimated_ms?: number;
  warnings: ConversionWarningCode[];
  metadata_lost: MetadataCategory[];
}

export interface ConversionDialogProps {
  inputs: readonly ConversionInput[];
  onClose: () => void;
  onCompleted: (report: ConversionReport) => void;
  onOpenHelp: (slug: string) => void;
  initialConverter?: ConverterId;
}

/** The default naming object 08a accepts. */
export function defaultNaming(): ConversionNaming {
  return { pattern: "{stem}.{ext}", date_utc: "", start_index: 1 };
}

export function defaultImageOptions(quality = 90): ImageOptions {
  return {
    quality,
    keep_aspect: true,
    allow_upscale: false,
    background_rgba: [255, 255, 255, 255],
    first_frame: false,
    metadata_keep: true,
  };
}

/** True when the options family matches the adapter family. The 08a image
 * adapters take image options; the 08b combine adapter `images/pdf` takes
 * document options. Anything else is refused. */
export function optionsMatchConverter(
  spec: ConverterSpec,
  options: ConvertOptions,
): boolean {
  if (spec.engine_id === "media") return options.kind === "media";
  if (spec.id === "images/pdf") return options.kind === "document";
  return (
    (spec.id.startsWith("image/") || spec.id === "svg/png") &&
    options.kind === "image"
  );
}

/** A retained snapshot handed from a file tab to the Explorer's job owner. */
export interface ConversionOpenRequest {
  nonce: number;
  inputs: ConversionInput[];
  release: () => Promise<void>;
}
