import { fail, type BlendMode } from "./types";

/** Alpha-correct linear-RGB blending (Step 18a D4).
 *
 * Stored pixels are unpremultiplied sRGB RGBA8. Layer sampling converts to
 * linear, premultiplies, interpolates and unpremultiplies again. Compositing
 * uses D4's formula exactly; the output is encoded back to sRGB8. */

export type Rgba = readonly [number, number, number, number];

export function srgbToLinear(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const v = Math.min(1, Math.max(0, value));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const v = Math.min(1, Math.max(0, value));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function byteToLinear(value: number): number {
  return srgbToLinear(value / 255);
}

export function linearToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(linearToSrgb(value) * 255)));
}

export function blendChannel(mode: BlendMode, source: number, backdrop: number): number {
  const s = Math.min(1, Math.max(0, source));
  const b = Math.min(1, Math.max(0, backdrop));
  switch (mode) {
    case "normal":
      return s;
    case "multiply":
      return s * b;
    case "screen":
      return s + b - s * b;
    case "overlay":
      return b <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b);
    case "darken":
      return Math.min(s, b);
    case "lighten":
      return Math.max(s, b);
    case "difference":
      return Math.abs(s - b);
    case "add":
      return Math.min(1, s + b);
    default:
      fail("image_layers.bad_request");
  }
}

export function blendChannels(
  mode: BlendMode,
  source: readonly [number, number, number],
  backdrop: readonly [number, number, number],
): [number, number, number] {
  return [
    blendChannel(mode, source[0], backdrop[0]),
    blendChannel(mode, source[1], backdrop[1]),
    blendChannel(mode, source[2], backdrop[2]),
  ];
}

/** One source-over step in unpremultiplied linear RGB. `maskCoverage` is the
 * selection/mask multiplier 0..1; layer opacity is applied to the source
 * alpha before this call. */
export function compositeLinearPixel(
  backdrop: Rgba,
  source: Rgba,
  mode: BlendMode = "normal",
  opacity = 1,
  maskCoverage = 1,
): Rgba {
  const opacityValue = Math.min(1, Math.max(0, opacity));
  const maskValue = Math.min(1, Math.max(0, maskCoverage));
  const as = Math.min(1, Math.max(0, source[3])) * opacityValue * maskValue;
  const ab = Math.min(1, Math.max(0, backdrop[3]));
  if (as <= 0) return [backdrop[0], backdrop[1], backdrop[2], ab];
  const outA = as + ab * (1 - as);
  if (outA <= 0) return [0, 0, 0, 0];
  const blended = blendChannels(mode, [source[0], source[1], source[2]], [backdrop[0], backdrop[1], backdrop[2]]);
  const mix = (index: number) =>
    (as * (1 - ab) * source[index] + as * ab * blended[index] + (1 - as) * ab * backdrop[index]) / outA;
  return [mix(0), mix(1), mix(2), outA];
}

/** RGBA8 convenience wrapper used by tests and simple 1x1 checks. */
export function compositePixel(
  backdrop: Rgba,
  source: Rgba,
  mode: BlendMode = "normal",
  opacity = 1,
  maskCoverage = 1,
): Rgba {
  const backdropLinear: Rgba = [
    byteToLinear(backdrop[0]),
    byteToLinear(backdrop[1]),
    byteToLinear(backdrop[2]),
    backdrop[3] / 255,
  ];
  const sourceLinear: Rgba = [
    byteToLinear(source[0]),
    byteToLinear(source[1]),
    byteToLinear(source[2]),
    source[3] / 255,
  ];
  const out = compositeLinearPixel(backdropLinear, sourceLinear, mode, opacity, maskCoverage);
  const alpha = Math.round(out[3] * 255);
  if (alpha <= 0) return [0, 0, 0, 0];
  return [linearToByte(out[0]), linearToByte(out[1]), linearToByte(out[2]), alpha];
}

/** Float32 reference of the same formula. The real WebGL2 shader uses highp
 * floats; this reference keeps the CPU/GPU comparison honest without
 * pretending a device was exercised in jsdom. */
export function gpuBlendReference(
  backdrop: Rgba,
  source: Rgba,
  mode: BlendMode,
  opacity = 1,
  maskCoverage = 1,
): Rgba {
  const f = Math.fround;
  const sR = f(byteToLinear(source[0]));
  const sG = f(byteToLinear(source[1]));
  const sB = f(byteToLinear(source[2]));
  const bR = f(byteToLinear(backdrop[0]));
  const bG = f(byteToLinear(backdrop[1]));
  const bB = f(byteToLinear(backdrop[2]));
  const as = f(f(f(source[3] / 255) * f(opacity)) * f(maskCoverage));
  const ab = f(backdrop[3] / 255);
  if (as <= 0) {
    return [Math.round(linearToSrgb(bR) * 255), Math.round(linearToSrgb(bG) * 255), Math.round(linearToSrgb(bB) * 255), Math.round(ab * 255)];
  }
  const outA = f(as + f(ab * f(1 - as)));
  if (outA <= 0) return [0, 0, 0, 0];
  const channel = (s: number, b: number): number => {
    let blended: number;
    switch (mode) {
      case "normal":
        blended = s;
        break;
      case "multiply":
        blended = f(s * b);
        break;
      case "screen":
        blended = f(f(s + b) - f(s * b));
        break;
      case "overlay":
        blended = b <= 0.5 ? f(f(2 * s) * b) : f(1 - f(f(2 * f(1 - s)) * f(1 - b)));
        break;
      case "darken":
        blended = Math.min(s, b);
        break;
      case "lighten":
        blended = Math.max(s, b);
        break;
      case "difference":
        blended = Math.abs(s - b);
        break;
      case "add":
        blended = Math.min(1, f(s + b));
        break;
      default:
        return 0;
    }
    return f(
      f(f(f(as * f(1 - ab)) * s) + f(f(as * ab) * blended)) + f(f(f(1 - as) * ab) * b),
    ) / outA;
  };
  return [
    Math.round(linearToSrgb(channel(sR, bR)) * 255),
    Math.round(linearToSrgb(channel(sG, bG)) * 255),
    Math.round(linearToSrgb(channel(sB, bB)) * 255),
    Math.round(outA * 255),
  ];
}
