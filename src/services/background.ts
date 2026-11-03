import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

/** Shared background policy (Step 07a, E4). The policy state is not an
 * execution result: it says whether work would start right now. */

export type BackgroundTaskKind =
  | "thumbnails"
  | "metadata"
  | "ocr"
  | "filename_index"
  | "content_index"
  | "folder_sizes"
  | "storage_scan"
  | "version_cleanup"
  | "pack_download";

export const BACKGROUND_TASKS: readonly BackgroundTaskKind[] = [
  "thumbnails",
  "metadata",
  "ocr",
  "filename_index",
  "content_index",
  "folder_sizes",
  "storage_scan",
  "version_cleanup",
  "pack_download",
];

export type BackgroundReason = "none" | "disabled" | "idle" | "ac" | "paused";

/** Mirrors Rust `background::BackgroundStatus`. */
export interface BackgroundStatus {
  paused: boolean;
  eligible: boolean;
  reason: BackgroundReason;
  running: number;
  queued: number;
}

/** Mirrors Rust `background::BackgroundSettings` (schema 12). */
export interface BackgroundSettings {
  enabled: boolean;
  only_idle: boolean;
  only_ac: boolean;
  paused: boolean;
  /** Every known task; missing entries use their default. */
  tasks: Record<BackgroundTaskKind, boolean>;
}

/** Every preview cache limit Settings offers, in megabytes. */
export type CacheLimitMb = 128 | 256 | 512 | 1024 | 2048;

/** Mirrors Rust `background::CacheSettings` (schema 12). */
export interface CacheSettings {
  max_mb: CacheLimitMb;
}

/** The limits Settings > Background work offers, in megabytes. */
export const CACHE_LIMITS_MB: readonly CacheLimitMb[] = [128, 256, 512, 1024, 2048];
export const DEFAULT_CACHE_MB = 512;
export const IDLE_AFTER_MS = 30_000;

/** The default per-kind switch state (plan D9). */
export const BACKGROUND_TASK_DEFAULTS: Record<BackgroundTaskKind, boolean> = {
  thumbnails: true,
  metadata: true,
  ocr: true,
  filename_index: false,
  content_index: false,
  folder_sizes: false,
  storage_scan: false,
  version_cleanup: true,
  pack_download: false,
};

export function isBackgroundTaskKind(value: unknown): value is BackgroundTaskKind {
  return typeof value === "string" && (BACKGROUND_TASKS as readonly string[]).includes(value);
}

/** The current policy state. Outside Tauri this is "disabled", never a fake
 * success. */
export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  if (!isTauriRuntime()) {
    return { paused: false, eligible: false, reason: "disabled", running: 0, queued: 0 };
  }
  return (await invoke("background_status")) as BackgroundStatus;
}

const eligibilityListeners = new Set<() => void>();
let eligibilityTimer: ReturnType<typeof setTimeout> | undefined;
let eligibilityChecking = false;

function scheduleEligibilityCheck(): void {
  if (eligibilityTimer !== undefined || eligibilityChecking || eligibilityListeners.size === 0) return;
  eligibilityTimer = setTimeout(async () => {
    eligibilityTimer = undefined;
    eligibilityChecking = true;
    try {
      if ((await getBackgroundStatus()).eligible) {
        const ready = [...eligibilityListeners];
        eligibilityListeners.clear();
        for (const listener of ready) listener();
      }
    } catch {
      // A transient status failure keeps the fallback until the next sample.
    } finally {
      eligibilityChecking = false;
      scheduleEligibilityCheck();
    }
  }, 1000);
}

/** One shared status poll for paused previews, stopped when the last view leaves. */
export function subscribeBackgroundEligible(listener: () => void): () => void {
  eligibilityListeners.add(listener);
  scheduleEligibilityCheck();
  return () => {
    eligibilityListeners.delete(listener);
    if (eligibilityListeners.size === 0 && eligibilityTimer !== undefined) {
      clearTimeout(eligibilityTimer);
      eligibilityTimer = undefined;
    }
  };
}
