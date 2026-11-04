import { capabilityAvailable } from "../services/engines";
import { MEDIA_CONVERTER_IDS, type EngineCapability } from "../services/engineTypes";
import { CONVERSION_ADAPTERS_08B, registerConversionAdapters08b } from "./adapters08b";
import type {
  ConverterId,
  ConverterSpec,
  FormatId,
  ImageOptions,
  MetadataCategory,
  OptionSpec,
} from "./types";

/** The app-wide converter registry (Step 08a E1). Adapters are static data
 * registered at startup; a file, a tab or a command can never add one.
 *
 * Engine-backed converters are declared here as data too. They become
 * selectable only after `registerEngineConverters` sees the verified
 * `media.encode` capability; otherwise they stay advertised as unavailable
 * (missing optional pack), never as a half-working adapter. */

const converters = new Map<ConverterId, ConverterSpec>();

/** Declared adapters whose engine pack is not verified yet. They are not
 * offered by `getConverters`, but `resolveConverter` can name them so the UI
 * can show the missing-pack state instead of inventing an unknown format. */
const declared = new Map<ConverterId, ConverterSpec>();

/** True once the static table has been installed in this process. */
let appConvertersRegistered = false;

/** Register one adapter. A duplicate ID is a programming error and is
 * refused instead of silently replacing the first adapter. */
export function registerConverter(spec: ConverterSpec): void {
  if (converters.has(spec.id) || declared.has(spec.id)) {
    throw new Error(`duplicate converter id: ${spec.id}`);
  }
  if (!spec.available) {
    // Keep the declaration so a missing pack is visible, not silent.
    declared.set(spec.id, spec);
    return;
  }
  converters.set(spec.id, spec);
}

/** Every available converter that accepts all of the given input formats,
 * in the order it was registered. Empty input means every converter. */
export function getConverters(inputs: readonly FormatId[]): readonly ConverterSpec[] {
  return [...converters.values()].filter((spec) =>
    inputs.every((input) => spec.inputs.includes(input)),
  );
}

export function resolveConverter(id: ConverterId): ConverterSpec | null {
  return converters.get(id) ?? declared.get(id) ?? null;
}

/** Declared converters for these inputs whose engine pack is not verified.
 * The dialog can name them and point to `engines.storage`; it never offers
 * them as working conversions. */
export function getUnavailableConverters(
  inputs: readonly FormatId[],
): readonly ConverterSpec[] {
  return [...declared.values()].filter(
    (spec) => !spec.available && inputs.every((input) => spec.inputs.includes(input)),
  );
}

/** Make the media converters selectable only when the verified engine pack
 * was reported by the native capability probe. Calling this again with a
 * missing capability withdraws them again instead of leaving a stale spec. */
export function registerEngineConverters(
  capabilities: readonly EngineCapability[],
): void {
  const available = capabilityAvailable(capabilities, "media.encode");
  for (const base of MEDIA_CONVERTER_SPECS) {
    const quickIndex = quickConvertConverters.findIndex((spec) => spec.id === base.id);
    if (available) {
      const enabled = { ...base, available: true };
      declared.delete(base.id);
      if (!converters.has(base.id)) converters.set(base.id, enabled);
      if (quickIndex >= 0) quickConvertConverters[quickIndex] = enabled;
      else quickConvertConverters.push(enabled);
    } else {
      converters.delete(base.id);
      declared.set(base.id, base);
      if (quickIndex >= 0) quickConvertConverters.splice(quickIndex, 1);
    }
  }
}

/** Test/startup helper: clear the table (never used by the app itself). */
export function resetConverters(): void {
  converters.clear();
  declared.clear();
  for (const spec of MEDIA_CONVERTER_SPECS) {
    const index = quickConvertConverters.findIndex((entry) => entry.id === spec.id);
    if (index >= 0) quickConvertConverters.splice(index, 1);
  }
  appConvertersRegistered = false;
}

const RASTER_INPUTS: readonly FormatId[] = [
  "png",
  "jpeg",
  "webp",
  "bmp",
  "gif",
  "tiff",
  "ico",
];

const EXIF_FAMILY: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "author",
  "comments",
];

function imageOptions(target: FormatId): OptionSpec[] {
  const options: OptionSpec[] = [
    // 0 means "keep the source size"; the form maps it to no value.
    { id: "width", label_key: "convert.width", kind: "integer", default: 0, min: 0, max: 65536 },
    { id: "height", label_key: "convert.height", kind: "integer", default: 0, min: 0, max: 65536 },
    {
      id: "keep_aspect",
      label_key: "convert.keepAspect",
      kind: "boolean",
      default: true,
    },
    {
      id: "allow_upscale",
      label_key: "convert.allowUpscale",
      kind: "boolean",
      default: false,
    },
  ];
  if (target === "jpeg") {
    options.unshift({
      id: "quality",
      label_key: "convert.quality",
      kind: "integer",
      default: 90,
      min: 1,
      max: 100,
    });
  }
  return options;
}

function imageSpec(target: FormatId): ConverterSpec {
  const id = target === "jpeg" ? "image/jpeg" : `image/${target}`;
  const preserves: MetadataCategory[] =
    target === "jpeg" || target === "png" || target === "tiff" || target === "webp"
      ? [...EXIF_FAMILY]
      : [];
  return {
    id,
    inputs: [...RASTER_INPUTS],
    output: target,
    options: imageOptions(target),
    input_mode: "each",
    max_input_bytes: 512 * 1024 * 1024,
    max_output_bytes: 1024 * 1024 * 1024,
    lossy: target === "jpeg" || target === "gif",
    preserves,
    engine_id: "image-0.25.10",
    available: true,
    help_slug: "converting-files",
  };
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MEDIA_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MEDIA_MAX_DIMENSION = 16_384;
const MEDIA_MAX_BITRATE_KBPS = 1_000_000;
const MEDIA_MAX_SAMPLE_RATE = 192_000;

const MEDIA_VIDEO_INPUTS: readonly FormatId[] = ["mp4", "mkv", "mov", "webm", "gif"];
const MEDIA_AUDIO_INPUTS: readonly FormatId[] = [
  "mp3",
  "wav",
  "flac",
  "ogg",
  "opus",
  "aac",
  "mp4",
];
const MEDIA_OUTPUT: Readonly<Record<string, FormatId>> = {
  "media/video": "webm",
  "media/audio": "flac",
  "media/gif": "gif",
};
const MEDIA_PRESERVES: readonly MetadataCategory[] = ["date", "author", "comments"];

/** The typed media options. 0 is the "not set" sentinel used by the integer
 * option specs (the native adapter maps it to `null` before building
 * arguments); there is no free-text codec, filter or command option. */
function mediaOptionSpecs(): OptionSpec[] {
  return [
    {
      id: "start_ms",
      label_key: "convert.startMs",
      kind: "integer",
      default: 0,
      min: 0,
      max: MEDIA_MAX_DURATION_MS - 1,
    },
    {
      id: "end_ms",
      label_key: "convert.endMs",
      kind: "integer",
      default: 0,
      min: 0,
      max: MEDIA_MAX_DURATION_MS - 1,
    },
    {
      id: "width",
      label_key: "convert.width",
      kind: "integer",
      default: 0,
      min: 0,
      max: MEDIA_MAX_DIMENSION,
    },
    {
      id: "height",
      label_key: "convert.height",
      kind: "integer",
      default: 0,
      min: 0,
      max: MEDIA_MAX_DIMENSION,
    },
    {
      id: "bitrate_kbps",
      label_key: "convert.bitrate",
      kind: "integer",
      default: 0,
      min: 0,
      max: MEDIA_MAX_BITRATE_KBPS,
    },
    {
      id: "sample_rate",
      label_key: "convert.sampleRate",
      kind: "integer",
      default: 0,
      min: 0,
      max: MEDIA_MAX_SAMPLE_RATE,
    },
    { id: "keep_metadata", label_key: "convert.keepMetadata", kind: "boolean", default: true },
  ];
}

/** One media converter, mirroring `crates/convert/src/media_adapter.rs`. The
 * output container is fixed per converter, so the dialog cannot ask for a
 * format that has no engine route. */
function mediaSpec(id: (typeof MEDIA_CONVERTER_IDS)[number]): ConverterSpec {
  const inputs =
    id === "media/audio" ? MEDIA_AUDIO_INPUTS : MEDIA_VIDEO_INPUTS;
  return {
    id,
    inputs: [...inputs],
    output: MEDIA_OUTPUT[id],
    options: mediaOptionSpecs(),
    input_mode: "each",
    max_input_bytes: 32 * GIB,
    max_output_bytes: 32 * GIB,
    lossy: true,
    preserves: id === "media/gif" ? [] : [...MEDIA_PRESERVES],
    engine_id: "media",
    available: false,
    help_slug: "converting-media",
  };
}

/** The three media declarations. They stay unavailable until the verified
 * `media.encode` pack capability is reported, then `registerEngineConverters`
 * enables them through the one shared registry. */
export const MEDIA_CONVERTER_SPECS: readonly ConverterSpec[] = MEDIA_CONVERTER_IDS.map(
  (id) => mediaSpec(id),
);

const APP_CONVERTER_SPECS: readonly ConverterSpec[] = [
  imageSpec("png"),
  imageSpec("jpeg"),
  imageSpec("webp"),
  imageSpec("bmp"),
  imageSpec("gif"),
  imageSpec("tiff"),
  {
    id: "svg/png",
    inputs: ["svg"],
    output: "png",
    options: [
      { id: "width", label_key: "convert.width", kind: "integer", default: 0, min: 0, max: 65536 },
      { id: "height", label_key: "convert.height", kind: "integer", default: 0, min: 0, max: 65536 },
      {
        id: "keep_aspect",
        label_key: "convert.keepAspect",
        kind: "boolean",
        default: true,
      },
    ],
    input_mode: "each",
    max_input_bytes: 512 * 1024 * 1024,
    max_output_bytes: 1024 * 1024 * 1024,
    lossy: false,
    preserves: [],
    engine_id: "resvg-0.49.0",
    available: true,
    help_slug: "converting-files",
  },
];

/** The exact non-engine adapters this build ships. AVIF and Office stay
 * absent; media is declared separately in `MEDIA_CONVERTER_SPECS` and only
 * becomes available after the verified pack capability. */
export const APP_CONVERTERS: readonly ConverterSpec[] = APP_CONVERTER_SPECS;

/** The adapters Quick Convert can drive today: the 08a image/SVG adapters
 * plus the 08b `images/pdf` combine route. Media entries are added live when
 * the verified engine capability arrives (the array is mutated through
 * `registerEngineConverters`, never by a component). Other 08b routes stay
 * out until their own option forms and preview policy exist. */
const quickConvertConverters: ConverterSpec[] = [
  ...APP_CONVERTER_SPECS,
  ...CONVERSION_ADAPTERS_08B.filter((spec) => spec.id === "images/pdf"),
];
export const QUICK_CONVERT_CONVERTERS: readonly ConverterSpec[] = quickConvertConverters;

/** Register the app's adapters once. A second call is a no-op; duplicate
 * adapter IDs are still refused by `registerConverter`. */
export function registerAppConverters(): void {
  if (appConvertersRegistered) return;
  appConvertersRegistered = true;
  for (const spec of APP_CONVERTERS) {
    if (!converters.has(spec.id)) registerConverter(spec);
  }
  // The 08b declarations share the 08a queue/publication path. AI and
  // extraction converters stay unregistered until their real providers exist.
  registerConversionAdapters08b({ registerConverter });
  // Media specs start declared-but-disabled; the App enables them only when
  // the native capability probe reports a verified `media.encode` pack.
  registerEngineConverters([]);
}

// Install the static table when this module loads. The map is data only; no
// consumer (dialog, preset, extraction publisher) can add or replace an
// adapter, and a later startup call is a no-op.
registerAppConverters();

/** The number of an image option: 0/NaN means "no value". */
export function optionDimension(options: ImageOptions, axis: "width" | "height"): number | undefined {
  const value = options[axis];
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : undefined;
}
