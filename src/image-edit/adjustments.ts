import {
  createDefaultAdjustments,
  fail,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  validateAdjustments,
  type AdjustmentPreset,
  type ImageAdjustments,
} from "./types";

/** Deterministic adjustment math (D5/D6). All work is on normalized RGB with
 * a clamp after every stage; alpha is never touched. The Rust mirror lives in
 * `crates/image-edit/src/adjustments.rs` and must produce the same values. */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function brightnessChannel(value: number, brightness: number): number {
  return clamp01(value + brightness);
}

export function contrastChannel(value: number, contrast: number): number {
  return clamp01((value - 0.5) * (1 + contrast) + 0.5);
}

export function luminance(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function saturationChannels(
  red: number,
  green: number,
  blue: number,
  saturation: number,
): [number, number, number] {
  const y = luminance(red, green, blue);
  return [
    clamp01(y + (red - y) * (1 + saturation)),
    clamp01(y + (green - y) * (1 + saturation)),
    clamp01(y + (blue - y) * (1 + saturation)),
  ];
}

export function warmthChannels(
  red: number,
  green: number,
  blue: number,
  warmth: number,
): [number, number, number] {
  return [clamp01(red + 0.1 * warmth), clamp01(green), clamp01(blue - 0.1 * warmth)];
}

export function sepiaChannels(red: number, green: number, blue: number): [number, number, number] {
  return [
    clamp01(0.393 * red + 0.769 * green + 0.189 * blue),
    clamp01(0.349 * red + 0.686 * green + 0.168 * blue),
    clamp01(0.272 * red + 0.534 * green + 0.131 * blue),
  ];
}

/** Presets replace adjustment values only; geometry, marks and paint stay. */
export function presetAdjustments(preset: Exclude<AdjustmentPreset, "custom">): ImageAdjustments {
  const defaults = createDefaultAdjustments();
  switch (preset) {
    case "original":
      return defaults;
    case "vivid":
      return { ...defaults, contrast: 0.15, saturation: 0.2, preset: "vivid" };
    case "warm":
      return { ...defaults, warmth: 0.3, preset: "warm" };
    case "cool":
      return { ...defaults, warmth: -0.3, preset: "cool" };
    case "bw":
      return { ...defaults, saturation: -1, preset: "bw" };
    case "sepia":
      return { ...defaults, preset: "sepia" };
    default:
      return defaults;
  }
}

export function sameAdjustments(left: ImageAdjustments, right: ImageAdjustments): boolean {
  return (
    left.brightness === right.brightness &&
    left.contrast === right.contrast &&
    left.saturation === right.saturation &&
    left.warmth === right.warmth &&
    left.sharpness === right.sharpness &&
    left.blur === right.blur &&
    left.preset === right.preset
  );
}

/** Clamps UI values and marks a hand-edited preset as `custom`. */
export function normalizeAdjustments(input: Partial<ImageAdjustments> | null | undefined): ImageAdjustments {
  const defaults = createDefaultAdjustments();
  const number = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  const preset = (input?.preset ?? defaults.preset) as AdjustmentPreset;
  const next: ImageAdjustments = {
    brightness: number(input?.brightness, defaults.brightness, -1, 1),
    contrast: number(input?.contrast, defaults.contrast, -1, 1),
    saturation: number(input?.saturation, defaults.saturation, -1, 1),
    warmth: number(input?.warmth, defaults.warmth, -1, 1),
    sharpness: number(input?.sharpness, defaults.sharpness, 0, 1),
    blur: number(input?.blur, defaults.blur, 0, 64),
    preset: ["original", "vivid", "warm", "cool", "bw", "sepia", "custom"].includes(preset) ? preset : "custom",
  };
  if (next.preset !== "custom" && !sameAdjustments(next, presetAdjustments(next.preset as Exclude<AdjustmentPreset, "custom">))) {
    next.preset = "custom";
  }
  return next;
}

function roundByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Applies every stage to one pixel. `out` is RGBA8. */
function applyPixel(
  red: number,
  green: number,
  blue: number,
  adjustments: ImageAdjustments,
): [number, number, number] {
  let r = brightnessChannel(red, adjustments.brightness);
  let g = brightnessChannel(green, adjustments.brightness);
  let b = brightnessChannel(blue, adjustments.brightness);
  r = contrastChannel(r, adjustments.contrast);
  g = contrastChannel(g, adjustments.contrast);
  b = contrastChannel(b, adjustments.contrast);
  [r, g, b] = saturationChannels(r, g, b, adjustments.saturation);
  [r, g, b] = warmthChannels(r, g, b, adjustments.warmth);
  if (adjustments.preset === "sepia") [r, g, b] = sepiaChannels(r, g, b);
  return [r, g, b];
}

function sharpen(
  source: Uint8Array,
  width: number,
  height: number,
  amount: number,
  target: Uint8Array,
): void {
  const at = (x: number, y: number, channel: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return source[(cy * width + cx) * 4 + channel] / 255;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const center = at(x, y, channel);
        const kernel =
          5 * center - at(x - 1, y, channel) - at(x + 1, y, channel) - at(x, y - 1, channel) - at(x, y + 1, channel);
        const value = clamp01(center + amount * (kernel - center));
        target[(y * width + x) * 4 + channel] = roundByte(value);
      }
    }
  }
}

/** Separable Gaussian with edge clamp; radius 0 is a strict identity. */
function blur(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  target: Uint8Array,
  scratch: Float32Array,
): void {
  if (radius <= 0) {
    target.set(source);
    return;
  }
  const sigma = Math.max(radius / 3, 0.1);
  const support = Math.ceil(radius);
  const kernel = new Float32Array(support * 2 + 1);
  let sum = 0;
  for (let offset = -support; offset <= support; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + support] = weight;
    sum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  const horizontal = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        for (let offset = -support; offset <= support; offset += 1) {
          const cx = Math.min(width - 1, Math.max(0, x + offset));
          value += source[(y * width + cx) * 4 + channel] * kernel[offset + support];
        }
        horizontal[(y * width + x) * 3 + channel] = value;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        for (let offset = -support; offset <= support; offset += 1) {
          const cy = Math.min(height - 1, Math.max(0, y + offset));
          value += horizontal[(cy * width + x) * 3 + channel] * kernel[offset + support];
        }
        scratch[(y * width + x) * 3 + channel] = value;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        target[(y * width + x) * 4 + channel] = Math.max(0, Math.min(255, Math.round(scratch[(y * width + x) * 3 + channel])));
      }
    }
  }
}

/** Returns a new RGBA buffer with all adjustment stages applied. */
export function applyAdjustments(
  rgba: Uint8Array,
  width: number,
  height: number,
  adjustments: ImageAdjustments,
): Uint8Array {
  validateAdjustments(adjustments);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail("image_edit.bad_request");
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) fail("image_edit.too_large");
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== width * height * 4) fail("image_edit.bad_request");
  const out = new Uint8Array(rgba.byteLength);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const [r, g, b] = applyPixel(rgba[offset] / 255, rgba[offset + 1] / 255, rgba[offset + 2] / 255, adjustments);
    out[offset] = roundByte(r);
    out[offset + 1] = roundByte(g);
    out[offset + 2] = roundByte(b);
    out[offset + 3] = rgba[offset + 3];
  }
  if (adjustments.sharpness > 0) {
    const stageInput = new Uint8Array(out);
    sharpen(stageInput, width, height, adjustments.sharpness, out);
    for (let index = 0; index < width * height; index += 1) out[index * 4 + 3] = rgba[index * 4 + 3];
  }
  if (adjustments.blur > 0) {
    const blurred = new Uint8Array(out.byteLength);
    blur(out, width, height, adjustments.blur, blurred, new Float32Array(width * height * 3));
    for (let index = 0; index < width * height; index += 1) blurred[index * 4 + 3] = rgba[index * 4 + 3];
    return blurred;
  }
  return out;
}
