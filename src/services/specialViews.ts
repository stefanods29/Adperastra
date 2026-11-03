import { invoke } from "@tauri-apps/api/core";
import type { CacheLease, SourceStamp } from "./cache";
import { runJob, type JobHandle } from "./jobs";

/** Special viewers (Step 07g): 3D models, camera RAW, Windows codec images
 * and Photoshop files. The native types live in
 * `src-tauri/src/special_view_types.rs`; fields keep their snake_case names.
 *
 * No risky format parser runs in this module. Models are parsed in the
 * isolated model helper, PSD files in the PSD helper, and RAW/HEIC pixels
 * through the native image helper. Here we only validate bounded DTOs. */

export type SpecialKind = "model" | "raw" | "codec_image" | "psd";
export type SceneUnit = "none" | "mm" | "cm" | "m";

export interface SpecialSession {
  session_id: string;
  source: SourceStamp;
  kind: SpecialKind;
  preview: CacheLease | null;
  width: number | null;
  height: number | null;
  codec_required: boolean;
  partial: boolean;
}

export interface SceneInfo {
  session_id: string;
  geometry: CacheLease;
  object_count: number;
  vertex_count: number;
  triangle_count: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ], source units. */
  bounds: [number, number, number, number, number, number];
  unit: SceneUnit;
  textures: CacheLease[];
  partial: boolean;
}

export interface SceneMaterial {
  id: number;
  rgba: [number, number, number, number];
  metallic: number;
  roughness: number;
  texture_index: number | null;
  double_sided: boolean;
}

export interface SceneNode {
  id: number;
  parent: number | null;
  primitive_id: number | null;
  /** Column-major local affine matrix. */
  matrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  name: string;
}

export interface ScenePrimitive {
  id: number;
  first_vertex: number;
  vertex_count: number;
  first_index: number;
  index_count: number;
  material_id: number;
}

/** Decoded and structurally checked SafeScene1 bytes (E6). */
export interface SafeSceneData {
  positions: Float32Array;
  normals?: Float32Array;
  uv?: Float32Array;
  indices: Uint32Array;
  materials: SceneMaterial[];
  primitives: ScenePrimitive[];
  nodes: SceneNode[];
}

export interface PsdLayerInfo {
  id: number;
  parent: number | null;
  name: string;
  visible: boolean;
  opacity: number;
  children_count: number;
}

export interface PsdInfo {
  session: SpecialSession;
  layers: PsdLayerInfo[];
  next_cursor: string | null;
  complete: boolean;
}

export interface ModelViewState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  wireframe: boolean;
  unit: SceneUnit;
}

export interface SpecialImageState {
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  layers_open: boolean;
  full_resolution: boolean;
}

/** Bounds fixed by D3/D7. `special_view_types.rs` holds the same numbers. */
export const SPECIAL_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const SPECIAL_MAX_VERTICES = 2_000_000;
export const SPECIAL_MAX_TRIANGLES = 4_000_000;
export const SPECIAL_MAX_OBJECTS = 10_000;
export const SPECIAL_MAX_DEPTH = 64;
export const SPECIAL_MAX_TEXTURES = 32;
export const SPECIAL_MAX_TEXTURE_PIXELS = 16_000_000;
export const SPECIAL_MAX_TEXTURE_BYTES = 128 * 1024 * 1024;
export const SPECIAL_MAX_EDGE = 16_384;
export const PSD_MAX_PIXELS = 100_000_000;
export const PSD_MAX_LAYERS = 1_000;
export const PSD_LAYER_PAGE = 256;

export const MODEL_EXTENSIONS = ["stl", "obj", "gltf", "glb", "3mf"] as const;
export const RAW_EXTENSIONS = ["cr2", "cr3", "nef", "arw", "dng", "raf", "orf", "rw2"] as const;
export const CODEC_IMAGE_EXTENSIONS = ["heic", "heif"] as const;
export const PSD_EXTENSIONS = ["psd"] as const;

/** Exact wire values; unknown values are a bad request, never guessed. */
export function parseSpecialKind(value: unknown): SpecialKind {
  if (value === "model" || value === "raw" || value === "codec_image" || value === "psd") return value;
  throw new Error("special_view.bad_request");
}

export function specialKindForExtension(ext: string): SpecialKind | null {
  const lower = ext.toLowerCase();
  if ((MODEL_EXTENSIONS as readonly string[]).includes(lower)) return "model";
  if ((RAW_EXTENSIONS as readonly string[]).includes(lower)) return "raw";
  if ((CODEC_IMAGE_EXTENSIONS as readonly string[]).includes(lower)) return "codec_image";
  if ((PSD_EXTENSIONS as readonly string[]).includes(lower)) return "psd";
  return null;
}

/** Refuse an oversized source before any parser is created. The parser is a
 * callback so callers cannot accidentally run it first. */
export function guardSpecialSource<T>(sizeBytes: number, parse: () => T): T {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > SPECIAL_MAX_SOURCE_BYTES) {
    throw new Error("special_view.too_large");
  }
  return parse();
}

/** Six finite numbers with min <= max. */
export function validateSceneBounds(value: unknown): [number, number, number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 6 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("special_view.corrupt");
  }
  const bounds = value as [number, number, number, number, number, number];
  if (bounds[0] > bounds[3] || bounds[1] > bounds[4] || bounds[2] > bounds[5]) {
    throw new Error("special_view.corrupt");
  }
  return bounds;
}

function normalizedSegments(value: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const slashed = decoded.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) return null;
  const segments = slashed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments;
}

function hasScheme(value: string): boolean {
  // `C:\folder` is a path, not a URL scheme.
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function withinParent(parent: string, candidate: string): boolean {
  const root = parent.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const full = candidate.replace(/\\/g, "/").toLowerCase();
  return full.startsWith(`${root}/`);
}

/** A model resource may only be a relative file the selected model itself
 * names, inside the model's parent folder (D2). Returns the normalized
 * relative key used to look up an application-issued grant, or null.
 *
 * Absolute paths, drive letters, UNC paths, URL schemes, `..`, `.` and
 * percent-encoded traversal are refused. The referrer itself must be inside
 * `parentDir`; a grant for another folder can never be reached from here. */
export function resolveModelResource(referrer: string, requested: string, parentDir: string): string | null {
  if (referrer === "" || parentDir === "" || hasScheme(referrer) || hasScheme(parentDir)) return null;
  if (!withinParent(parentDir, referrer)) return null;
  if (requested === "" || requested.length > 1024 || hasScheme(requested)) return null;
  const segments = normalizedSegments(requested);
  if (!segments) return null;
  const relative = segments.join("/");
  const full = `${parentDir.replace(/\\/g, "/").replace(/\/+$/, "")}/${relative}`;
  return withinParent(parentDir, full) ? relative : null;
}

/** A SafeScene texture count is bounded before any Three.js texture exists. */
export function validateTextureCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > SPECIAL_MAX_TEXTURES) {
    throw new Error("special_view.too_large");
  }
}

/** Model view state read from a tab; absent state means "fit bounds". */
export function readModelViewState(state: unknown): ModelViewState | null {
  if (state === null || typeof state !== "object") return null;
  const value = state as Partial<ModelViewState>;
  if (
    typeof value.yaw !== "number" ||
    typeof value.pitch !== "number" ||
    typeof value.distance !== "number" ||
    !Number.isFinite(value.yaw) ||
    !Number.isFinite(value.pitch) ||
    !Number.isFinite(value.distance) ||
    value.distance <= 0 ||
    value.distance > 1e9 ||
    !Array.isArray(value.target) ||
    value.target.length !== 3 ||
    value.target.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    return null;
  }
  const unit: SceneUnit = value.unit === "mm" || value.unit === "cm" || value.unit === "m" ? value.unit : "none";
  return {
    yaw: value.yaw,
    pitch: value.pitch,
    distance: value.distance,
    target: value.target as [number, number, number],
    wireframe: value.wireframe === true,
    unit,
  };
}

/** Image view state read from a tab. Full resolution never restores true:
 * a background decode must be requested explicitly again (D5). */
export function readSpecialImageState(state: unknown): SpecialImageState {
  const value = (state ?? {}) as Partial<SpecialImageState>;
  const zoom = typeof value.zoom === "number" && value.zoom >= 10 && value.zoom <= 400 ? Math.round(value.zoom) : 100;
  const rotation = value.rotation === 90 || value.rotation === 180 || value.rotation === 270 ? value.rotation : 0;
  return {
    zoom,
    rotation,
    layers_open: value.layers_open !== false,
    full_resolution: false,
  };
}

/** E1: open a special file in a job. */
export async function openSpecialView(path: string, kind: SpecialKind): Promise<JobHandle<SpecialSession>> {
  return runJob("specopen", (requestId) => invoke("special_view_open_start", { requestId, path, kind }));
}

/** E2: the validated scene a model session owns. */
export async function modelScene(sessionId: string): Promise<SceneInfo> {
  return (await invoke("special_view_scene", { sessionId })) as SceneInfo;
}

/** E3: decode the full RAW frame only after an explicit user request. */
export async function fullRawPreview(sessionId: string, edge: number): Promise<JobHandle<SpecialSession>> {
  return runJob("specraw", (requestId) => invoke("special_view_raw_start", { requestId, sessionId, edge }));
}

/** E4: one source-bound page of PSD layer names. */
export async function psdLayers(sessionId: string, cursor?: string | null): Promise<PsdInfo> {
  return (await invoke("special_view_layers", { sessionId, cursor: cursor ?? null })) as PsdInfo;
}

/** E5: close a session; cancels helpers, revokes grants and releases leases. */
export async function closeSpecialView(sessionId: string): Promise<void> {
  await invoke("special_view_close", { sessionId });
}
