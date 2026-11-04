import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `IntegrationStatus` (revision `windows-integration-1`). */
export type ModernMenuState = "unavailable" | "awaiting_owner" | "available" | "enabled";

export interface IntegrationStatus {
  classic_enabled: boolean;
  modern: ModernMenuState;
  /** Selected extension names, lower case, no dot, at most 128. */
  associations: string[];
  startup_enabled: boolean;
  reason_code: string | null;
}

export interface IntegrationRequest {
  classic_enabled: boolean;
  extensions: string[];
  start_with_windows: boolean;
  modern_requested: boolean;
}

/** Mirrors Rust `MODERN_MENU_APPROVED` (guide D1 OWNER CHECKPOINT). */
export const MODERN_MENU_OWNER_APPROVED = false;
export const MAX_ASSOCIATIONS = 128;
export const MAX_ASSOCIATION_CHARS = 32;

/**
 * The closed association allowlist. It must stay equal to Rust
 * `ASSOCIATION_ALLOWLIST`; the native check is authoritative and refuses any
 * name that is not in its own list.
 */
export const WINDOWS_ASSOCIATION_EXTENSIONS: readonly string[] = [
  "7z", "aac", "arw", "ass", "avif", "avi", "azw3", "bmp", "bz2", "c", "cjs", "cpp", "cr2",
  "cs", "css", "csv", "db", "dng", "docx", "eml", "epub", "fb2", "flac", "fon", "gif", "go",
  "gz", "h", "heic", "heif", "hpp", "htm", "html", "ico", "ics", "ini", "java", "jpeg", "jpg",
  "js", "json", "jsx", "lrc", "m4a", "m4v", "markdown", "md", "mkv", "mobi", "mov", "mp3",
  "mp4", "msg", "mjs", "nef", "odp", "ods", "odt", "ogg", "opus", "otf", "pdf", "php", "png",
  "pptx", "ps1", "psd", "py", "rb", "rar", "raw", "rs", "rtf", "scss", "sh", "sql", "sqlite",
  "sqlite3", "srt", "svg", "tar", "tbz", "tbz2", "tif", "tiff", "toml", "ts", "tsv", "tsx",
  "ttf", "txt", "vcf", "vtt", "wav", "webm", "webp", "wmv", "woff", "woff2", "xlsx", "xml",
  "xz", "yaml", "yml", "zip", "zst",
];

const MODERN_STATES: readonly ModernMenuState[] = [
  "unavailable",
  "awaiting_owner",
  "available",
  "enabled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAllowedAssociation(extension: unknown): extension is string {
  return (
    typeof extension === "string" &&
    extension.length > 0 &&
    extension.length <= MAX_ASSOCIATION_CHARS &&
    /^[a-z0-9]+$/.test(extension) &&
    WINDOWS_ASSOCIATION_EXTENSIONS.includes(extension)
  );
}

/** Normalize the selected extensions: allowlisted, lower case, deduplicated. */
export function normalizeAssociations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    const extension = typeof entry === "string" ? entry.toLowerCase() : "";
    if (!isAllowedAssociation(extension)) continue;
    if (!result.includes(extension)) result.push(extension);
    if (result.length >= MAX_ASSOCIATIONS) break;
  }
  return result.sort();
}

/** Validate and normalize one request before it reaches Rust. */
export function validateIntegrationRequest(request: IntegrationRequest): IntegrationRequest {
  if (
    typeof request.classic_enabled !== "boolean" ||
    typeof request.start_with_windows !== "boolean" ||
    typeof request.modern_requested !== "boolean" ||
    !Array.isArray(request.extensions) ||
    request.extensions.length > MAX_ASSOCIATIONS
  ) {
    throw new Error("windows_integration.bad_request");
  }
  const extensions: string[] = [];
  for (const entry of request.extensions) {
    const extension = typeof entry === "string" ? entry.toLowerCase() : "";
    // A selection that contains an unknown name is refused rather than
    // silently narrowed; the native check does the same.
    if (!isAllowedAssociation(extension)) {
      throw new Error("windows_integration.bad_request");
    }
    if (!extensions.includes(extension)) extensions.push(extension);
  }
  extensions.sort();
  return {
    classic_enabled: request.classic_enabled,
    extensions,
    start_with_windows: request.start_with_windows,
    modern_requested: request.modern_requested,
  };
}

export type IntegrationBlockedReason = "windows_integration.identity_required" | null;

export interface IntegrationPlan {
  send: boolean;
  blocked_reason: IntegrationBlockedReason;
  request: IntegrationRequest | null;
}

/**
 * Decide whether a request may be sent. The modern menu is the only path
 * behind the owner checkpoint; it is blocked before `invoke` and the native
 * command refuses it again.
 */
export function planWindowsIntegration(request: IntegrationRequest): IntegrationPlan {
  if (request.modern_requested && !MODERN_MENU_OWNER_APPROVED) {
    return {
      send: false,
      blocked_reason: "windows_integration.identity_required",
      request: null,
    };
  }
  return {
    send: true,
    blocked_reason: null,
    request: validateIntegrationRequest(request),
  };
}

export interface ModernMenuPresentation {
  state: ModernMenuState;
  requestable: boolean;
  messageKey: string | null;
}

/** Never show the modern menu as enabled while the checkpoint is open. */
export function modernMenuPresentation(state: ModernMenuState): ModernMenuPresentation {
  if (!MODERN_MENU_OWNER_APPROVED) {
    return {
      state: state === "enabled" ? "awaiting_owner" : state,
      requestable: false,
      messageKey: "windowsIntegration.identityRequired",
    };
  }
  if (state === "enabled") {
    return { state, requestable: false, messageKey: null };
  }
  if (state === "available") {
    return { state, requestable: true, messageKey: null };
  }
  return { state, requestable: false, messageKey: "windowsIntegration.identityRequired" };
}

/** Wire data from Rust is untrusted: every field is repaired here. */
export function normalizeIntegrationStatus(value: unknown): IntegrationStatus {
  const input = isRecord(value) ? value : {};
  const modern = MODERN_STATES.includes(input.modern as ModernMenuState)
    ? (input.modern as ModernMenuState)
    : "unavailable";
  return {
    classic_enabled: input.classic_enabled === true,
    modern,
    associations: normalizeAssociations(input.associations),
    startup_enabled: input.startup_enabled === true,
    reason_code:
      typeof input.reason_code === "string" && input.reason_code.length <= 128
        ? input.reason_code
        : null,
  };
}

export async function integrationStatus(): Promise<IntegrationStatus> {
  return normalizeIntegrationStatus(await invoke("windows_integration_status"));
}

export async function applyWindowsIntegration(
  request: IntegrationRequest,
): Promise<IntegrationStatus> {
  const plan = planWindowsIntegration(request);
  if (!plan.send || plan.request === null) {
    throw new Error(plan.blocked_reason ?? "windows_integration.bad_request");
  }
  return normalizeIntegrationStatus(
    await invoke("windows_integration_apply", { request: plan.request }),
  );
}

/** Open Windows' own Default apps page. The user makes the choice there. */
export async function openDefaultAppsSettings(): Promise<void> {
  await invoke("windows_integration_open_defaults");
}
