import {
  effectiveDiameter,
  validateBrushSamples,
  validateBrushSettings,
  type BrushSample,
  type BrushSettings,
} from "./brushTypes";
import { fail } from "./types";

/** Deterministic brush resampling (Step 18b D2).
 *
 * Stamps are placed by accumulated arc length, never by pointer-event count.
 * Collinear runs are collapsed before measuring, so two events on a straight
 * path produce exactly the same stamps as two hundred events on the same
 * path. Pressure, tilt and the pressure-dependent diameter are interpolated
 * along the canonical polyline.
 */

export interface BrushStamp {
  x: number;
  y: number;
  pressure: number;
  tilt_x: number;
  tilt_y: number;
  /** Pressure-scaled diameter in canvas pixels. */
  diameter: number;
}

/** A gesture at the smallest spacing would otherwise create millions of
 * stamps; refuse it instead of freezing the editor. */
export const MAX_STAMPS = 1_000_000;

interface PathPoint {
  x: number;
  y: number;
  pressure: number;
  tilt_x: number;
  tilt_y: number;
}

function samePoint(left: PathPoint, right: PathPoint): boolean {
  return Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9;
}

/** Removes points that lie on the straight segment between their neighbours
 * (same direction, negligible cross product). The first and last points are
 * always kept. */
function simplify(points: readonly PathPoint[]): PathPoint[] {
  const output: PathPoint[] = [];
  for (const point of points) {
    if (output.length > 0 && samePoint(output[output.length - 1], point)) continue;
    output.push(point);
    while (output.length >= 3) {
      const a = output[output.length - 3];
      const b = output[output.length - 2];
      const c = output[output.length - 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const cross = abx * bcy - aby * bcx;
      const dot = abx * bcx + aby * bcy;
      const scale = Math.max(1, Math.hypot(abx, aby) * Math.hypot(bcx, bcy));
      if (dot > 0 && Math.abs(cross) <= 1e-9 * scale) {
        // Keep a point whose pressure/tilt is not the linear value between its
        // neighbours: the pen detail must survive even on a straight path.
        const ab = Math.hypot(abx, aby);
        const bc = Math.hypot(bcx, bcy);
        const ratio = ab + bc <= 0 ? 0 : ab / (ab + bc);
        const linear = (start: number, end: number) => start + (end - start) * ratio;
        if (
          Math.abs(b.pressure - linear(a.pressure, c.pressure)) <= 1e-9 &&
          Math.abs(b.tilt_x - linear(a.tilt_x, c.tilt_x)) <= 1e-9 &&
          Math.abs(b.tilt_y - linear(a.tilt_y, c.tilt_y)) <= 1e-9
        ) {
          output.splice(output.length - 2, 1);
          continue;
        }
      }
      break;
    }
  }
  return output;
}

function pressureAt(points: readonly PathPoint[], cumulative: readonly number[], distance: number): PathPoint {
  const total = cumulative[cumulative.length - 1];
  if (distance <= 0) return points[0];
  if (distance >= total) return points[points.length - 1];
  let low = 0;
  let high = cumulative.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] <= distance) low = middle;
    else high = middle;
  }
  const start = points[low];
  const end = points[high];
  const span = cumulative[high] - cumulative[low];
  const ratio = span <= 0 ? 0 : (distance - cumulative[low]) / span;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    pressure: start.pressure + (end.pressure - start.pressure) * ratio,
    tilt_x: start.tilt_x + (end.tilt_x - start.tilt_x) * ratio,
    tilt_y: start.tilt_y + (end.tilt_y - start.tilt_y) * ratio,
  };
}

function stamp(point: PathPoint, settings: BrushSettings): BrushStamp {
  return {
    x: point.x,
    y: point.y,
    pressure: point.pressure,
    tilt_x: point.tilt_x,
    tilt_y: point.tilt_y,
    diameter: effectiveDiameter(settings, point.pressure),
  };
}

/** E1 helper: the exact stamps of one gesture. */
export function resampleStroke(samples: readonly BrushSample[], settings: BrushSettings): BrushStamp[] {
  validateBrushSettings(settings);
  validateBrushSamples(samples);
  if (settings.flow <= 0) return [];
  const points = simplify(
    samples.map((sample) => ({
      x: sample.x,
      y: sample.y,
      pressure: sample.pressure,
      tilt_x: sample.tilt_x,
      tilt_y: sample.tilt_y,
    })),
  );
  if (points.length === 1) return [stamp(points[0], settings)];

  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    cumulative.push(cumulative[cumulative.length - 1] + length);
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return [stamp(points[0], settings)];

  const stamps: BrushStamp[] = [];
  let distance = 0;
  while (distance < total) {
    const point = pressureAt(points, cumulative, distance);
    const next = stamp(point, settings);
    const previous = stamps[stamps.length - 1];
    if (
      !previous ||
      Math.hypot(previous.x - next.x, previous.y - next.y) > 1e-9 ||
      previous.diameter !== next.diameter
    ) {
      stamps.push(next);
      if (stamps.length > MAX_STAMPS) fail("image_edit.too_large");
    }
    const interval = Math.max(0.01, settings.spacing * next.diameter);
    distance += interval;
  }
  const last = stamp(points[points.length - 1], settings);
  const previous = stamps[stamps.length - 1];
  if (!previous || Math.hypot(previous.x - last.x, previous.y - last.y) > 1e-6) {
    stamps.push(last);
  } else {
    stamps[stamps.length - 1] = last;
  }
  return stamps;
}
