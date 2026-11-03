import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

/** The preview cache (Step 07a, E5). Bytes never travel through IPC: a
 * lease carries a token for the `adpfile` protocol. */

export type CacheKind =
  | "thumbnail"
  | "metadata"
  | "pdf_page"
  | "ocr"
  | "media_proxy"
  | "model_scene";

/** Mirrors Rust `fs_service::source_stamp::SourceStamp`. Native IDs are
 * strings so a JavaScript number never loses a bit. */
export interface SourceStamp {
  path_key: string;
  volume_id: string;
  file_id: string;
  modified_ticks: string;
  size_bytes: number;
}

/** Mirrors Rust `cache_store::CacheKey`. */
export interface CacheKey {
  source: SourceStamp;
  kind: CacheKind;
  handler_id: string;
  handler_version: number;
  options_key: string;
}

/** Mirrors Rust `cache_store::CacheLease`. */
export interface CacheLease {
  lease_id: string;
  token: string;
  name: string;
  mime: string;
  byte_len: number;
  width?: number;
  height?: number;
  sensitive?: boolean;
}

/** Mirrors Rust `cache_store::CacheUsage`. */
export interface CacheUsage {
  disk_bytes: number;
  limit_bytes: number;
  entry_count: number;
  leased_count: number;
  pending_delete_bytes: number;
}

export async function releaseCacheLease(leaseId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("cache_release", { leaseId });
}

export async function getCacheUsage(): Promise<CacheUsage> {
  if (!isTauriRuntime()) {
    return {
      disk_bytes: 0,
      limit_bytes: 0,
      entry_count: 0,
      leased_count: 0,
      pending_delete_bytes: 0,
    };
  }
  return (await invoke("cache_usage")) as CacheUsage;
}

export async function clearCache(kind?: CacheKind): Promise<CacheUsage> {
  if (!isTauriRuntime()) {
    return {
      disk_bytes: 0,
      limit_bytes: 0,
      entry_count: 0,
      leased_count: 0,
      pending_delete_bytes: 0,
    };
  }
  return (await invoke("cache_clear", { kind })) as CacheUsage;
}
