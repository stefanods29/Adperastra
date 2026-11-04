import { clamp01, luminance } from "./adjustments";
import { fail, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, type ImageAdjustment, type Point } from "./types";

/** Adjustment-layer math (Step 18b D4). Deterministic, no AI, alpha never
 * changes except through an explicit layer mask or paint. The same functions
 * serve the preview worker and the flattened export. */

export type Rgba8 = [number, number, number, number];

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateImageAdjustment(adjustment: ImageAdjustment): void {
  if (!adjustment || typeof adjustment !== "object") fail("image_edit.bad_request");
  switch (adjustment.kind) {
    case "curves": {
      if (!Array.isArray(adjustment.points) || adjustment.points.length < 2 || adjustment.points.length > 32) {
        fail("image_edit.bad_request");
      }
      let previous = -Infinity;
      for (const point of adjustment.points) {
        if (!point || !isUnit(point.x) || !isUnit(point.y)) fail("image_edit.bad_request");
        if (point.x <= previous) fail("image_edit.bad_request");
        previous = point.x;
      }
      if (Math.abs(adjustment.points[0].x) > 1e-9) fail("image_edit.bad_request");
      if (Math.abs(adjustment.points[adjustment.points.length - 1].x - 1) > 1e-9) fail("image_edit.bad_request");
      return;
    }
    case "levels": {
      if (!isUnit(adjustment.black) || !isUnit(adjustment.white)) fail("image_edit.bad_request");
      if (adjustment.white <= adjustment.black) fail("image_edit.bad_request");
      if (!isUnit(adjustment.gamma) || adjustment.gamma < 0.1 || adjustment.gamma > 10) fail("image_edit.bad_request");
      return;
    }
    case "hue_saturation": {
      if (typeof adjustment.hue_degrees !== "number" || !Number.isFinite(adjustment.hue_degrees)) fail("image_edit.bad_request");
      if (adjustment.hue_degrees < -180 || adjustment.hue_degrees > 180) fail("image_edit.bad_request");
      if (typeof adjustment.saturation !== "number" || !Number.isFinite(adjustment.saturation)) fail("image_edit.bad_request");
      if (adjustment.saturation < -1 || adjustment.saturation > 1) fail("image_edit.bad_request");
      if (typeof adjustment.lightness !== "number" || !Number.isFinite(adjustment.lightness)) fail("image_edit.bad_request");
      if (adjustment.lightness < -1 || adjustment.lightness > 1) fail("image_edit.bad_request");
      return;
    }
    case "color_balance": {
      for (const shift of [adjustment.shadows, adjustment.midtones, adjustment.highlights]) {
        if (!Array.isArray(shift) || shift.length !== 3) fail("image_edit.bad_request");
        for (const value of shift) {
          if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) fail("image_edit.bad_request");
        }
      }
      return;
    }
    case "gaussian": {
      if (typeof adjustment.radius !== "number" || !Number.isFinite(adjustment.radius) || adjustment.radius < 0 || adjustment.radius > 64) {
        fail("image_edit.bad_request");
      }
      return;
    }
    case "unsharp": {
      if (typeof adjustment.radius !== "number" || !Number.isFinite(adjustment.radius) || adjustment.radius < 0 || adjustment.radius > 64) {
        fail("image_edit.bad_request");
      }
      if (typeof adjustment.amount !== "number" || !Number.isFinite(adjustment.amount) || adjustment.amount < 0 || adjustment.amount > 2) {
        fail("image_edit.bad_request");
      }
      return;
    }
    case "noise_reduce": {
      if (!Number.isInteger(adjustment.radius) || adjustment.radius < 1 || adjustment.radius > 8) fail("image_edit.bad_request");
      if (typeof adjustment.strength !== "number" || !Number.isFinite(adjustment.strength) || adjustment.strength < 0 || adjustment.strength > 1) {
        fail("image_edit.bad_request");
      }
      return;
    }
    case "artistic": {
      if (adjustment.mode !== "posterize" && adjustment.mode !== "emboss" && adjustment.mode !== "pixelate") {
        fail("image_edit.bad_request");
      }
      if (typeof adjustment.amount !== "number" || !Number.isFinite(adjustment.amount) || adjustment.amount < 1 || adjustment.amount > 64) {
        fail("image_edit.bad_request");
      }
      return;
    }
    default:
      fail("image_edit.bad_request");
  }
}

function validateImage(rgba: Uint8Array, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail("image_edit.bad_request");
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    fail("image_edit.too_large");
  }
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== width * height * 4) fail("image_edit.bad_request");
}

function roundByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/* ------------------------------- point ops ------------------------------- */

export function levelsChannel(value: number, black: number, white: number, gamma: number): number {
  if (!isUnit(value) || !isUnit(black) || !isUnit(white) || white <= black) fail("image_edit.bad_request");
  if (!isUnit(gamma) || gamma < 0.1 || gamma > 10) fail("image_edit.bad_request");
  return clamp01(Math.pow(clamp01((value - black) / (white - black)), 1 / gamma));
}

export function curveValue(points: readonly Point[], x: number): number {
  if (!Array.isArray(points) || points.length < 2 || points.length > 32) fail("image_edit.bad_request");
  if (!Number.isFinite(x)) fail("image_edit.bad_request");
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    if (x > right.x) continue;
    const left = points[index - 1];
    const span = right.x - left.x;
    if (span <= 0) fail("image_edit.bad_request");
    const ratio = (x - left.x) / span;
    return clamp01(left.y + (right.y - left.y) * ratio);
  }
  return points[points.length - 1].y;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, lightness];
  const delta = maximum - minimum;
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  let hue: number;
  if (maximum === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hueChannel(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation <= 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const h = (((hue % 360) + 360) % 360) / 360;
  return [hueChannel(p, q, h + 1 / 3), hueChannel(p, q, h), hueChannel(p, q, h - 1 / 3)];
}

export function hueSaturationPixel(
  red: number,
  green: number,
  blue: number,
  hueDegrees: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  if (!isUnit(red) || !isUnit(green) || !isUnit(blue)) fail("image_edit.bad_request");
  const [h, s, l] = rgbToHsl(red, green, blue);
  const nextSaturation = clamp01(s + saturation);
  const nextLightness = clamp01(l + lightness);
  return hslToRgb(h + hueDegrees, nextSaturation, nextLightness);
}

export function colorBalancePixel(
  red: number,
  green: number,
  blue: number,
  shadows: readonly [number, number, number],
  midtones: readonly [number, number, number],
  highlights: readonly [number, number, number],
): [number, number, number] {
  const y = luminance(red, green, blue);
  const shadowWeight = Math.max(0, 1 - 2 * y);
  const highlightWeight = Math.max(0, 2 * y - 1);
  const midtoneWeight = 1 - shadowWeight - highlightWeight;
  return [
    clamp01(red + shadows[0] * shadowWeight + midtones[0] * midtoneWeight + highlights[0] * highlightWeight),
    clamp01(green + shadows[1] * shadowWeight + midtones[1] * midtoneWeight + highlights[1] * highlightWeight),
    clamp01(blue + shadows[2] * shadowWeight + midtones[2] * midtoneWeight + highlights[2] * highlightWeight),
  ];
}

/* ------------------------------- region ops ------------------------------ */

function gaussianKernel(radius: number): { support: number; kernel: Float32Array } {
  const support = Math.ceil(radius);
  const sigma = Math.max(radius / 3, 0.1);
  const kernel = new Float32Array(support * 2 + 1);
  let sum = 0;
  for (let offset = -support; offset <= support; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + support] = weight;
    sum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  return { support, kernel };
}

/** Separable Gaussian, edge clamp; alpha is copied unchanged. */
export function gaussianBlur(rgba: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  validateImage(rgba, width, height);
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0 || radius > 64) fail("image_edit.bad_request");
  if (radius <= 0) return new Uint8Array(rgba);
  const { support, kernel } = gaussianKernel(radius);
  const horizontal = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        for (let offset = -support; offset <= support; offset += 1) {
          const cx = Math.min(width - 1, Math.max(0, x + offset));
          value += rgba[(y * width + cx) * 4 + channel] * kernel[offset + support];
        }
        horizontal[(y * width + x) * 3 + channel] = value;
      }
    }
  }
  const output = new Uint8Array(rgba.byteLength);
  const scratch = new Float32Array(width * height * 3);
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
        output[(y * width + x) * 4 + channel] = Math.max(
          0,
          Math.min(255, Math.round(scratch[(y * width + x) * 3 + channel])),
        );
      }
      output[(y * width + x) * 4 + 3] = rgba[(y * width + x) * 4 + 3];
    }
  }
  return output;
}

/** Per-channel local median; deterministic for identical input. */
export function medianFilter(rgba: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  validateImage(rgba, width, height);
  if (!Number.isInteger(radius) || radius < 1 || radius > 8) fail("image_edit.bad_request");
  const output = new Uint8Array(rgba.byteLength);
  const window: number[] = [];
  const span = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        window.length = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -radius; dx <= radius; dx += 1) {
            const sx = Math.min(width - 1, Math.max(0, x + dx));
            window.push(rgba[(sy * width + sx) * 4 + channel]);
          }
        }
        if (window.length !== span * span) fail("image_edit.failed");
        window.sort((left, right) => left - right);
        output[offset + channel] = window[(window.length - 1) >> 1];
      }
      output[offset + 3] = rgba[offset + 3];
    }
  }
  return output;
}

function emboss(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
  const output = new Uint8Array(rgba.byteLength);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = Math.min(width - 1, Math.max(0, x + dx));
            sum += (rgba[(sy * width + sx) * 4 + channel] / 255) * kernel[(dy + 1) * 3 + (dx + 1)];
          }
        }
        output[offset + channel] = roundByte(clamp01(sum + 0.5));
      }
      output[offset + 3] = rgba[offset + 3];
    }
  }
  return output;
}

function pixelate(rgba: Uint8Array, width: number, height: number, amount: number): Uint8Array {
  const block = Math.max(1, Math.min(64, Math.round(amount)));
  const output = new Uint8Array(rgba.byteLength);
  for (let blockY = 0; blockY < height; blockY += block) {
    for (let blockX = 0; blockX < width; blockX += block) {
      const endY = Math.min(height, blockY + block);
      const endX = Math.min(width, blockX + block);
      const totals = [0, 0, 0];
      let count = 0;
      for (let y = blockY; y < endY; y += 1) {
        for (let x = blockX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          totals[0] += rgba[offset];
          totals[1] += rgba[offset + 1];
          totals[2] += rgba[offset + 2];
          count += 1;
        }
      }
      if (count === 0) continue;
      const average = [Math.round(totals[0] / count), Math.round(totals[1] / count), Math.round(totals[2] / count)];
      for (let y = blockY; y < endY; y += 1) {
        for (let x = blockX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          output[offset] = average[0];
          output[offset + 1] = average[1];
          output[offset + 2] = average[2];
          output[offset + 3] = rgba[offset + 3];
        }
      }
    }
  }
  return output;
}

function posterize(rgba: Uint8Array, width: number, height: number, amount: number): Uint8Array {
  const levels = Math.max(2, Math.min(64, Math.round(amount)));
  const output = new Uint8Array(rgba.byteLength);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = rgba[offset + channel] / 255;
      output[offset + channel] = roundByte(Math.round(value * (levels - 1)) / (levels - 1));
    }
    output[offset + 3] = rgba[offset + 3];
  }
  return output;
}

/** Applies one adjustment to an RGBA region. `mask` and `opacity` weight the
 * color change only; alpha is never altered by an adjustment. */
export function applyAdjustmentToRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  adjustment: ImageAdjustment,
  opacity = 1,
  mask?: Uint8Array,
): Uint8Array {
  validateImage(rgba, width, height);
  validateImageAdjustment(adjustment);
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    fail("image_edit.bad_request");
  }
  if (mask && (!(mask instanceof Uint8Array) || mask.byteLength !== width * height)) fail("image_edit.bad_request");
  let adjusted: Uint8Array;
  switch (adjustment.kind) {
    case "gaussian":
      adjusted = gaussianBlur(rgba, width, height, adjustment.radius);
      break;
    case "unsharp": {
      const blurred = gaussianBlur(rgba, width, height, adjustment.radius);
      adjusted = new Uint8Array(rgba.byteLength);
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const original = rgba[offset + channel] / 255;
          const soft = blurred[offset + channel] / 255;
          adjusted[offset + channel] = roundByte(clamp01(original + adjustment.amount * (original - soft)));
        }
        adjusted[offset + 3] = rgba[offset + 3];
      }
      break;
    }
    case "noise_reduce": {
      const median = medianFilter(rgba, width, height, adjustment.radius);
      adjusted = new Uint8Array(rgba.byteLength);
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const original = rgba[offset + channel] / 255;
          const smooth = median[offset + channel] / 255;
          adjusted[offset + channel] = roundByte(clamp01(original + (smooth - original) * adjustment.strength));
        }
        adjusted[offset + 3] = rgba[offset + 3];
      }
      break;
    }
    case "artistic":
      if (adjustment.mode === "emboss") adjusted = emboss(rgba, width, height);
      else if (adjustment.mode === "pixelate") adjusted = pixelate(rgba, width, height, adjustment.amount);
      else adjusted = posterize(rgba, width, height, adjustment.amount);
      break;
    default: {
      adjusted = new Uint8Array(rgba.byteLength);
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        const red = rgba[offset] / 255;
        const green = rgba[offset + 1] / 255;
        const blue = rgba[offset + 2] / 255;
        let next: [number, number, number];
        if (adjustment.kind === "curves") {
          next = [curveValue(adjustment.points, red), curveValue(adjustment.points, green), curveValue(adjustment.points, blue)];
        } else if (adjustment.kind === "levels") {
          next = [
            levelsChannel(red, adjustment.black, adjustment.white, adjustment.gamma),
            levelsChannel(green, adjustment.black, adjustment.white, adjustment.gamma),
            levelsChannel(blue, adjustment.black, adjustment.white, adjustment.gamma),
          ];
        } else if (adjustment.kind === "hue_saturation") {
          next = hueSaturationPixel(red, green, blue, adjustment.hue_degrees, adjustment.saturation, adjustment.lightness);
        } else {
          next = colorBalancePixel(red, green, blue, adjustment.shadows, adjustment.midtones, adjustment.highlights);
        }
        adjusted[offset] = roundByte(next[0]);
        adjusted[offset + 1] = roundByte(next[1]);
        adjusted[offset + 2] = roundByte(next[2]);
        adjusted[offset + 3] = rgba[offset + 3];
      }
      break;
    }
  }
  if (opacity >= 1 && !mask) return adjusted;
  const output = new Uint8Array(rgba.byteLength);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const weight = opacity * (mask ? mask[index] / 255 : 1);
    if (weight <= 0) {
      output.set(rgba.subarray(offset, offset + 4), offset);
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(rgba[offset + channel] + (adjusted[offset + channel] - rgba[offset + channel]) * weight);
    }
    output[offset + 3] = rgba[offset + 3];
  }
  return output;
}
