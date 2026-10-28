import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./settings";

/** Typed wrapper over the Step 02 Tauri commands (slice 2). All disk
 * access goes through here; the UI never calls invoke() directly. */

export type ItemKind = "folder" | "file" | "drive" | "other";
export type SortKey = "name" | "modified" | "size" | "kind";
export type SortDirection = "ascending" | "descending";

export interface SortSpec {
  key: SortKey;
  direction: SortDirection;
}

export interface ExplorerItem {
  path: string;
  name: string;
  kind: ItemKind;
  size: number;
  modified_unix: number;
  hidden: boolean;
  system: boolean;
  is_link: boolean;
  online_only: boolean;
  /** Decimal string: Windows file IDs can exceed Number.MAX_SAFE_INTEGER. */
  file_id: string | null;
  file_id_stable: boolean;
}

export interface ListDirOutcome {
  path: string;
  total: number;
  skipped: { path: string; message: string }[];
}

export interface KnownFolder {
  id: string;
  name: string;
  path: string;
}

export interface DriveItem {
  root: string;
  kind: string;
}

export interface DriveInfo {
  root: string;
  ready: boolean;
  label: string | null;
  file_system: string | null;
  total_bytes: number | null;
  free_bytes: number | null;
}

export interface RecentItem {
  name: string;
  path: string;
  kind: ItemKind;
  modified_unix: number;
  size: number;
}

export interface ExplorerStateData {
  schema_version: number;
  pinned_folders: string[];
  recent_folders: string[];
}

export interface FsEventDto {
  kind: "created" | "removed" | "modified" | "renamed" | "rescan";
  path: string;
}

// ---------------------------------------------------------------------------
// Path helpers (pure)
// ---------------------------------------------------------------------------

/** Remove the Windows long-path prefix for display. */
export function displayPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return "\\\\" + path.slice("\\\\?\\UNC\\".length);
  if (path.startsWith("\\\\?\\")) return path.slice("\\\\?\\".length);
  return path;
}

export interface PathSegment {
  label: string;
  path: string;
}

/** Breadcrumb segments for a path like C:\Users\me (or a UNC share). */
export function pathSegments(rawPath: string): PathSegment[] {
  const path = displayPath(rawPath);
  const unc = path.startsWith("\\\\");
  const parts = path.split("\\").filter((part) => part.length > 0);
  if (parts.length === 0) return [];
  const segments: PathSegment[] = [];
  if (unc) {
    const root = `\\\\${parts[0]}\\${parts[1] ?? ""}`;
    segments.push({ label: root, path: root });
    let current = root;
    for (const part of parts.slice(2)) {
      current = `${current}\\${part}`;
      segments.push({ label: part, path: current });
    }
    return segments;
  }
  const root = `${parts[0]}\\`;
  segments.push({ label: root, path: root });
  let current = root;
  for (const part of parts.slice(1)) {
    current = current.endsWith("\\") ? `${current}${part}` : `${current}\\${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

export function parentPathOf(rawPath: string): string | null {
  const segments = pathSegments(rawPath);
  if (segments.length <= 1) return null;
  return segments[segments.length - 2].path;
}

/** Explorer search/current-folder matching ignores case on Windows. */
export function samePath(a: string, b: string): boolean {
  return displayPath(a).toLowerCase() === displayPath(b).toLowerCase();
}

/** Merge Windows Recent items with our own visited folders (own history
 * first, de-duplicated by path, Windows order preserved after that). */
export function mergeRecentItems(windowsItems: RecentItem[], ownFolders: string[]): RecentItem[] {
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const path of ownFolders) {
    const key = displayPath(path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = displayPath(path).split("\\").filter(Boolean).pop() ?? path;
    out.push({ name, path: displayPath(path), kind: "folder", modified_unix: 0, size: 0 });
  }
  for (const item of windowsItems) {
    const key = displayPath(item.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

let requestCounter = 0;

function newRequestId(): string {
  requestCounter += 1;
  return `list-${Date.now().toString(36)}-${requestCounter}`;
}

export interface ListDirHandle {
  requestId: string;
  cancel: () => Promise<void>;
  completion: Promise<ListDirOutcome>;
}

interface ListPoll {
  batches: ExplorerItem[][];
  done: boolean;
  outcome: ListDirOutcome | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Start a streaming listing. Transport ruling (Step 02): Tauri Channel
 * messages never arrived under the app's isolation pattern (Rust listed
 * 57 items, sends succeeded, JS received 0), so batches move through
 * plain invoke commands instead: list_dir_start runs the listing in
 * Rust, list_dir_poll drains queued batches until done.
 */
export async function startListDir(
  path: string,
  sort: SortSpec,
  onBatch: (items: ExplorerItem[]) => void,
): Promise<ListDirHandle> {
  const requestId = newRequestId();
  let cancelled = false;
  await invoke("list_dir_start", {
    path,
    sortKey: sort.key,
    sortDirection: sort.direction,
    requestId,
  });
  const cancel = async () => {
    cancelled = true;
    if (!isTauriRuntime()) return;
    try {
      await invoke("list_dir_cancel", { requestId });
    } catch {
      // Best effort: the listing may already have finished.
    }
  };
  const completion = (async (): Promise<ListDirOutcome> => {
    for (;;) {
      if (cancelled) throw new Error("cancelled");
      const poll = (await invoke("list_dir_poll", { requestId })) as ListPoll;
      for (const batch of poll.batches) onBatch(batch);
      if (poll.error) throw new Error(poll.error);
      if (poll.done && poll.outcome) {
        return { ...poll.outcome, path: displayPath(poll.outcome.path) };
      }
      await sleep(25);
    }
  })();
  return { requestId, cancel, completion };
}
export async function fsStat(path: string): Promise<ExplorerItem> {
  return (await invoke("fs_stat", { path })) as ExplorerItem;
}

export async function listKnownFolders(): Promise<KnownFolder[]> {
  return (await invoke("list_known_folders")) as KnownFolder[];
}

export async function listDrives(): Promise<DriveItem[]> {
  return (await invoke("list_drives")) as DriveItem[];
}

export async function driveInfo(root: string): Promise<DriveInfo> {
  return (await invoke("drive_info", { root })) as DriveInfo;
}

export async function listRecentItems(limit: number): Promise<RecentItem[]> {
  return (await invoke("list_recent_items", { limit })) as RecentItem[];
}

export async function explorerStateGet(): Promise<ExplorerStateData> {
  return (await invoke("explorer_state_get")) as ExplorerStateData;
}

export async function pinFolder(path: string): Promise<ExplorerStateData> {
  return (await invoke("pin_folder", { path })) as ExplorerStateData;
}

export async function unpinFolder(path: string): Promise<ExplorerStateData> {
  return (await invoke("unpin_folder", { path })) as ExplorerStateData;
}

export async function recordRecentFolder(path: string): Promise<ExplorerStateData> {
  return (await invoke("record_recent_folder", { path })) as ExplorerStateData;
}

export async function watchStart(
  path: string,
  onEvent: (events: FsEventDto[]) => void,
): Promise<UnlistenFn> {
  const unlisten = await listen<FsEventDto[]>("watch-events", (event) => onEvent(event.payload));
  try {
    await invoke("watch_start", { path });
  } catch (error) {
    unlisten();
    throw error;
  }
  return unlisten;
}

export async function watchStop(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("watch_stop");
  } catch {
    // No watcher was running.
  }
}