import { invoke } from "@tauri-apps/api/core";
import { fail, isFiniteNumber, MAX_IMAGE_PIXELS, type BlendMode, type Rect } from "./types";
import type { ImageProjectInfo } from "./projectTypes";
import { projectErrorCode } from "./projectTypes";
import { runJob, type JobHandle } from "../services/jobs";
import { isBlendMode } from "./layerTypes";

/** PSD import (Step 18b D8/T6).
 *
 * A PSD is parsed only by the 07g isolated PSD helper. The scan lists every
 * feature that cannot stay editable before any copy is created. The source
 * file is read once and never written; its SHA-256 binds the import to the
 * exact reviewed bytes. Import never promises editable PSD round-tripping and
 * never offers PSD Save. */

export type PsdUnsupportedCode =
  | "smart_object"
  | "layer_effect"
  | "text"
  | "adjustment"
  | "group"
  | "linked_file"
  | "unknown";

export const PSD_UNSUPPORTED_CODES: readonly PsdUnsupportedCode[] = [
  "smart_object",
  "layer_effect",
  "text",
  "adjustment",
  "group",
  "linked_file",
  "unknown",
];

/** Translation key for each stable code; the coordinator adds these keys. */
export function psdUnsupportedKey(code: PsdUnsupportedCode): string {
  return `psd.unsupported.${code}`;
}

export interface PsdImportLayer {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  bounds: Rect;
  has_mask: boolean;
  /** True only for a layer the helper proved as bounded raster pixels. */
  raster: boolean;
}

export interface PsdImportPlan {
  source_path: string;
  source_sha256: string;
  source_bytes: number;
  width: number;
  height: number;
  layers: PsdImportLayer[];
  unsupported: PsdUnsupportedCode[];
  composite_available: boolean;
  editable_layer_count: number;
}

export interface PsdImportDependencies {
  scan: (path: string) => Promise<PsdImportPlan>;
  startImport: (
    path: string,
    expectedSha256: string,
    acceptFlattened: boolean,
  ) => Promise<JobHandle<ImageProjectInfo>>;
}

const MAX_PSD_SOURCE_BYTES = 256 * 1024 * 1024;

function validatePath(path: string): void {
  if (typeof path !== "string" || path.length === 0 || path.length > 32768 || path.includes("\0")) {
    fail("image_project.bad_request");
  }
  if (!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("\\\\")) fail("image_project.bad_request");
  if (path.split(/[\\/]/).some((part) => part === "..")) fail("image_project.bad_request");
}

function validatePlan(plan: PsdImportPlan): void {
  if (!plan || typeof plan !== "object") fail("image_project.corrupt");
  validatePath(plan.source_path);
  if (!/^[0-9a-f]{64}$/.test(plan.source_sha256)) fail("image_project.corrupt");
  if (!Number.isSafeInteger(plan.source_bytes) || plan.source_bytes < 1 || plan.source_bytes > MAX_PSD_SOURCE_BYTES) {
    fail("image_project.too_large");
  }
  if (!Number.isInteger(plan.width) || !Number.isInteger(plan.height) || plan.width < 1 || plan.height < 1) {
    fail("image_project.corrupt");
  }
  if (plan.width * plan.height > MAX_IMAGE_PIXELS) fail("image_project.too_large");
  if (!Array.isArray(plan.layers) || plan.layers.length > 1000) fail("image_project.too_large");
  if (!Array.isArray(plan.unsupported) || plan.unsupported.length > 64) fail("image_project.corrupt");
  for (const code of plan.unsupported) {
    if (!PSD_UNSUPPORTED_CODES.includes(code)) fail("image_project.corrupt");
  }
  for (const layer of plan.layers) {
    if (!layer || !Number.isInteger(layer.id) || layer.id < 0) fail("image_project.corrupt");
    if (typeof layer.name !== "string" || Array.from(layer.name).length > 512) fail("image_project.corrupt");
    if (typeof layer.visible !== "boolean" || typeof layer.has_mask !== "boolean" || typeof layer.raster !== "boolean") {
      fail("image_project.corrupt");
    }
    if (!isBlendMode(layer.blend)) fail("image_project.corrupt");
    if (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) fail("image_project.corrupt");
    if (
      !layer.bounds ||
      ![layer.bounds.x, layer.bounds.y, layer.bounds.width, layer.bounds.height].every(isFiniteNumber) ||
      layer.bounds.width < 1 ||
      layer.bounds.height < 1
    ) {
      fail("image_project.corrupt");
    }
  }
  if (!Number.isInteger(plan.editable_layer_count) || plan.editable_layer_count < 0 || plan.editable_layer_count > plan.layers.length) {
    fail("image_project.corrupt");
  }
  if (typeof plan.composite_available !== "boolean") fail("image_project.corrupt");
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
  return normalize(left) === normalize(right);
}

const defaultDependencies: PsdImportDependencies = {
  scan: async (path) => {
    validatePath(path);
    const job = await runJob<PsdImportPlan>("psdscan", (requestId) =>
      invoke("image_project_psd_scan_start", { requestId, path }),
    );
    return job.completion;
  },
  startImport: async (path, expectedSha256, acceptFlattened) => {
    validatePath(path);
    return runJob<ImageProjectInfo>("psdimp", (requestId) =>
      invoke("image_project_psd_import_start", {
        requestId,
        path,
        expectedSha256,
        acceptFlattened,
      }),
    );
  },
};

/** Reads the PSD header/layers in the isolated helper and lists unsupported
 * features. It never copies or writes the source. */
export async function scanPsdForImport(
  path: string,
  dependencies: PsdImportDependencies = defaultDependencies,
): Promise<PsdImportPlan> {
  validatePath(path);
  let plan: PsdImportPlan;
  try {
    plan = await dependencies.scan(path);
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  validatePlan(plan);
  if (!samePath(plan.source_path, path)) fail("image_project.changed");
  return plan;
}

/** Starts the reviewed import. With unsupported features, the caller must
 * pass `accepted: true` after showing `imageProject.psdWarning`; the import
 * then creates a flattened copy. Without it, only proved raster layers are
 * imported and PSD Save is never offered. */
export async function importPsdCopy(
  plan: PsdImportPlan,
  accepted: boolean,
  dependencies: PsdImportDependencies = defaultDependencies,
): Promise<JobHandle<ImageProjectInfo>> {
  validatePlan(plan);
  const needsCopy = plan.unsupported.length > 0;
  if (needsCopy && accepted !== true) {
    // The warning and feature list must be shown before a copy is created.
    fail("image_project.unknown_required");
  }
  if (!plan.composite_available && plan.editable_layer_count === 0) {
    fail("image_project.unsupported_schema");
  }
  try {
    return await dependencies.startImport(
      plan.source_path,
      plan.source_sha256,
      needsCopy && accepted,
    );
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
}
