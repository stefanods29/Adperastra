/**
 * Converter adapter `image/ai-upscale` (Step 14c, E6/U6).
 *
 * The shared Quick Convert dialog, request, loss acknowledgment, naming,
 * reporting and owned publication stay in 08a. This module only adds the
 * adapter descriptor and the AI option union member.
 */

import type { JobHandle } from "../services/jobs";
import type {
  ConversionOutput,
  ConversionReport,
  ConversionRequest,
  ConverterSpec,
  FormatId,
  MetadataCategory,
} from "../convert/types";
import { startConversion } from "../services/convert";
import type { AiDevice, UpscaleModel, UpscaleScale } from "../services/localAiTypes";

export const AI_UPSCALE_CONVERTER_ID = "image/ai-upscale" as const;
export const AI_UPSCALE_OUTPUT_FORMAT: FormatId = "png";
export const AI_UPSCALE_MAX_BATCH = 1_000;
export const AI_UPSCALE_MAX_INPUT_BYTES = 256 * 1024 * 1024;
export const AI_UPSCALE_MAX_OUTPUT_BYTES = 1_073_741_824;

/** Additive 08a `ConvertOptions` member; the coordinator moves the union arm
 * into `src/convert/types.ts` and keeps this exact shape. Until then the
 * adapter uses the local request type so the AI option stays typed. */
export interface AiUpscaleConversionOptions {
  scale: UpscaleScale;
  model: UpscaleModel;
  device: AiDevice;
}

export type AiUpscaleConvertOptions = {
  kind: "ai_upscale";
  value: AiUpscaleConversionOptions;
};

export type AiUpscaleConversionRequest = Omit<
  ConversionRequest,
  "converter_id" | "options"
> & {
  converter_id: typeof AI_UPSCALE_CONVERTER_ID;
  options: AiUpscaleConvertOptions;
};

export const AI_UPSCALE_METADATA_LOSS: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "icc",
  "xmp",
  "iptc",
  "author",
  "comments",
];

export function defaultAiUpscaleOptions(): AiUpscaleConvertOptions {
  return { kind: "ai_upscale", value: { scale: 4, model: "general", device: "auto" } };
}

export function aiUpscaleConverterSpec(available: boolean): ConverterSpec {
  return {
    id: AI_UPSCALE_CONVERTER_ID,
    inputs: ["png", "jpeg", "webp", "bmp", "gif", "tiff"],
    output: AI_UPSCALE_OUTPUT_FORMAT,
    options: [
      {
        id: "scale",
        label_key: "ai.scale",
        kind: "choice",
        default: "4",
        choices: [
          { value: "2", label_key: "ai.scale2" },
          { value: "4", label_key: "ai.scale4" },
        ],
      },
      {
        id: "model",
        label_key: "ai.model",
        kind: "choice",
        default: "general",
        choices: [
          { value: "general", label_key: "ai.general" },
          { value: "photo", label_key: "ai.photo" },
          { value: "drawing", label_key: "ai.drawing" },
        ],
      },
      {
        id: "device",
        label_key: "ai.device",
        kind: "choice",
        default: "auto",
        choices: [
          { value: "auto", label_key: "ai.auto" },
          { value: "cpu", label_key: "ai.cpu" },
          { value: "gpu", label_key: "ai.gpu" },
        ],
      },
    ],
    input_mode: "each",
    max_input_bytes: AI_UPSCALE_MAX_INPUT_BYTES,
    max_output_bytes: AI_UPSCALE_MAX_OUTPUT_BYTES,
    lossy: false,
    preserves: [],
    engine_id: "ai-upscale",
    available,
    help_slug: "ai-upscaling",
  };
}

export function validateAiUpscaleRequest(request: AiUpscaleConversionRequest): void {
  if (request.converter_id !== AI_UPSCALE_CONVERTER_ID) throw new Error("ai.bad_request");
  if (request.options.kind !== "ai_upscale") throw new Error("ai.bad_request");
  if (!request.keep_original) throw new Error("ai.bad_request");
  if (request.inputs.length === 0 || request.inputs.length > AI_UPSCALE_MAX_BATCH) {
    throw new Error("ai.bad_request");
  }
  for (const category of AI_UPSCALE_METADATA_LOSS) {
    if (!request.accepted_losses.includes(category)) {
      throw new Error("convert.loss_unacknowledged");
    }
  }
}

/** Build the shared request; the original is always kept. */
export function buildAiUpscaleRequest(input: {
  inputs: ConversionRequest["inputs"];
  dest_dir: string;
  naming: ConversionRequest["naming"];
  options?: AiUpscaleConvertOptions;
  request_revision?: number;
  accepted_warning_codes?: ConversionRequest["accepted_warning_codes"];
}): AiUpscaleConversionRequest {
  return {
    inputs: input.inputs,
    converter_id: AI_UPSCALE_CONVERTER_ID,
    options: input.options ?? defaultAiUpscaleOptions(),
    dest_dir: input.dest_dir,
    keep_original: true,
    accepted_losses: [...AI_UPSCALE_METADATA_LOSS],
    accepted_warning_codes: input.accepted_warning_codes ?? [],
    request_revision: input.request_revision ?? 1,
    naming: input.naming,
  };
}

const active = new Map<string, JobHandle<ConversionReport>>();

function jobKey(request: AiUpscaleConversionRequest): string {
  const inputs = request.inputs
    .map((entry) =>
      entry.kind === "file"
        ? `file:${entry.path}`
        : `snapshot:${entry.snapshot_id}:${entry.revision}`,
    )
    .join("|");
  return `${request.converter_id}:${request.request_revision}:${inputs}`;
}

/**
 * Duplicate clicks reuse the one active job for the same request identity.
 * The entry is removed only when that job settles.
 *
 * The shared 08a runner sees the request through its public
 * `ConversionRequest` shape once the coordinator adds the `ai_upscale` union
 * arm and registry entry; this adapter never bypasses that runner.
 */
export async function startAiUpscaleConversion(
  request: AiUpscaleConversionRequest,
): Promise<JobHandle<ConversionReport>> {
  validateAiUpscaleRequest(request);
  const key = jobKey(request);
  const existing = active.get(key);
  if (existing) return existing;
  const job = await startConversion(request as unknown as ConversionRequest);
  active.set(key, job);
  void job.completion.finally(() => {
    if (active.get(key) === job) active.delete(key);
  }).catch(() => undefined);
  return job;
}

export function validateBatchCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > AI_UPSCALE_MAX_BATCH) {
    throw new Error("ai.bad_request");
  }
}

/** Outputs the shared runner created; never the original input path. */
export function candidateOutputs(report: ConversionReport, inputPaths: readonly string[]): ConversionOutput[] {
  const originals = new Set(inputPaths);
  return report.outputs.filter((output) => !originals.has(output.path));
}
