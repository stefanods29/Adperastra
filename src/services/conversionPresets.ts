/** Validated conversion presets (Step 08b E1-E4, D8).
 *
 * A preset stores only the allowlisted conversion options, a name pattern
 * and display metadata. It never stores an input path, a destination
 * history, a password, a helper token, an export snapshot or executable
 * text. The native catalog in `src-tauri/src/conversion_presets.rs` is the
 * authority; this service validates for instant feedback and calls the
 * three catalog commands.
 *
 * Removal is undoable through the previous catalog snapshot: the caller
 * pushes that snapshot on the shared Undo stack (E3). */

import { invoke } from "@tauri-apps/api/core";
import { isCanonicalExtension, isValidUtcDate, renderConversionName } from "../convert/naming";
import { APP_CONVERTERS, resolveConverter } from "../convert/registry";
import { CONVERSION_ADAPTERS_08B, adapterAcceptsOptions, extensionForConverter } from "../convert/adapters08b";
import type {
  ConversionInput,
  ConversionNaming,
  ConversionRequest,
  ConvertOptions,
  ConverterId,
  ConverterSpec,
  FormatId,
} from "../convert/types";

/** Catalog schema used by both the file and the commands (E2). */
export const PRESET_CATALOG_SCHEMA = 1;
/** Most saved presets (E2/D8). */
export const MAX_CONVERSION_PRESETS = 100;
/** Longest preset name in Unicode characters (D8). */
export const MAX_PRESET_NAME_CHARS = 60;
export const DEFAULT_PRESET_NAME_PATTERN = "{stem}.{ext}";

export type PresetDestinationMode = "source" | "ask";

/** Mirrors Rust `ConversionPreset` (E1). */
export interface ConversionPreset {
  id: string;
  name: string;
  converter_id: ConverterId;
  options: ConvertOptions;
  name_pattern: string;
  destination_mode: PresetDestinationMode;
  version: 1;
  created_unix: number;
  modified_unix: number;
}

/** Mirrors Rust `PresetCatalog` (E2). Built-ins are not stored here. */
export interface PresetCatalog {
  schema_version: typeof PRESET_CATALOG_SCHEMA;
  presets: ConversionPreset[];
}

/** The three immutable built-ins (E2). Their UUIDs never change. */
export const BUILTIN_PRESET_IDS = {
  webJpg: "00000000-0000-4000-8000-000000000001",
  imagesPdf: "00000000-0000-4000-8000-000000000002",
  tableCsv: "00000000-0000-4000-8000-000000000003",
} as const;

/** Label keys for built-ins; the `name` field is data, never shown raw. */
export const BUILTIN_PRESET_LABEL_KEYS: Readonly<Record<string, string>> = {
  [BUILTIN_PRESET_IDS.webJpg]: "convert.webJpg",
  [BUILTIN_PRESET_IDS.imagesPdf]: "convert.imagesPdf",
  [BUILTIN_PRESET_IDS.tableCsv]: "convert.tableCsv",
};

const IMAGE_OPTIONS: ConvertOptions = {
  kind: "image",
  value: {
    quality: 90,
    width: 1_920,
    keep_aspect: true,
    allow_upscale: false,
    background_rgba: [255, 255, 255, 255] as [number, number, number, number],
    first_frame: false,
    metadata_keep: true,
  },
} as unknown as ConvertOptions;

const IMAGES_PDF_OPTIONS: ConvertOptions = {
  kind: "document",
  value: {
    include_images: true,
    page_size: "source",
    margin_mm: 20,
    sanitize: true,
    encoding: "utf8",
  },
} as unknown as ConvertOptions;

const TABLE_CSV_OPTIONS: ConvertOptions = {
  kind: "table",
  value: {
    delimiter: "comma",
    header: true,
    formulas: "text",
    dates: "iso",
    newline: "crlf",
  },
} as unknown as ConvertOptions;

export const BUILTIN_CONVERSION_PRESETS: readonly ConversionPreset[] = [
  {
    id: BUILTIN_PRESET_IDS.webJpg,
    name: "web-jpg",
    converter_id: "image/jpeg" as unknown as ConverterId,
    options: IMAGE_OPTIONS,
    name_pattern: DEFAULT_PRESET_NAME_PATTERN,
    destination_mode: "source",
    version: 1,
    created_unix: 0,
    modified_unix: 0,
  },
  {
    id: BUILTIN_PRESET_IDS.imagesPdf,
    name: "images-pdf",
    converter_id: "images/pdf" as unknown as ConverterId,
    options: IMAGES_PDF_OPTIONS,
    name_pattern: DEFAULT_PRESET_NAME_PATTERN,
    destination_mode: "source",
    version: 1,
    created_unix: 0,
    modified_unix: 0,
  },
  {
    id: BUILTIN_PRESET_IDS.tableCsv,
    name: "table-csv",
    converter_id: "xlsx/csv" as unknown as ConverterId,
    options: TABLE_CSV_OPTIONS,
    name_pattern: DEFAULT_PRESET_NAME_PATTERN,
    destination_mode: "source",
    version: 1,
    created_unix: 0,
    modified_unix: 0,
  },
];

/** True for a built-in that may never be edited or removed. */
export function isBuiltinPreset(id: string): boolean {
  return Object.values(BUILTIN_PRESET_IDS).includes(id as (typeof BUILTIN_PRESET_IDS)[keyof typeof BUILTIN_PRESET_IDS]);
}

/** All presets for display: built-ins first, then saved ones, each max 100. */
export function presetsForDisplay(catalog: PresetCatalog): ConversionPreset[] {
  return [...BUILTIN_CONVERSION_PRESETS, ...catalog.presets.slice(0, MAX_CONVERSION_PRESETS)];
}

/** A preset found by ID, built-in or saved. */
export function findConversionPreset(
  catalog: PresetCatalog,
  id: string,
): ConversionPreset | null {
  return presetsForDisplay(catalog).find((preset) => preset.id === id) ?? null;
}

/** The label key a preset shows; saved presets show their own name. */
export function presetLabelKey(preset: ConversionPreset): string | null {
  return BUILTIN_PRESET_LABEL_KEYS[preset.id] ?? null;
}

/** Only the named persistable fields of typed options survive (D8). */
export function sanitizePresetOptions(options: ConvertOptions): ConvertOptions {
  switch (options.kind) {
    case "image": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "image",
        value: {
          quality: numberOr(value.quality, 90),
          width: positiveOrNull(value.width) ?? undefined,
          height: positiveOrNull(value.height) ?? undefined,
          keep_aspect: value.keep_aspect !== false,
          allow_upscale: value.allow_upscale === true,
          background_rgba: rgba(value.background_rgba),
          first_frame: value.first_frame === true,
          metadata_keep: value.metadata_keep !== false,
        },
      } as unknown as ConvertOptions;
    }
    case "pdf": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "pdf",
        value: {
          ranges: Array.isArray(value.ranges)
            ? value.ranges
                .map((range) => range as unknown as Record<string, unknown>)
                .filter((range) => Number.isInteger(range.first) && Number.isInteger(range.last))
                .map((range) => ({ first: range.first, last: range.last }))
            : [],
          dpi: clampInteger(value.dpi, 150, 72, 600),
          image_format: value.image_format === "jpeg" ? "jpeg" : "png",
          quality: clampInteger(value.quality, 90, 1, 100),
          combine: value.combine !== false,
        },
      } as unknown as ConvertOptions;
    }
    case "document": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "document",
        value: {
          include_images: value.include_images !== false,
          page_size: value.page_size === "letter" || value.page_size === "source" ? value.page_size : "a4",
          margin_mm: clampInteger(value.margin_mm, 20, 0, 50),
          sanitize: true,
          encoding: "utf8",
          title: typeof value.title === "string" ? value.title.slice(0, 512) : undefined,
        },
      } as unknown as ConvertOptions;
    }
    case "table": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "table",
        value: {
          delimiter: value.delimiter === "tab" || value.delimiter === "semicolon" ? value.delimiter : "comma",
          header: value.header !== false,
          sheet: typeof value.sheet === "string" && value.sheet.length <= 31 ? value.sheet : undefined,
          formulas: value.formulas === "preserve" ? "preserve" : "text",
          dates: value.dates === "text" ? "text" : "iso",
          newline: value.newline === "lf" ? "lf" : "crlf",
        },
      } as unknown as ConvertOptions;
    }
    case "archive": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "archive",
        value: {
          format: value.format === "seven_z" ? "seven_z" : "zip",
          level: clampInteger(value.level, 6, 0, 9),
          encrypt_names: value.encrypt_names === true,
          preserve_timestamps: value.preserve_timestamps !== false,
        },
      } as unknown as ConvertOptions;
    }
    case "media": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "media",
        value: {
          start_ms: value.start_ms,
          end_ms: value.end_ms,
          width: value.width,
          height: value.height,
          video_codec: value.video_codec,
          audio_codec: value.audio_codec,
          bitrate_kbps: value.bitrate_kbps,
          sample_rate: value.sample_rate,
          keep_metadata: value.keep_metadata !== false,
          burn_subtitles: value.burn_subtitles === true,
          speed: value.speed,
          volume: value.volume,
        },
      } as unknown as ConvertOptions;
    }
    case "office": {
      const value = options.value as unknown as Record<string, unknown>;
      return {
        kind: "office",
        value: {
          page_ranges: value.page_ranges,
          export_comments: value.export_comments !== false,
          export_notes: value.export_notes === true,
          encoding: value.encoding,
          preserve_metadata: value.preserve_metadata !== false,
          external_links: false,
          macros: false,
        },
      } as unknown as ConvertOptions;
    }
    default:
      throw new Error("convert.invalid_preset");
  }
}

/** Validate a preset's name, converter, option kind and pattern.
 * Built-ins are validated for use, but `save`/`import` still refuse them. */
export function validateConversionPreset(preset: ConversionPreset, allowBuiltin = false): string | null {
  if (!isUuid(preset.id)) return "convert.invalid_preset";
  if (!allowBuiltin && isBuiltinPreset(preset.id)) return "convert.invalid_preset";
  const name = Array.from(preset.name.trim());
  if (name.length === 0 || name.length > MAX_PRESET_NAME_CHARS) return "convert.invalid_preset";
  if (preset.version !== 1) return "convert.invalid_preset";
  if (preset.destination_mode !== "source" && preset.destination_mode !== "ask") return "convert.invalid_preset";
  const spec = specFor(preset.converter_id);
  if (spec) {
    if (!adapterAcceptsOptions(preset.converter_id, preset.options)) return "convert.invalid_preset";
  } else if (!allowBuiltin) {
    return "convert.invalid_preset";
  }
  const ext = extensionForConverter(preset.converter_id) ?? builtinExtension(preset.id);
  if (!ext) return "convert.invalid_preset";
  const rendered = renderConversionName(preset.name_pattern, "name", ext, 1, "2026-01-01");
  if ("error" in rendered || !isCanonicalExtension(ext)) return "convert.invalid_pattern";
  return null;
}

/** Parse a catalog file (import). All-or-nothing; newer schemas fail. */
export function parsePresetCatalog(value: unknown): { catalog: PresetCatalog } | { error: string } {
  if (!isRecord(value)) return { error: "convert.invalid_preset" };
  if (value.schema_version !== PRESET_CATALOG_SCHEMA) return { error: "convert.invalid_preset" };
  if (!Array.isArray(value.presets) || value.presets.length > MAX_CONVERSION_PRESETS) {
    return { error: "convert.invalid_preset" };
  }
  const presets: ConversionPreset[] = [];
  const ids = new Set<string>();
  for (const entry of value.presets) {
    const preset = readPreset(entry);
    if (!preset) return { error: "convert.invalid_preset" };
    if (ids.has(preset.id)) return { error: "convert.invalid_preset" };
    ids.add(preset.id);
    const error = validateConversionPreset(preset);
    if (error) return { error };
    presets.push({ ...preset, options: sanitizePresetOptions(preset.options) });
  }
  return { catalog: { schema_version: PRESET_CATALOG_SCHEMA, presets } };
}

/** Serialize only allowlisted fields; no secret can survive. */
export function serializePresetCatalog(catalog: PresetCatalog): string {
  return JSON.stringify({
    schema_version: PRESET_CATALOG_SCHEMA,
    presets: catalog.presets.slice(0, MAX_CONVERSION_PRESETS).map((preset) => ({
      id: preset.id,
      name: Array.from(preset.name.trim()).slice(0, MAX_PRESET_NAME_CHARS).join(""),
      converter_id: preset.converter_id,
      options: sanitizePresetOptions(preset.options),
      name_pattern: preset.name_pattern,
      destination_mode: preset.destination_mode,
      version: 1,
      created_unix: safeUnix(preset.created_unix),
      modified_unix: safeUnix(preset.modified_unix),
    })),
  });
}

/** True when the preset's converter accepts every selected format. */
export function presetAcceptsFormats(
  preset: ConversionPreset,
  formats: readonly FormatId[],
  spec: ConverterSpec | null = specFor(preset.converter_id),
): boolean {
  return spec !== null && spec.inputs.length > 0 && formats.every((format) => spec.inputs.includes(format));
}

/** Build the exact 08a request from a preset; nothing starts until the
 * caller reviews destination, naming and loss acknowledgements. */
export function buildConversionRequest(
  preset: ConversionPreset,
  inputs: readonly ConversionInput[],
  destDir: string,
  dateUtc: string,
): ConversionRequest {
  const error = validateConversionPreset(preset, true);
  if (error) throw new Error(error);
  if (inputs.length === 0) throw new Error("convert.bad_request");
  if (destDir.length === 0) throw new Error("convert.bad_request");
  if (!isValidUtcDate(dateUtc)) throw new Error("convert.invalid_pattern");
  const naming: ConversionNaming = {
    pattern: preset.name_pattern,
    date_utc: dateUtc,
    start_index: 1,
  };
  return {
    inputs: inputs.map((input) => ({ ...input })),
    converter_id: preset.converter_id,
    options: sanitizePresetOptions(preset.options),
    dest_dir: destDir,
    keep_original: true,
    accepted_losses: [],
    accepted_warning_codes: [],
    request_revision: 1,
    naming,
  };
}

/** E4: resolve the preset, validate it and return a request without starting
 * a job. Loss confirmation and destination selection remain the dialog's. */
export async function applyConversionPreset(
  presetId: string,
  inputs: readonly ConversionInput[],
  destDir: string,
  namingDateUtc: string,
): Promise<ConversionRequest> {
  const catalog = await listConversionPresets();
  const preset = findConversionPreset(catalog, presetId);
  if (!preset) throw new Error("convert.invalid_preset");
  return buildConversionRequest(preset, inputs, destDir, namingDateUtc);
}

// ---------------------------------------------------------------------------
// Commands (E3). Only this file calls them.
// ---------------------------------------------------------------------------

export async function listConversionPresets(): Promise<PresetCatalog> {
  return (await invoke("conversion_presets_list")) as PresetCatalog;
}

export async function saveConversionPreset(preset: ConversionPreset): Promise<PresetCatalog> {
  return (await invoke("conversion_preset_save", { preset })) as PresetCatalog;
}

/** Removing returns the new catalog; the caller keeps the previous one for
 * the shared Undo entry (E3). */
export async function removeConversionPreset(id: string): Promise<PresetCatalog> {
  return (await invoke("conversion_preset_remove", { id })) as PresetCatalog;
}

/** Restore a previous catalog snapshot for Undo/Redo of a removal. */
export async function replaceConversionPresetCatalog(catalog: PresetCatalog): Promise<PresetCatalog> {
  return (await invoke("conversion_presets_replace", { catalog })) as PresetCatalog;
}

/** Import a reviewed catalog JSON atomically; the native side revalidates it. */
export async function importConversionPresets(catalogJson: string): Promise<PresetCatalog> {
  return (await invoke("conversion_presets_import", { catalogJson })) as PresetCatalog;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function builtinExtension(id: string): string | null {
  if (id === BUILTIN_PRESET_IDS.webJpg) return "jpg";
  if (id === BUILTIN_PRESET_IDS.imagesPdf) return "pdf";
  if (id === BUILTIN_PRESET_IDS.tableCsv) return "csv";
  return null;
}

function specFor(id: ConverterId): ConverterSpec | null {
  const registered = resolveConverter(id);
  if (registered) return registered;
  // The static 08a declarations are authoritative even before the app-wide
  // registry is initialized; a built-in preset must validate on its own.
  const declared = APP_CONVERTERS.find((spec) => spec.id === id);
  if (declared) return declared;
  return CONVERSION_ADAPTERS_08B.find((spec) => spec.id === id) ?? null;
}

function readPreset(value: unknown): ConversionPreset | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (typeof value.converter_id !== "string" || typeof value.name_pattern !== "string") return null;
  if (value.version !== 1) return null;
  if (value.destination_mode !== "source" && value.destination_mode !== "ask") return null;
  if (!isRecord(value.options)) return null;
  return {
    id: value.id,
    name: value.name,
    converter_id: value.converter_id as unknown as ConverterId,
    options: value.options as unknown as ConvertOptions,
    name_pattern: value.name_pattern,
    destination_mode: value.destination_mode,
    version: 1,
    created_unix: safeUnix(value.created_unix),
    modified_unix: safeUnix(value.modified_unix),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function rgba(value: unknown): [number, number, number, number] {
  if (Array.isArray(value) && value.length === 4 && value.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return value as [number, number, number, number];
  }
  return [255, 255, 255, 255];
}

function safeUnix(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
