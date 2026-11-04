/** Shareable `.adperastra-setup` files (Step 10e, setup-file-1).
 *
 * A setup is bounded data in a ZIP: `manifest.json`, one `data/<part>.json`
 * per part and optional owned `assets/<UUID>.png` images. Nothing here
 * executes code. Preview reads and validates everything before the dialog
 * shows it; Apply revalidates and is transactional (D7-D10).
 */
import { invoke } from "@tauri-apps/api/core";
import { runJob, type JobHandle } from "./jobs";

export type SetupPart =
  | "theme"
  | "layout"
  | "menus"
  | "toolbars"
  | "navigation"
  | "home"
  | "status"
  | "keyboard";

export const SETUP_PARTS: readonly SetupPart[] = [
  "theme",
  "layout",
  "menus",
  "toolbars",
  "navigation",
  "home",
  "status",
  "keyboard",
];

export const SETUP_SCHEMA_VERSION = 1;
export const MAX_SETUP_COMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_SETUP_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_SETUP_ENTRIES = 256;
export const MAX_SETUP_DEPTH = 4;
export const MAX_SETUP_RATIO = 100;
export const MAX_SETUP_PART_BYTES = 1024 * 1024;
/** Owned theme images keep the 10a source limit. */
export const MAX_SETUP_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_SETUP_WARNINGS = 64;
export const MAX_SETUP_APP_VERSION_CHARS = 128;
export const MAX_SETUP_DIALOG_TEXT = 200;
const SETUP_FILE_EXTENSION = ".adperastra-setup";

export interface SetupManifestEntry {
  name: string;
  byte_len: number;
  sha256: string;
}

export interface SetupManifest {
  schema_version: 1;
  app_version: string;
  parts: SetupPart[];
  entries: SetupManifestEntry[];
  contains_personal_paths: boolean;
  created_unix: number;
}

export interface SetupPreviewPart {
  id: SetupPart;
  item_count: number;
  warning_codes: string[];
}

export interface SetupPreview {
  preview_id: string;
  manifest: SetupManifest;
  parts: SetupPreviewPart[];
  expires_unix: number;
}

export interface SetupApplyRequest {
  preview_id: string;
  parts: SetupPart[];
  accept_personal_paths: boolean;
}

export interface SetupApplyResult {
  applied_parts: SetupPart[];
  history_id: string;
  restart_required: boolean;
  pending_recovery: boolean;
  warning_codes: string[];
}

export interface SetupExportResult {
  path: string;
  bytes: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:\\|\\\\)/;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export function isSetupPart(value: unknown): value is SetupPart {
  return typeof value === "string" && (SETUP_PARTS as readonly string[]).includes(value);
}

export function setupPartLabelKey(part: SetupPart): string {
  return `setups.part${part[0].toUpperCase()}${part.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function safeU64(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => !FORBIDDEN_KEYS.has(key) && set.has(key));
}

/** Only the three fixed, relative entry families are accepted. */
export function isSetupEntryName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > 512) return false;
  if (name.includes("\\") || name.includes("..") || name.startsWith("/") || name.includes(":")) return false;
  if (name.split("/").length > MAX_SETUP_DEPTH) return false;
  if (name === "manifest.json") return true;
  if (name.startsWith("data/") && name.endsWith(".json")) {
    const part = name.slice("data/".length, -".json".length);
    return isSetupPart(part);
  }
  if (name.startsWith("assets/") && name.endsWith(".png")) {
    return UUID_RE.test(name.slice("assets/".length, -".png".length));
  }
  return false;
}

/** Strict manifest validation with unique parts and case-insensitive names. */
export function validateSetupManifest(value: unknown): SetupManifest | null {
  if (!isRecord(value)) return null;
  if (!onlyKeys(value, ["schema_version", "app_version", "parts", "entries", "contains_personal_paths", "created_unix"])) {
    return null;
  }
  if (value.schema_version !== SETUP_SCHEMA_VERSION) return null;
  if (
    typeof value.app_version !== "string" ||
    value.app_version.length === 0 ||
    charCount(value.app_version) > MAX_SETUP_APP_VERSION_CHARS ||
    Array.from(value.app_version).some((character) => (character.codePointAt(0) ?? 0) < 0x20)
  ) {
    return null;
  }
  if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > SETUP_PARTS.length) return null;
  const parts: SetupPart[] = [];
  for (const part of value.parts) {
    if (!isSetupPart(part) || parts.includes(part)) return null;
    parts.push(part);
  }
  if (!Array.isArray(value.entries) || value.entries.length >= MAX_SETUP_ENTRIES) return null;
  const entries: SetupManifestEntry[] = [];
  const names = new Set<string>();
  const entryParts = new Set<SetupPart>();
  for (const entry of value.entries) {
    if (!isRecord(entry) || !onlyKeys(entry, ["name", "byte_len", "sha256"])) return null;
    if (!isSetupEntryName(entry.name) || entry.name === "manifest.json") return null;
    if (entry.name.startsWith("data/")) {
      entryParts.add(entry.name.slice("data/".length, -".json".length) as SetupPart);
    }
    const limit = entry.name.startsWith("assets/") ? MAX_SETUP_ASSET_BYTES : MAX_SETUP_PART_BYTES;
    if (!safeU64(entry.byte_len) || entry.byte_len > limit) return null;
    if (typeof entry.sha256 !== "string" || !SHA256_RE.test(entry.sha256)) return null;
    const folded = entry.name.toLowerCase();
    if (names.has(folded)) return null;
    names.add(folded);
    entries.push({ name: entry.name, byte_len: entry.byte_len, sha256: entry.sha256 });
  }
  if (parts.some((part) => !entryParts.has(part))) return null;
  if ([...entryParts].some((part) => !parts.includes(part))) return null;
  if (typeof value.contains_personal_paths !== "boolean" || !safeU64(value.created_unix)) return null;
  return {
    schema_version: 1,
    app_version: value.app_version,
    parts,
    entries,
    contains_personal_paths: value.contains_personal_paths,
    created_unix: value.created_unix,
  };
}

export function validateSetupPreview(value: unknown): SetupPreview {
  if (!isRecord(value)) throw new Error("setup.invalid");
  const manifest = validateSetupManifest(value.manifest);
  if (!manifest || typeof value.preview_id !== "string" || !UUID_RE.test(value.preview_id)) {
    throw new Error("setup.invalid");
  }
  if (!safeU64(value.expires_unix) || !Array.isArray(value.parts) || value.parts.length > manifest.parts.length) {
    throw new Error("setup.invalid");
  }
  const parts: SetupPreviewPart[] = [];
  let warnings = 0;
  for (const entry of value.parts) {
    if (!isRecord(entry) || !isSetupPart(entry.id) || !manifest.parts.includes(entry.id)) throw new Error("setup.invalid");
    if (parts.some((part) => part.id === entry.id)) throw new Error("setup.invalid");
    if (typeof entry.item_count !== "number" || !Number.isInteger(entry.item_count) || entry.item_count < 0) {
      throw new Error("setup.invalid");
    }
    if (!Array.isArray(entry.warning_codes) || entry.warning_codes.length > 8) throw new Error("setup.invalid");
    const warningCodes = entry.warning_codes.map((code) => {
      if (typeof code !== "string" || code.length === 0 || charCount(code) > 64) throw new Error("setup.invalid");
      return code;
    });
    warnings += warningCodes.length;
    if (warnings > MAX_SETUP_WARNINGS) throw new Error("setup.invalid");
    parts.push({ id: entry.id, item_count: entry.item_count, warning_codes: warningCodes });
  }
  if (parts.length !== manifest.parts.length) throw new Error("setup.invalid");
  return {
    preview_id: value.preview_id,
    manifest,
    parts,
    expires_unix: value.expires_unix,
  };
}

export function validateSetupApplyRequest(value: unknown): SetupApplyRequest {
  if (!isRecord(value) || !onlyKeys(value, ["preview_id", "parts", "accept_personal_paths"])) {
    throw new Error("setup.invalid");
  }
  if (typeof value.preview_id !== "string" || !UUID_RE.test(value.preview_id)) throw new Error("setup.invalid");
  if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > SETUP_PARTS.length) {
    throw new Error("setup.invalid");
  }
  const parts: SetupPart[] = [];
  for (const part of value.parts) {
    if (!isSetupPart(part) || parts.includes(part)) throw new Error("setup.invalid");
    parts.push(part);
  }
  if (typeof value.accept_personal_paths !== "boolean") throw new Error("setup.invalid");
  return { preview_id: value.preview_id, parts, accept_personal_paths: value.accept_personal_paths };
}

export function validateSetupApplyResult(value: unknown): SetupApplyResult {
  if (!isRecord(value)) throw new Error("setup.invalid");
  if (!Array.isArray(value.applied_parts) || typeof value.history_id !== "string" || !UUID_RE.test(value.history_id)) {
    throw new Error("setup.invalid");
  }
  const applied: SetupPart[] = [];
  for (const part of value.applied_parts) {
    if (!isSetupPart(part) || applied.includes(part)) throw new Error("setup.invalid");
    applied.push(part);
  }
  if (applied.length === 0) throw new Error("setup.invalid");
  if (typeof value.restart_required !== "boolean" || typeof value.pending_recovery !== "boolean") {
    throw new Error("setup.invalid");
  }
  if (!Array.isArray(value.warning_codes) || value.warning_codes.length > MAX_SETUP_WARNINGS) {
    throw new Error("setup.invalid");
  }
  for (const code of value.warning_codes) {
    if (typeof code !== "string" || code.length === 0 || charCount(code) > 64) throw new Error("setup.invalid");
  }
  return {
    applied_parts: applied,
    history_id: value.history_id,
    restart_required: value.restart_required,
    pending_recovery: value.pending_recovery,
    warning_codes: [...value.warning_codes],
  };
}

// ---------------------------------------------------------------------------
// Native service (the only place this module calls invoke)
// ---------------------------------------------------------------------------

/** Pick one `.adperastra-setup` file for import. A cancelled dialog is
 * `null`; the chosen path is revalidated absolute and by extension before
 * `setup_preview_start` reads anything. */
export async function pickSetupImport(
  title: string,
  filterName: string,
): Promise<string | null> {
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    charCount(title) > MAX_SETUP_DIALOG_TEXT ||
    typeof filterName !== "string" ||
    filterName.trim() === "" ||
    charCount(filterName) > MAX_SETUP_DIALOG_TEXT
  ) {
    throw new Error("setup.invalid");
  }
  const chosen = (await invoke("setup_pick_import", { title, filterName })) as unknown;
  if (chosen === null) return null;
  if (
    typeof chosen !== "string" ||
    !ABSOLUTE_PATH_RE.test(chosen) ||
    !chosen.toLowerCase().endsWith(SETUP_FILE_EXTENSION)
  ) {
    throw new Error("setup.invalid");
  }
  return chosen;
}

export async function previewSetup(path: string): Promise<JobHandle<SetupPreview>> {
  if (path.trim() === "" || !ABSOLUTE_PATH_RE.test(path)) return Promise.reject(new Error("setup.invalid"));
  return runJob<SetupPreview>("setuppreview", async (requestId) => {
    await invoke("setup_preview_start", { requestId, path });
  });
}

export async function applySetup(request: SetupApplyRequest): Promise<JobHandle<SetupApplyResult>> {
  const validated = validateSetupApplyRequest(request);
  return runJob<SetupApplyResult>("setupapply", async (requestId) => {
    await invoke("setup_apply_start", { requestId, request: validated });
  });
}

export async function releaseSetupPreview(previewId: string): Promise<void> {
  if (!UUID_RE.test(previewId)) throw new Error("setup.invalid");
  await invoke("setup_release", { previewId });
}

export async function exportSetup(
  destPath: string,
  parts: readonly SetupPart[],
  includePersonalPaths: boolean,
): Promise<JobHandle<SetupExportResult>> {
  if (!ABSOLUTE_PATH_RE.test(destPath) || !destPath.toLowerCase().endsWith(SETUP_FILE_EXTENSION)) {
    return Promise.reject(new Error("setup.invalid"));
  }
  const selected = [...new Set(parts)];
  if (selected.length === 0 || selected.length > SETUP_PARTS.length || !selected.every(isSetupPart)) {
    return Promise.reject(new Error("setup.invalid"));
  }
  return runJob<SetupExportResult>("setupexport", async (requestId) => {
    await invoke("setup_export_start", {
      requestId,
      request: {
        dest_path: destPath,
        parts: selected,
        include_personal_paths: includePersonalPaths,
      },
    });
  });
}
