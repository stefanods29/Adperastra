import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileIdentityKey } from "./fileIdentity";
import { identityKeyText } from "./storage";
import { isTauriRuntime } from "./settings";

/** Optional background folder sizes (Step 11c, `folder-size-1`).
 *
 * A request replies immediately with `pending` (queued work) or a cached
 * `ready` value; the completed value arrives through the `folder-size`
 * event. Values never block browsing. */

export type FolderSizeStatus = "pending" | "running" | "ready" | "partial" | "unavailable";
export type FolderSizePriority = "visible" | "overscan";

export interface FolderSizeConsumer {
  consumer_id: string;
  path: string;
  priority: FolderSizePriority;
}

export interface FolderSizeValue {
  key: FileIdentityKey;
  state: FolderSizeStatus;
  logical_bytes?: number | null;
  item_count?: number | null;
  calculated_unix?: number | null;
  generation: number;
  reason_code?: string | null;
}

export const FOLDER_SIZE_EVENT = "folder-size";
export const FOLDER_SIZE_BATCH_MS = 100;

function unavailable(path: string): FolderSizeValue {
  return {
    key: {
      volume_id: "00000000",
      file_id: "0000000000000000",
      path_key: path.toLowerCase(),
      stable: false,
    },
    state: "unavailable",
    logical_bytes: null,
    item_count: null,
    calculated_unix: null,
    generation: 0,
    reason_code: "folder_size.unavailable",
  };
}

/** E4: ask for one folder. */
export async function requestFolderSize(
  consumer: FolderSizeConsumer,
): Promise<FolderSizeValue> {
  if (!isTauriRuntime()) return unavailable(consumer.path);
  return (await invoke("folder_size_request", { consumer })) as FolderSizeValue;
}

/** E4: release one consumer; the last release cancels queued work. */
export async function releaseFolderSize(consumerId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("folder_size_release", { consumerId });
}

/** E4: completed values. */
export async function onFolderSize(
  listener: (value: FolderSizeValue) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<FolderSizeValue>(FOLDER_SIZE_EVENT, (event) => listener(event.payload));
}

export function folderSizeKey(value: FolderSizeValue): string {
  return identityKeyText(value.key);
}

/** Ready and partial folders count as known for display; only `ready` is a
 * complete value and partial values keep the "At least" label. */
export function isCompleteFolderSize(value: FolderSizeValue | null): boolean {
  return value?.state === "ready" && typeof value.logical_bytes === "number";
}

export function isPartialFolderSize(value: FolderSizeValue | null): boolean {
  return value?.state === "partial" && typeof value.logical_bytes === "number";
}

export interface FolderSizeDisplayState<TSelection, TAnchor> {
  values: ReadonlyMap<string, FolderSizeValue>;
  selection: TSelection;
  anchor: TAnchor;
  scrollTop: number;
}

/**
 * Merge one 100 ms batch without touching selection, focus anchor or scroll
 * position. The returned object keeps the caller's selection/anchor values
 * by reference, so an in-flight rename or range selection cannot be reset by
 * an asynchronous folder size.
 */
export function mergeFolderSizeBatch<TSelection, TAnchor>(
  state: FolderSizeDisplayState<TSelection, TAnchor>,
  updates: readonly FolderSizeValue[],
): FolderSizeDisplayState<TSelection, TAnchor> {
  if (updates.length === 0) return state;
  const values = new Map(state.values);
  for (const update of updates) values.set(folderSizeKey(update), update);
  return { ...state, values };
}

export interface FolderSizeBatcher<TSelection, TAnchor> {
  push: (value: FolderSizeValue) => void;
  flush: () => void;
  dispose: () => void;
}

/** Coalesce events for 100 ms; one state update per batch. */
export function createFolderSizeBatcher<TSelection, TAnchor>(
  state: () => FolderSizeDisplayState<TSelection, TAnchor>,
  apply: (next: FolderSizeDisplayState<TSelection, TAnchor>) => void,
  intervalMs: number = FOLDER_SIZE_BATCH_MS,
): FolderSizeBatcher<TSelection, TAnchor> {
  let pending: FolderSizeValue[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const updates = pending;
    pending = [];
    apply(mergeFolderSizeBatch(state(), updates));
  };
  return {
    push(value) {
      pending.push(value);
      if (timer === null) timer = setTimeout(flush, intervalMs);
    },
    flush,
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}
