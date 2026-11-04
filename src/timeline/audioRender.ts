import type { TimelineWarningCode } from "./effectTypes";
import { TimelineError } from "./types";

/** A bounded decoded PCM block, never a complete source array in the UI.
 * Gains for every sample must be resolved with audioMix; callers split a block
 * at fade/sample boundaries or pass a per-sample gain array.
 */
export function mixAudioBlock(
  inputs: readonly Float32Array[], gains: readonly (number | Float32Array)[],
): { samples: Float32Array; peak: number; warnings: TimelineWarningCode[] } {
  if (inputs.length !== gains.length || inputs.length > 10_000) throw new TimelineError("timeline.bad_request");
  const count = inputs[0]?.length ?? 0;
  const bytes = inputs.reduce((sum, input) => sum + input.byteLength, 0);
  if (bytes > 32 * 1024 * 1024 || count > 96_000) throw new TimelineError("timeline.too_large");
  const sums = new Float64Array(count);
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const gain = gains[index];
    if (input.length !== count || (typeof gain !== "number" && gain.length !== count)) throw new TimelineError("timeline.bad_request");
    for (let sample = 0; sample < count; sample++) {
      const g = typeof gain === "number" ? gain : gain[sample];
      if (!Number.isFinite(g) || g < 0 || g > 16 || !Number.isFinite(input[sample])) throw new TimelineError("timeline.bad_request");
      sums[sample] += input[sample] * g;
    }
  }
  let peak = 0;
  const samples = new Float32Array(count);
  for (let sample = 0; sample < count; sample++) {
    peak = Math.max(peak, Math.abs(sums[sample]));
    samples[sample] = Math.max(-1, Math.min(1, sums[sample]));
  }
  return { samples, peak, warnings: peak > 1 ? ["audio_clipping"] : [] };
}

/** Called before any publication sink begins, independently of metadata consent. */
export function requireAudioClippingAcknowledgement(required: boolean, accepted: readonly TimelineWarningCode[]): void {
  if (accepted.length > 64 || new Set(accepted).size !== accepted.length ||
      (required && !accepted.includes("audio_clipping"))) throw new Error("convert.warning_required");
}
