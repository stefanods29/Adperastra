import type { MetadataCategory } from "../convert/types";
import { validateImageAdjustment } from "./adjustmentWorker";
import { MAX_GUIDES, validateDpi, validateGuides, type Guide } from "./guides";
import { MAX_LAYERS, isBlendMode, validateLayerName, validateMask } from "./layerTypes";
import {
  assertPixels,
  fail,
  isFiniteNumber,
  isUuid,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  MAX_METADATA_ENTRIES,
  MAX_OVERLAYS,
  MAX_TEXT_SCALARS,
  validateAdjustments,
  validateAffine,
  validateGeometry,
  validateOverlay,
  validateRect,
  type ImageAdjustments,
  type ImageGeometry,
  type ImageLayer,
  type ImageMask,
  type ImageModel,
  type ImageOverlay,
} from "./types";

/** Editable image-project manifest (Step 18b, `image-project-1`).
 *
 * The native mirror and validator live in
 * `crates/image-edit/src/project.rs`. Layers and masks are the canonical 14b
 * types; this file adds only project-owned descriptors. A manifest never
 * contains a DocumentHandle, an ExportSnapshot, a token or a source path. */

export const PROJECT_EXTENSION = "adimage";
export const PROJECT_MIME = "application/vnd.adperastra.image-project+zip";
export const PROJECT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_PROJECT_DECODED_TILE_BYTES = 512 * 1024 * 1024;
export const MAX_PROJECT_ENTRIES = 100_000;
export const MAX_PROJECT_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_EXTENSIONS = 64;
export const MAX_PROJECT_EXTENSION_BYTES = 1 * 1024 * 1024;
export const MAX_PROJECT_EXTENSIONS_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_METADATA_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_METADATA_ENTRIES = MAX_METADATA_ENTRIES;
export const MAX_PROJECT_TILE_BYTES = 2 * 256 * 1024 + 64 * 1024;
/** Every decoded payload one project may deliver through the bounded native
 * channel: tile bytes plus the total metadata and extension budgets. */
export const MAX_PROJECT_PAYLOAD_BYTES =
  MAX_PROJECT_DECODED_TILE_BYTES + MAX_PROJECT_METADATA_BYTES + MAX_PROJECT_EXTENSIONS_BYTES;
/** Largest raw page the native channel returns in one IPC reply. */
export const MAX_PROJECT_PAYLOAD_PAGE_BYTES = 1024 * 1024;

/** Channel identity of one decoded payload. `name` is a tile UUID, a metadata
 * category or an extension name, never a filesystem path. */
export type ProjectPayloadKind = "rgba" | "alpha" | "metadata" | "extension";

export interface ProjectPayloadEntry {
  kind: ProjectPayloadKind;
  name: string;
  byte_len: number;
}

export type ProjectTileKind = "rgba" | "alpha";

export interface ProjectTile {
  id: string;
  /** Strict relative entry name; validated against the allowlist. */
  path: string;
  kind: ProjectTileKind;
  width: number;
  height: number;
  /** width * height * 4 for RGBA, width * height for alpha. */
  raw_bytes: number;
  compressed_bytes: number;
  sha256: string;
}

export interface ProjectMetadataEntry {
  category: MetadataCategory;
  path: string;
  byte_len: number;
  sha256: string;
}

export interface ProjectExtension {
  /** Namespaced, lower-case name such as `com.example.layerdata`. */
  name: string;
  required: boolean;
  path: string;
  sha256: string;
}

export interface ImageProjectManifest {
  schema_version: 1;
  project_id: string;
  width: number;
  height: number;
  dpi: number;
  layers: ImageLayer[];
  masks: ImageMask[];
  geometry: ImageGeometry;
  adjustments: ImageAdjustments;
  overlays: ImageOverlay[];
  tiles: ProjectTile[];
  original_tile_ids: string[];
  guides: Guide[];
  metadata_entries: ProjectMetadataEntry[];
  extensions: ProjectExtension[];
}

export interface ImageProjectInfo {
  project_id: string;
  width: number;
  height: number;
  layer_count: number;
  /** Stable codes (at most 128); empty when every feature is editable. */
  unsupported_features: string[];
  editable: boolean;
}

/** Additive native-open result: descriptors only, never payload bytes. */
export interface ImageProjectOpenResult extends ImageProjectInfo {
  extensions?: ProjectExtension[];
  metadata_entries?: ProjectMetadataEntry[];
}

export const PROJECT_METADATA_CATEGORIES: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "icc",
  "xmp",
  "iptc",
  "author",
  "comments",
  "attachments",
  "forms",
  "annotations",
  "scripts",
  "timestamps",
];

export const PROJECT_BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "add",
] as const;

export function isProjectExtensionName(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 128) return false;
  if (!/^[a-z]/.test(value)) return false;
  const parts = value.split(".");
  if (parts.length < 2) return false;
  return parts.every((part) => /^[a-z][a-z0-9-]*$/.test(part));
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function tilePath(id: string, kind: ProjectTileKind): string {
  return kind === "rgba" ? `tiles/${id.toLowerCase()}.rgba.zst` : `masks/${id.toLowerCase()}.alpha.zst`;
}

export function validateProjectTile(tile: ProjectTile): void {
  if (!tile || !isUuid(tile.id)) fail("image_project.bad_request");
  if (tile.kind !== "rgba" && tile.kind !== "alpha") fail("image_project.bad_request");
  if (!Number.isInteger(tile.width) || !Number.isInteger(tile.height)) fail("image_project.bad_request");
  if (tile.width < 1 || tile.height < 1 || tile.width > 256 || tile.height > 256) fail("image_project.bad_request");
  const raw = tile.kind === "rgba" ? tile.width * tile.height * 4 : tile.width * tile.height;
  if (tile.raw_bytes !== raw) fail("image_project.bad_request");
  if (!Number.isSafeInteger(tile.compressed_bytes) || tile.compressed_bytes < 1) fail("image_project.bad_request");
  if (tile.compressed_bytes > MAX_PROJECT_TILE_BYTES) fail("image_project.too_large");
  if (tile.path !== tilePath(tile.id, tile.kind)) fail("image_project.bad_request");
  if (!isSha256Hex(tile.sha256)) fail("image_project.bad_request");
}

export function validateMetadataEntry(entry: ProjectMetadataEntry): void {
  if (!entry || !PROJECT_METADATA_CATEGORIES.includes(entry.category)) fail("image_project.bad_request");
  if (entry.path !== `metadata/${entry.category}.bin`) fail("image_project.bad_request");
  if (!Number.isSafeInteger(entry.byte_len) || entry.byte_len < 1 || entry.byte_len > MAX_PROJECT_METADATA_BYTES) {
    fail("image_project.too_large");
  }
  if (!isSha256Hex(entry.sha256)) fail("image_project.bad_request");
}

export function validateExtension(extension: ProjectExtension): void {
  if (!extension || !isProjectExtensionName(extension.name)) fail("image_project.bad_request");
  if (typeof extension.required !== "boolean") fail("image_project.bad_request");
  if (extension.path !== `extensions/${extension.name}.bin`) fail("image_project.bad_request");
  if (!isSha256Hex(extension.sha256)) fail("image_project.bad_request");
}

/** A stored tile reference. Unlike 14b's `validateTileRef`, positions may be
 * zero: the first tile of every canvas is at (0, 0). */
function validateProjectTileRef(tile: { id: string; tile_x: number; tile_y: number; width: number; height: number; byte_len: number; generation: number }): void {
  if (!tile || !isUuid(tile.id)) fail("image_project.bad_request");
  if (!Number.isInteger(tile.tile_x) || !Number.isInteger(tile.tile_y) || tile.tile_x < 0 || tile.tile_y < 0) {
    fail("image_project.bad_request");
  }
  if (!Number.isInteger(tile.width) || !Number.isInteger(tile.height)) fail("image_project.bad_request");
  if (tile.width < 1 || tile.height < 1 || tile.width > 256 || tile.height > 256) fail("image_project.bad_request");
  if (tile.byte_len !== tile.width * tile.height * 4) fail("image_project.bad_request");
  if (!Number.isInteger(tile.generation) || tile.generation < 1) fail("image_project.bad_request");
}

function validateLayer(manifest: ImageProjectManifest, layer: ImageLayer): void {
  if (!layer || !isUuid(layer.id)) fail("image_project.bad_request");
  validateLayerName(layer.name);
  if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") fail("image_project.bad_request");
  if (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) fail("image_project.bad_request");
  if (!isBlendMode(layer.blend)) fail("image_project.bad_request");
  validateAffine(layer.transform, true);
  if (layer.mask_id !== null && !isUuid(layer.mask_id)) fail("image_project.bad_request");
  switch (layer.kind) {
    case "raster":
      if (!Array.isArray(layer.tiles)) fail("image_project.bad_request");
      layer.tiles.forEach(validateProjectTileRef);
      return;
    case "text":
      if (typeof layer.text !== "string" || Array.from(layer.text).length > MAX_TEXT_SCALARS) fail("image_project.bad_request");
      if (typeof layer.font_asset_id !== "string" || layer.font_asset_id.length < 1 || layer.font_asset_id.length > 128) {
        fail("image_project.bad_request");
      }
      if (!isFiniteNumber(layer.font_size) || layer.font_size < 1 || layer.font_size > 512) fail("image_project.bad_request");
      if (!Array.isArray(layer.color) || layer.color.length !== 4) fail("image_project.bad_request");
      for (const channel of layer.color) {
        if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("image_project.bad_request");
      }
      validateRect(layer.bounds);
      if (layer.align !== "left" && layer.align !== "center" && layer.align !== "right") fail("image_project.bad_request");
      return;
    case "shape":
      validateOverlay(layer.overlay, manifest.geometry.output_size);
      return;
    case "adjustment":
      if (!layer.adjustment || typeof layer.adjustment.kind !== "string") fail("image_project.bad_request");
      try {
        validateImageAdjustment(layer.adjustment);
      } catch {
        fail("image_project.bad_request");
      }
      return;
    default:
      fail("image_project.bad_request");
  }
}

/** Full project-owned validation. The 14b/18a model validators remain
 * authoritative for the live model; this checks what may cross the file. */
export function validateProjectManifest(manifest: ImageProjectManifest): void {
  if (!manifest || typeof manifest !== "object") fail("image_project.bad_request");
  if (manifest.schema_version !== PROJECT_SCHEMA_VERSION) fail("image_project.unsupported_schema");
  if (!isUuid(manifest.project_id)) fail("image_project.bad_request");
  assertPixels(manifest.width, manifest.height);
  if (manifest.width > MAX_IMAGE_EDGE || manifest.height > MAX_IMAGE_EDGE || manifest.width * manifest.height > MAX_IMAGE_PIXELS) {
    fail("image_project.too_large");
  }
  validateDpi(manifest.dpi);
  validateGeometry(manifest.geometry, { width: manifest.width, height: manifest.height });
  validateAdjustments(manifest.adjustments);
  if (!Array.isArray(manifest.layers) || manifest.layers.length < 1 || manifest.layers.length > MAX_LAYERS) {
    fail("image_project.bad_request");
  }
  const layerIds = new Set<string>();
  for (const layer of manifest.layers) {
    if (layerIds.has(layer.id)) fail("image_project.bad_request");
    layerIds.add(layer.id);
    validateLayer(manifest, layer);
  }
  if (!Array.isArray(manifest.masks) || manifest.masks.length > MAX_LAYERS) fail("image_project.bad_request");
  const maskIds = new Set<string>();
  for (const mask of manifest.masks) {
    if (maskIds.has(mask.id)) fail("image_project.bad_request");
    maskIds.add(mask.id);
    validateMask(mask, { width: manifest.width, height: manifest.height });
  }
  for (const layer of manifest.layers) {
    if (layer.mask_id !== null && !maskIds.has(layer.mask_id)) fail("image_project.bad_request");
  }
  if (!Array.isArray(manifest.overlays) || manifest.overlays.length > MAX_OVERLAYS) fail("image_project.bad_request");
  manifest.overlays.forEach((overlay) => validateOverlay(overlay, manifest.geometry.output_size));
  validateGuides(manifest.guides, manifest.width, manifest.height);
  if (!Array.isArray(manifest.tiles)) fail("image_project.bad_request");
  if (manifest.tiles.length > MAX_PROJECT_ENTRIES) fail("image_project.too_large");
  const tileIds = new Set<string>();
  let decodedBytes = 0;
  for (const tile of manifest.tiles) {
    if (tileIds.has(tile.id)) fail("image_project.bad_request");
    tileIds.add(tile.id);
    validateProjectTile(tile);
    decodedBytes += tile.raw_bytes;
    if (decodedBytes > MAX_PROJECT_DECODED_TILE_BYTES) fail("image_project.too_large");
  }
  const tileById = new Map(manifest.tiles.map((tile) => [tile.id, tile] as const));
  const referenced = new Set<string>();
  for (const layer of manifest.layers) {
    if (layer.kind !== "raster") continue;
    for (const tile of layer.tiles) {
      const descriptor = tileById.get(tile.id);
      if (
        !descriptor ||
        descriptor.kind !== "rgba" ||
        descriptor.width !== tile.width ||
        descriptor.height !== tile.height ||
        descriptor.raw_bytes !== tile.width * tile.height * 4
      ) {
        fail("image_project.bad_request");
      }
      referenced.add(tile.id);
    }
  }
  for (const mask of manifest.masks) {
    for (const tile of mask.tiles) {
      const descriptor = tileById.get(tile.id);
      if (
        !descriptor ||
        descriptor.kind !== "alpha" ||
        descriptor.width !== tile.width ||
        descriptor.height !== tile.height ||
        descriptor.raw_bytes !== tile.width * tile.height
      ) {
        fail("image_project.bad_request");
      }
      referenced.add(tile.id);
    }
  }
  if (!Array.isArray(manifest.original_tile_ids) || manifest.original_tile_ids.length < 1) {
    fail("image_project.bad_request");
  }
  const originals = new Set<string>();
  for (const id of manifest.original_tile_ids) {
    if (!isUuid(id) || originals.has(id)) fail("image_project.bad_request");
    originals.add(id);
    referenced.add(id);
    const tile = tileById.get(id);
    if (!tile || tile.kind !== "rgba") fail("image_project.bad_request");
  }
  if (referenced.size !== manifest.tiles.length) fail("image_project.bad_request");
  if (!Array.isArray(manifest.metadata_entries)) fail("image_project.bad_request");
  if (manifest.metadata_entries.length > MAX_PROJECT_METADATA_ENTRIES) fail("image_project.too_large");
  const metadataPaths = new Set<string>();
  let metadataBytes = 0;
  for (const entry of manifest.metadata_entries) {
    if (metadataPaths.has(entry.path)) fail("image_project.bad_request");
    metadataPaths.add(entry.path);
    validateMetadataEntry(entry);
    metadataBytes += entry.byte_len;
    if (metadataBytes > MAX_PROJECT_METADATA_BYTES) fail("image_project.too_large");
  }
  if (!Array.isArray(manifest.extensions) || manifest.extensions.length > MAX_PROJECT_EXTENSIONS) {
    fail("image_project.bad_request");
  }
  const extensionNames = new Set<string>();
  for (const extension of manifest.extensions) {
    if (extensionNames.has(extension.name)) fail("image_project.bad_request");
    extensionNames.add(extension.name);
    validateExtension(extension);
  }
  if (manifest.guides.length > MAX_GUIDES) fail("image_project.too_large");
}

/** Stable error code for the UI; every code still maps to the translated
 * `errors.image_project.failed` text. */
export function projectErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (code.startsWith("image_project.")) return code;
  if (code === "snapshot.too_large" || code === "image_edit.too_large" || code === "image_layers.too_large") {
    return "image_project.too_large";
  }
  if (code === "snapshot.changed" || code === "image_edit.changed" || code === "image_layers.changed") {
    return "image_project.changed";
  }
  return "image_project.failed";
}

/** True when every project entry name is in the guarded allowlist. Used by
 * the TS writer and by tests; the native mirror enforces the same list. */
export function isProjectEntryPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 256) return false;
  if (path === "document.json") return true;
  if (/^tiles\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.rgba\.zst$/.test(path)) return true;
  if (/^masks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.alpha\.zst$/.test(path)) return true;
  if (/^metadata\/[a-z]+\.bin$/.test(path)) {
    const category = path.slice("metadata/".length, -".bin".length);
    return (PROJECT_METADATA_CATEGORIES as readonly string[]).includes(category);
  }
  if (path.startsWith("extensions/") && path.endsWith(".bin")) {
    return isProjectExtensionName(path.slice("extensions/".length, -".bin".length));
  }
  return false;
}

/** The project identity of a live model: the document id is stable across
 * saves and reopens, so Compare and re-open bind to the same project. */
export function projectIdOf(model: Readonly<ImageModel>): string {
  if (!isUuid(model.document_id)) fail("image_project.bad_request");
  return model.document_id;
}
