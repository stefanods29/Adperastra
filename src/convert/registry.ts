import type {
  ConverterId,
  ConverterSpec,
  FormatId,
  ImageOptions,
  MetadataCategory,
  OptionSpec,
} from "./types";

/** The app-wide converter registry (Step 08a E1). Adapters are static data
 * registered at startup; a file, a tab or a command can never add one. */

const converters = new Map<ConverterId, ConverterSpec>();

/** Register one adapter. A duplicate ID is a programming error and is
 * refused instead of silently replacing the first adapter. */
export function registerConverter(spec: ConverterSpec): void {
  if (converters.has(spec.id)) {
    throw new Error(`duplicate converter id: ${spec.id}`);
  }
  if (!spec.available) return;
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
  return converters.get(id) ?? null;
}

/** Test/startup helper: clear the table (never used by the app itself). */
export function resetConverters(): void {
  converters.clear();
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

/** The exact adapters this build ships. AVIF output, media and Office are
 * absent: an unavailable converter is never advertised as working. */
export const APP_CONVERTERS: readonly ConverterSpec[] = APP_CONVERTER_SPECS;

/** Register the app's adapters once. Duplicate registration is refused. */
export function registerAppConverters(): void {
  for (const spec of APP_CONVERTERS) {
    if (!converters.has(spec.id)) registerConverter(spec);
  }
}

/** The number of an image option: 0/NaN means "no value". */
export function optionDimension(options: ImageOptions, axis: "width" | "height"): number | undefined {
  const value = options[axis];
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : undefined;
}
