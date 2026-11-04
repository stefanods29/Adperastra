/** Mirrors Rust `pack_store::types` (Step 12a, packs-1). Snake_case fields. */

export type PackId =
  | "media"
  | "office"
  | "ocr"
  | "ai_runtime"
  | "ai_upscale"
  | "ai_assistant_small"
  | "ai_assistant"
  | "ai_assistant_pro"
  | "ai_embeddings_text"
  | "ai_embeddings_vision"
  | "ai_speech"
  | "ai_foreground"
  | "ai_inpaint"
  | "test_fixture";

/** The packs a normal first run may select. */
export const PRODUCTION_PACK_IDS: readonly PackId[] = ["media", "office", "ocr"];

/** AI ids reserved for their producing steps; unavailable until then. */
export const RESERVED_AI_PACK_IDS: readonly PackId[] = [
  "ai_runtime",
  "ai_upscale",
  "ai_assistant_small",
  "ai_assistant",
  "ai_assistant_pro",
  "ai_embeddings_text",
  "ai_embeddings_vision",
  "ai_speech",
  "ai_foreground",
  "ai_inpaint",
];

export type PackStatePhase =
  | "absent"
  | "downloading"
  | "paused"
  | "verifying"
  | "installing"
  | "installed"
  | "pending_remove"
  | "failed";

export interface PackFile {
  path: string;
  size: number;
  sha256: string;
  executable: boolean;
}

export interface PackDependency {
  id: PackId;
  version: string;
}

export interface PackDescriptor {
  id: PackId;
  version: string;
  name_key: string;
  description_key: string;
  download_url: string;
  download_bytes: number;
  install_bytes: number;
  sha256: string;
  licenses: string[];
  source_urls: string[];
  files: PackFile[];
  dependencies: PackDependency[];
  enables: string[];
  entrypoints: Record<string, string>;
  catalog_revision: number;
}

export interface PackCatalog {
  schema_version: number;
  revision: number;
  allowed_origins: string[];
  packs: PackDescriptor[];
}

export interface PackState {
  id: PackId;
  installed_version: string | null;
  available_version: string | null;
  state: PackStatePhase;
  bytes_received: number;
  error_code: string | null;
  installed_unix: number | null;
  leased_count: number;
}

export type StorageCategory =
  | "thumbnails"
  | "previews"
  | "ocr"
  | "filename_index"
  | "content_index"
  | "folder_sizes"
  | "storage_scans"
  | "versions"
  | "clipboard"
  | "crash_logs"
  | "update_notes"
  | "pack_downloads"
  | "ai_models"
  | "ai_embeddings"
  | "ai_chat"
  | "ai_results"
  | "locked_recovery"
  | "recovery";

/** Every category, in the order Settings > App storage shows it. */
export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  "thumbnails",
  "previews",
  "ocr",
  "filename_index",
  "content_index",
  "folder_sizes",
  "storage_scans",
  "versions",
  "clipboard",
  "crash_logs",
  "update_notes",
  "pack_downloads",
  "ai_models",
  "ai_embeddings",
  "ai_chat",
  "ai_results",
  "locked_recovery",
  "recovery",
];

export interface StorageReport {
  category: StorageCategory;
  disk_bytes: number;
  memory_bytes: number;
  pending_delete_bytes: number;
  limit_bytes: number;
  clearable: boolean;
  loss_key: string;
  busy: boolean;
}

export interface ClearStorageResult {
  category: StorageCategory;
  freed_bytes: number;
  pending_bytes: number;
  complete: boolean;
  errors: string[];
}

/** The largest integer JSON carries without losing precision. */
export const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

export function isStorageCategory(value: unknown): value is StorageCategory {
  return (
    typeof value === "string" &&
    (STORAGE_CATEGORIES as readonly string[]).includes(value)
  );
}
