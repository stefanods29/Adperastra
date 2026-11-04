/** Bounded camera and measurement math (Step 07g D4). */
import type { ModelViewState, SceneUnit } from "../../services/specialViews";

export type Vec3 = [number, number, number];
export type Bounds = [number, number, number, number, number, number];

export const MIN_PITCH = -Math.PI / 2 + 0.01;
export const MAX_PITCH = Math.PI / 2 - 0.01;

export function boundsCenter(bounds: Bounds): Vec3 {
  return [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2];
}

export function boundsSize(bounds: Bounds): Vec3 {
  return [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]];
}

/** Euclidean distance in source units. */
export function measureDistance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** A finite, positive camera distance that shows the whole box. */
export function fitDistance(bounds: Bounds, fovDegrees: number, aspect: number): number {
  if (bounds.some((value) => !Number.isFinite(value)) || bounds[0] > bounds[3] || bounds[1] > bounds[4] || bounds[2] > bounds[5]) {
    throw new Error("special_view.corrupt");
  }
  const size = boundsSize(bounds);
  const radius = Math.max(Math.hypot(size[0], size[1], size[2]) / 2, 1e-6);
  const fov = (Math.min(Math.max(fovDegrees, 10), 120) * Math.PI) / 180;
  const vertical = radius / Math.max(Math.sin(fov / 2), 1e-6);
  const horizontal = aspect > 0 ? vertical / Math.max(aspect, 1e-6) : vertical;
  return Math.max(vertical, horizontal) * 1.15;
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch));
}

export function orbitPosition(view: Pick<ModelViewState, "yaw" | "pitch" | "distance" | "target">): Vec3 {
  const pitch = clampPitch(view.pitch);
  return [
    view.target[0] + view.distance * Math.cos(pitch) * Math.sin(view.yaw),
    view.target[1] + view.distance * Math.sin(pitch),
    view.target[2] + view.distance * Math.cos(pitch) * Math.cos(view.yaw),
  ];
}

export function defaultView(bounds: Bounds, unit: SceneUnit, aspect: number): ModelViewState {
  return {
    yaw: Math.PI / 4,
    pitch: Math.PI / 6,
    distance: fitDistance(bounds, 45, aspect),
    target: boundsCenter(bounds),
    wireframe: false,
    unit,
  };
}

export function validateView(view: ModelViewState): ModelViewState {
  const target: Vec3 = [
    Number.isFinite(view.target?.[0]) ? view.target[0] : 0,
    Number.isFinite(view.target?.[1]) ? view.target[1] : 0,
    Number.isFinite(view.target?.[2]) ? view.target[2] : 0,
  ];
  const distance = Number.isFinite(view.distance) && view.distance > 0 && view.distance <= 1e9 ? view.distance : 1;
  return {
    yaw: Number.isFinite(view.yaw) ? view.yaw : 0,
    pitch: clampPitch(Number.isFinite(view.pitch) ? view.pitch : 0),
    distance,
    target,
    wireframe: view.wireframe === true,
    unit: view.unit === "mm" || view.unit === "cm" || view.unit === "m" ? view.unit : "none",
  };
}

/** Measurement text is formatted by the locale service; this function only
 * supplies the number and its unit key. */
export function distanceParts(distance: number, unit: SceneUnit): { value: number; unit: SceneUnit } {
  if (!Number.isFinite(distance) || distance < 0) throw new Error("special_view.bad_request");
  return { value: distance, unit };
}
