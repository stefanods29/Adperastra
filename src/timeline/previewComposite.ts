import type { Rgba, TransitionDirection } from "./types";
import { TimelineError } from "./types";
import type { ColorPixel } from "./colorEffects";
import { transitionWeights } from "./transitions";

/** Project transition colors are four u8 components; composition math is 0..1. */
export function transitionColor(rgba: Rgba): ColorPixel {
  if (!Array.isArray(rgba) || rgba.length !== 4 ||
      rgba.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)) {
    throw new TimelineError("timeline.bad_request");
  }
  return [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
}

/** Pixel-center threshold. Direction names identify the edge revealed first. */
export function wipeRevealsPixel(
  direction: TransitionDirection, fraction: number, x: number, y: number, width: number, height: number,
): boolean {
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 ||
      x < 0 || x >= width || y < 0 || y >= height || !Number.isFinite(fraction)) {
    throw new TimelineError("timeline.bad_request");
  }
  const f = Math.max(0, Math.min(1, fraction));
  switch (direction) {
    case "left": return (x + 0.5) / width < f;
    case "right": return (width - x - 0.5) / width < f;
    case "up": return (y + 0.5) / height < f;
    case "down": return (height - y - 0.5) / height < f;
    default: throw new TimelineError("timeline.unsupported");
  }
}

function linear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Premultiplied linear RGB/alpha, not an sRGB `ColorPixel`. */
export type LinearPremultipliedPixel = readonly [number, number, number, number];

/** sRGB input -> premultiplied linear RGB/alpha output. No encoded-space blend. */
export function compositeTransitionPixel(
  left: ColorPixel, right: ColorPixel, kind: "crossfade" | "dip", fraction: number, color: ColorPixel,
): LinearPremultipliedPixel {
  for (const pixel of [left, right, color]) {
    if (pixel.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new TimelineError("timeline.bad_request");
  }
  const weights = transitionWeights(kind, fraction);
  const result = [0, 0, 0, 0];
  for (const [pixel, weight] of [[left, weights.left], [right, weights.right], [color, weights.color]] as const) {
    for (let i = 0; i < 3; i++) result[i] += linear(pixel[i]) * pixel[3] * weight;
    result[3] += pixel[3] * weight;
  }
  return result as [number, number, number, number];
}
