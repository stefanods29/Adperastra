import { srgbToLinear, type Rgba } from "./blend";
import { fail, isFiniteNumber, type Point } from "./types";

/** Magic-wand and select-by-color kernels (Step 18a D5). The wand is
 * 4-connected; both tools compare linear-RGB Euclidean distance divided by
 * sqrt(3) against tolerance/100. A transparent seed matches only transparent
 * pixels. */

export interface FloodPixelSource {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function validateSource(source: FloodPixelSource): void {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height)) fail("image_layers.bad_request");
  if (source.width < 1 || source.height < 1) fail("image_layers.bad_request");
  if (!(source.rgba instanceof Uint8Array) || source.rgba.byteLength !== source.width * source.height * 4) {
    fail("image_layers.bad_request");
  }
}

export function colorDistance(seed: Rgba, pixel: Rgba): number {
  const dr = srgbToLinear(pixel[0] / 255) - srgbToLinear(seed[0] / 255);
  const dg = srgbToLinear(pixel[1] / 255) - srgbToLinear(seed[1] / 255);
  const db = srgbToLinear(pixel[2] / 255) - srgbToLinear(seed[2] / 255);
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

export function colorMatches(seed: Rgba, pixel: Rgba, tolerance: number): boolean {
  if (!isFiniteNumber(tolerance) || tolerance < 0 || tolerance > 100) fail("image_layers.bad_request");
  if (seed[3] === 0) return pixel[3] === 0;
  if (pixel[3] === 0) return false;
  return colorDistance(seed, pixel) <= tolerance / 100;
}

function pixelAt(source: FloodPixelSource, x: number, y: number): Rgba {
  const offset = (y * source.width + x) * 4;
  return [source.rgba[offset], source.rgba[offset + 1], source.rgba[offset + 2], source.rgba[offset + 3]];
}

/** Scanline flood fill. The visited plane is exactly one byte per pixel, so
 * memory is bounded by the same 100 MP cap as the image. `check` is called
 * every 4096 accepted pixels and may throw a cancellation error. */
export function floodFillMask(
  source: FloodPixelSource,
  seed: Point,
  tolerance: number,
  check?: () => void,
): Uint8Array {
  validateSource(source);
  if (!seed || !isFiniteNumber(seed.x) || !isFiniteNumber(seed.y)) fail("image_layers.bad_request");
  if (!isFiniteNumber(tolerance) || tolerance < 0 || tolerance > 100) fail("image_layers.bad_request");
  const startX = Math.floor(seed.x);
  const startY = Math.floor(seed.y);
  if (startX < 0 || startY < 0 || startX >= source.width || startY >= source.height) fail("image_layers.bad_request");
  const seedColor = pixelAt(source, startX, startY);
  const visited = new Uint8Array(source.width * source.height);
  const stack: number[] = [startY * source.width + startX];
  const matches = (x: number, y: number): boolean =>
    !visited[y * source.width + x] && colorMatches(seedColor, pixelAt(source, x, y), tolerance);
  let accepted = 0;
  const tick = () => {
    accepted += 1;
    if ((accepted & 4095) === 0) check?.();
  };
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (visited[index]) continue;
    const y = Math.floor(index / source.width);
    const x = index - y * source.width;
    if (!colorMatches(seedColor, pixelAt(source, x, y), tolerance)) continue;
    let left = x;
    let right = x;
    while (left > 0 && matches(left - 1, y)) left -= 1;
    while (right < source.width - 1 && matches(right + 1, y)) right += 1;
    for (let px = left; px <= right; px += 1) {
      const offset = y * source.width + px;
      if (visited[offset]) continue;
      visited[offset] = 255;
      tick();
    }
    for (const row of [y - 1, y + 1]) {
      if (row < 0 || row >= source.height) continue;
      let px = left;
      while (px <= right) {
        if (!matches(px, row)) {
          px += 1;
          continue;
        }
        stack.push(row * source.width + px);
        while (px <= right && matches(px, row)) px += 1;
      }
    }
  }
  return visited;
}

/** Select by color: the same criterion, applied globally (no connectivity). */
export function globalColorMask(
  source: FloodPixelSource,
  seedColor: Rgba,
  tolerance: number,
  check?: () => void,
): Uint8Array {
  validateSource(source);
  if (!isFiniteNumber(tolerance) || tolerance < 0 || tolerance > 100) fail("image_layers.bad_request");
  const mask = new Uint8Array(source.width * source.height);
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const pixel: Rgba = [source.rgba[offset], source.rgba[offset + 1], source.rgba[offset + 2], source.rgba[offset + 3]];
    if (colorMatches(seedColor, pixel, tolerance)) mask[index] = 255;
    count += 1;
    if ((count & 4095) === 0) check?.();
  }
  return mask;
}
