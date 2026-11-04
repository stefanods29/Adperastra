import { invoke } from "@tauri-apps/api/core";
import { readFileIdentity, type FileIdentityKey } from "./fileIdentity";
import { displayPath } from "./explorer";
import { folderViewKey } from "./folderViews";
import type { ColumnSpec } from "./folderPresentation";
import { validColumns } from "./folderPresentation";
import type { ThemeColor } from "./customThemes";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

export interface FolderIcon { kind: "default" | "lucide" | "emoji" | "image"; value?: string }
export interface FolderBackground {
  kind: "none" | "solid" | "gradient" | "image";
  color?: ThemeColor;
  second_color?: ThemeColor;
  angle_degrees: number;
  asset_id?: string;
  fit: "fit" | "fill" | "tile";
  opacity: number;
  blur_px: number;
  inherit: boolean;
}
export interface FolderCustomization {
  key: FileIdentityKey;
  display_path: string;
  color: string | null;
  icon: FolderIcon;
  background: FolderBackground;
  column_set_id?: string;
  scope: "exact" | "subtree";
  modified_unix: number;
}
export interface ColumnSet {
  id: string;
  name: string;
  columns: ColumnSpec[];
  folder_type?: "general" | "photos" | "music" | "documents";
  version: 1;
}
export interface FolderDecoration {
  color?: string;
  icon: FolderIcon;
  background?: FolderBackground;
  column_set?: ColumnSet;
  inherited_from?: string;
  warning_codes: string[];
}
export interface FolderCustomizationPage { records: FolderCustomization[]; next_cursor?: string; complete: boolean }
export interface FolderCustomizeRequest {
  paths: string[];
  patch: Partial<Pick<FolderCustomization, "color" | "icon" | "background" | "column_set_id" | "scope">>;
  expected_keys: FileIdentityKey[];
  apply_windows: boolean;
  accepted_windows_change: boolean;
}
export interface FolderCustomizeResult {
  changed_count: number;
  windows_applied_count: number;
  failures: { path: string; code: string }[];
  next_cursor?: string;
  history_id: string;
  complete: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const ICONS = ["folder", "folderOpen", "folderHeart", "folderStar", "folderLock"];
function object(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every((key) => keys.includes(key));
}
function optional(value: unknown, check: (value: unknown) => boolean): boolean { return value === undefined || check(value); }
function id(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function color(value: unknown): value is string { return typeof value === "string" && COLOR.test(value); }
function backgroundColor(value: unknown): value is string { return typeof value === "string" && /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value); }
function path(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 32768 && !value.includes("\0") &&
    !value.split(/[\\/]/).includes("..") && /^(?:[a-zA-Z]:\\|\\\\[^\\]+\\[^\\]+)/.test(value) &&
    !value.startsWith("\\\\.\\");
}
function identity(value: unknown): value is FileIdentityKey {
  if (!object(value, ["volume_id", "file_id", "path_key", "stable"])) return false;
  return typeof value.volume_id === "string" && /^[0-9a-f]{8}$/.test(value.volume_id) &&
    typeof value.file_id === "string" && /^[0-9a-f]{16}$/.test(value.file_id) &&
    typeof value.path_key === "string" && value.path_key.length > 0 && value.path_key.length <= 32768 && !value.path_key.includes("\0") &&
    typeof value.stable === "boolean" && (!value.stable || (value.volume_id !== "00000000" && value.file_id !== "0000000000000000"));
}
export function validFolderIcon(value: unknown): value is FolderIcon {
  if (!object(value, ["kind", "value"])) return false;
  if (value.kind === "default") return value.value === undefined;
  if (typeof value.value !== "string") return false;
  if (value.kind === "lucide") return ICONS.includes(value.value);
  if (value.kind === "image") return id(value.value);
  if (value.kind !== "emoji" || !value.value || [...value.value].length > 16) return false;
  // Fail closed on older runtimes; do not approximate grapheme boundaries.
  if (typeof Intl.Segmenter !== "function") return false;
  return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value.value)].length === 1 &&
    !/[\u0000-\u001f\u007f]/.test(value.value);
}
export function validFolderBackground(value: unknown): value is FolderBackground {
  if (!object(value, ["kind", "color", "second_color", "angle_degrees", "asset_id", "fit", "opacity", "blur_px", "inherit"])) return false;
  if (typeof value.kind !== "string" || !["none", "solid", "gradient", "image"].includes(value.kind) ||
    typeof value.fit !== "string" || !["fit", "fill", "tile"].includes(value.fit) || typeof value.inherit !== "boolean" ||
    typeof value.opacity !== "number" || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 0.5 ||
    !Number.isInteger(value.angle_degrees) || (value.angle_degrees as number) < 0 || (value.angle_degrees as number) > 359 ||
    !Number.isInteger(value.blur_px) || (value.blur_px as number) < 0 || (value.blur_px as number) > 32 ||
    !optional(value.color, backgroundColor) || !optional(value.second_color, backgroundColor) || !optional(value.asset_id, id)) return false;
  if (value.kind === "solid" && !color(value.color)) return false;
  if (value.kind === "gradient" && (!backgroundColor(value.color) || !backgroundColor(value.second_color))) return false;
  return value.kind !== "image" || id(value.asset_id);
}
export function validColumnSet(value: unknown): value is ColumnSet {
  return object(value, ["id", "name", "columns", "folder_type", "version"]) && id(value.id) &&
    typeof value.name === "string" && [...value.name].length >= 1 && [...value.name].length <= 60 &&
    value.version === 1 && validColumns(value.columns) &&
    optional(value.folder_type, (kind) => typeof kind === "string" && ["general", "photos", "music", "documents"].includes(kind));
}
export function validFolderDecoration(value: unknown): value is FolderDecoration {
  return object(value, ["color", "icon", "background", "column_set", "inherited_from", "warning_codes"]) &&
    optional(value.color, color) && validFolderIcon(value.icon) && optional(value.background, validFolderBackground) &&
    optional(value.column_set, validColumnSet) && optional(value.inherited_from, path) &&
    Array.isArray(value.warning_codes) && value.warning_codes.length <= 8 &&
    value.warning_codes.every((code) => typeof code === "string" && code.length <= 128);
}
export function validCustomizeRequest(value: unknown): value is FolderCustomizeRequest {
  if (!object(value, ["paths", "patch", "expected_keys", "apply_windows", "accepted_windows_change"]) ||
    !Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 1000 || !value.paths.every(path) ||
    !Array.isArray(value.expected_keys) || value.expected_keys.length !== value.paths.length || !value.expected_keys.every(identity) ||
    typeof value.apply_windows !== "boolean" || typeof value.accepted_windows_change !== "boolean" ||
    (value.apply_windows && !value.accepted_windows_change) ||
    !object(value.patch, ["color", "icon", "background", "column_set_id", "scope"])) return false;
  const patch = value.patch;
  return Object.values(patch).some((item) => item !== undefined) && optional(patch.color, (item) => item === null || color(item)) &&
    optional(patch.icon, validFolderIcon) && optional(patch.background, validFolderBackground) &&
    optional(patch.column_set_id, id) && optional(patch.scope, (scope) => scope === "exact" || scope === "subtree");
}
function requireRuntime(): void { if (!isTauriRuntime()) throw new Error("folder_custom.unsupported"); }
function invalid(): never { throw new Error("folder_custom.invalid"); }
function checkPaths(paths: readonly string[], max: number): void {
  if (paths.length > max || !paths.every(path)) invalid();
}
function bounded(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 768 * 1024) invalid();
}
function checkedJob(handle: JobHandle<FolderCustomizeResult>): JobHandle<FolderCustomizeResult> {
  return { ...handle, completion: handle.completion.then((result) => {
    bounded(result);
    if (!object(result, ["changed_count", "windows_applied_count", "failures", "next_cursor", "history_id", "complete"]) ||
      !Number.isInteger(result.changed_count) || result.changed_count < 0 || result.changed_count > 1000 ||
      !Number.isInteger(result.windows_applied_count) || result.windows_applied_count < 0 || result.windows_applied_count > result.changed_count ||
      !id(result.history_id) || typeof result.complete !== "boolean" || !optional(result.next_cursor, id) ||
      !Array.isArray(result.failures) || result.failures.length > 256 || !result.failures.every((failure: unknown) =>
        object(failure, ["path", "code"]) && path(failure.path) && typeof failure.code === "string" && failure.code.length <= 128)) invalid();
    return result;
  }) };
}
function expectedPathKey(path: string): string {
  // folderViewKey drops a trailing separator; a drive root keeps its own.
  const key = folderViewKey(displayPath(path).replace(/\//g, "\\"));
  return /^[a-z]:$/.test(key) ? `${key}\\` : key;
}
/** Canonical directory identities for a mutation. Each path is rebound to the
 * native opened-directory handle so a caller cannot mix paths and keys. */
export async function readFolderIdentityKeys(paths: readonly string[]): Promise<FileIdentityKey[]> {
  checkPaths(paths, 1000);
  if (!paths.length) invalid();
  requireRuntime();
  const keys = await Promise.all(paths.map((path) => readFileIdentity(path)));
  if (!keys.every(identity)) invalid();
  if (keys.some((key, index) => key.path_key !== expectedPathKey(paths[index]))) throw new Error("folder_custom.changed");
  return keys;
}
export async function getFolderDecorations(paths: readonly string[]): Promise<FolderDecoration[]> {
  checkPaths(paths, 256);
  if (!paths.length) return [];
  requireRuntime();
  const result = await invoke<unknown>("folder_decorations", { paths });
  bounded(result);
  if (!Array.isArray(result) || result.length !== paths.length || !result.every(validFolderDecoration)) invalid();
  return result;
}
export async function customizeFolders(request: FolderCustomizeRequest): Promise<JobHandle<FolderCustomizeResult>> {
  if (!validCustomizeRequest(request)) invalid();
  requireRuntime();
  return checkedJob(await runJob<FolderCustomizeResult>("foldercustom", async (requestId) => {
    await invoke("folder_customize_start", { requestId, request });
  }));
}
export async function resetFolders(paths: readonly string[], expectedKeys: readonly FileIdentityKey[]): Promise<JobHandle<FolderCustomizeResult>> {
  checkPaths(paths, 1000);
  if (!paths.length || paths.length !== expectedKeys.length || !expectedKeys.every(identity)) invalid();
  requireRuntime();
  return checkedJob(await runJob<FolderCustomizeResult>("folderreset", async (requestId) => {
    await invoke("folder_reset_start", { requestId, paths, expectedKeys });
  }));
}
/** App appearance only. Windows writes stay off until the object-bound
 * replacement adapter exists; a failed call never reports a saved look. */
export async function customizeFoldersAtPaths(
  paths: readonly string[],
  patch: FolderCustomizeRequest["patch"],
): Promise<JobHandle<FolderCustomizeResult>> {
  const expectedKeys = await readFolderIdentityKeys(paths);
  return customizeFolders({
    paths: [...paths],
    patch,
    expected_keys: expectedKeys,
    apply_windows: false,
    accepted_windows_change: false,
  });
}
export async function resetFoldersAtPaths(paths: readonly string[]): Promise<JobHandle<FolderCustomizeResult>> {
  return resetFolders(paths, await readFolderIdentityKeys(paths));
}
export async function listColumnSets(): Promise<ColumnSet[]> {
  requireRuntime();
  const result = await invoke<unknown>("column_sets_list");
  bounded(result);
  if (!Array.isArray(result) || result.length > 100 || !result.every(validColumnSet) || new Set(result.map((set) => set.id)).size !== result.length) invalid();
  return result;
}
export async function saveColumnSet(value: ColumnSet): Promise<ColumnSet> {
  if (!validColumnSet(value)) invalid();
  requireRuntime();
  const result = await invoke<unknown>("column_set_save", { value });
  if (!validColumnSet(result)) invalid();
  return result;
}
export async function removeColumnSet(columnSetId: string): Promise<void> {
  if (!id(columnSetId)) invalid();
  requireRuntime();
  await invoke("column_set_remove", { id: columnSetId });
}
