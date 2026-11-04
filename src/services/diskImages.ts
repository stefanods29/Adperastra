import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";

/** Disk-image service (Step 09j E1, `disk-mount-1`). The native mirror
 * is `src-tauri/src/disk_image_types.rs`. Mounting is read-only by
 * construction: a request that says otherwise never reaches Rust. */

export type DiskImageKind = "iso" | "vhd" | "vhdx";
export type MountState = "mounting" | "mounted" | "ejecting" | "in_use" | "error";

export interface MountRequest {
  path: string;
  expected?: SourceStamp;
  /** Must be true; the app never offers a writable mount. */
  readonly: true;
  /** True only after the user confirmed the one-operation elevation. */
  allow_elevation?: boolean;
}

export interface MountedImage {
  mount_id: string;
  source: SourceStamp;
  kind: DiskImageKind;
  volume_roots: string[];
  physical_path: string;
  readonly: true;
  owned: boolean;
  state: MountState;
  brokered: boolean;
}

export interface MountResult {
  mount: MountedImage | null;
  requires_elevation: boolean;
  error_code?: string;
}

export const MAX_MOUNTED_VOLUMES = 16;
export const MAX_IMAGE_PATH_UNITS = 32_768;

const KINDS: readonly DiskImageKind[] = ["iso", "vhd", "vhdx"];
const STATES: readonly MountState[] = ["mounting", "mounted", "ejecting", "in_use", "error"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;

function shape(value: unknown, keys: readonly string[]): Obj | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Obj;
  return Object.keys(object).every((key) => keys.includes(key)) ? object : null;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isAbsoluteImagePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IMAGE_PATH_UNITS) {
    return false;
  }
  if (value.includes("\0") || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  if (!/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith("\\\\")) return false;
  return !value.split(/[\\/]/).some((part) => part === "..");
}

function hexOf(value: unknown, width: number): value is string {
  return typeof value === "string" && value.length === width && /^[0-9a-f]+$/i.test(value);
}

export function isSourceStamp(value: unknown): value is SourceStamp {
  const object = shape(value, ["path_key", "volume_id", "file_id", "modified_ticks", "size_bytes"]);
  return (
    object !== null &&
    typeof object.path_key === "string" &&
    object.path_key.length <= MAX_IMAGE_PATH_UNITS &&
    hexOf(object.volume_id, 8) &&
    hexOf(object.file_id, 16) &&
    typeof object.modified_ticks === "string" &&
    /^\d+$/.test(object.modified_ticks) &&
    isSafeInt(object.size_bytes)
  );
}

export function isVolumeRoot(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z]:\\$/.test(value);
}

/** The extension only chooses the button/icon. Rust probes the bytes and
 * is authoritative, especially for `.img`, which is not a family. */
export function diskImageKindFromName(name: string): DiskImageKind | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return ext === "iso" || ext === "vhd" || ext === "vhdx" ? ext : null;
}

export function canMountDiskImage(name: string): boolean {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return ext === "iso" || ext === "vhd" || ext === "vhdx" || ext === "img";
}

export function validateMountRequest(request: MountRequest): MountRequest {
  if (!isAbsoluteImagePath(request.path)) throw new Error("disk.unsupported");
  if (request.readonly !== true) throw new Error("disk.denied");
  if (request.expected !== undefined && !isSourceStamp(request.expected)) {
    throw new Error("disk.changed");
  }
  if (request.allow_elevation !== undefined && typeof request.allow_elevation !== "boolean") {
    throw new Error("disk.denied");
  }
  return {
    path: request.path,
    ...(request.expected ? { expected: request.expected } : {}),
    readonly: true,
    allow_elevation: request.allow_elevation === true,
  };
}

export function validateMountedImage(value: unknown): MountedImage | null {
  const object = shape(value, [
    "mount_id",
    "source",
    "kind",
    "volume_roots",
    "physical_path",
    "readonly",
    "owned",
    "state",
    "brokered",
  ]);
  if (!object) return null;
  if (typeof object.mount_id !== "string" || !UUID_RE.test(object.mount_id)) return null;
  if (!isSourceStamp(object.source)) return null;
  if (!KINDS.includes(object.kind as DiskImageKind)) return null;
  if (!Array.isArray(object.volume_roots) || object.volume_roots.length > MAX_MOUNTED_VOLUMES) {
    return null;
  }
  if (!object.volume_roots.every(isVolumeRoot)) return null;
  if (
    typeof object.physical_path !== "string" ||
    object.physical_path.length === 0 ||
    object.physical_path.length > MAX_IMAGE_PATH_UNITS
  ) {
    return null;
  }
  if (object.readonly !== true || typeof object.owned !== "boolean") return null;
  if (!STATES.includes(object.state as MountState)) return null;
  if (typeof object.brokered !== "boolean") return null;
  return {
    mount_id: object.mount_id,
    source: object.source,
    kind: object.kind as DiskImageKind,
    volume_roots: object.volume_roots as string[],
    physical_path: object.physical_path,
    readonly: true,
    owned: object.owned,
    state: object.state as MountState,
    brokered: object.brokered,
  };
}

export function validateMountResult(value: unknown): MountResult {
  const object = shape(value, ["mount", "requires_elevation", "error_code"]);
  if (!object || typeof object.requires_elevation !== "boolean") {
    throw new Error("disk.unavailable");
  }
  const mount = object.mount === null || object.mount === undefined
    ? null
    : validateMountedImage(object.mount);
  if (object.mount !== null && object.mount !== undefined && !mount) {
    throw new Error("disk.unavailable");
  }
  if (
    object.error_code !== undefined &&
    (typeof object.error_code !== "string" || object.error_code.length > 64)
  ) {
    throw new Error("disk.unavailable");
  }
  return {
    mount,
    requires_elevation: object.requires_elevation,
    ...(object.error_code ? { error_code: object.error_code } : {}),
  };
}

/** Start a read-only mount job. A failed request resolves with
 * `mount: null` and `error_code`; only an internal failure rejects. */
export async function mountDiskImage(
  request: MountRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<MountResult>> {
  const normalized = validateMountRequest(request);
  return runJob<MountResult>(
    "diskmount",
    async (requestId) => {
      await invoke("disk_mount_start", { requestId, request: normalized });
    },
    onProgress,
  ).then((handle) => ({
    ...handle,
    completion: handle.completion.then((result) => validateMountResult(result)),
  }));
}

export async function ejectDiskImage(
  mountId: string,
): Promise<JobHandle<{ ejected: boolean }>> {
  if (!UUID_RE.test(mountId)) throw new Error("disk.denied");
  return runJob<{ ejected: boolean }>("diskeject", async (requestId) => {
    await invoke("disk_eject_start", { requestId, mountId });
  }).then((handle) => ({
    ...handle,
    completion: handle.completion.then((result) => {
      const object = shape(result, ["ejected"]);
      if (!object || object.ejected !== true) throw new Error("disk.unavailable");
      return { ejected: true };
    }),
  }));
}

export async function listMountedImages(): Promise<MountedImage[]> {
  const value = await invoke("disk_mounts");
  if (!Array.isArray(value) || value.length > 32) throw new Error("disk.unavailable");
  const images = value.map(validateMountedImage);
  if (images.some((image) => image === null)) throw new Error("disk.unavailable");
  return images as MountedImage[];
}
