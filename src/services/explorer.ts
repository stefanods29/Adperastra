import { Channel, invoke } from "@tauri-apps/api/core";
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
  file_id: number | null;
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

let requestCounter = 0;

function newRequestId(): string {
  requestCounter += 1;
  return `list-${Date.now().toString(36)}-${requestCounter}`;
}

export async function listDir(
  path: string,
  sort: SortSpec,
  onBatch: (items: ExplorerItem[]) => void,
): Promise<{ outcome: ListDirOutcome; requestId: string; cancel: () => Promise<void> }> {
  const requestId = newRequestId();
  const channel = new Channel<ExplorerItem[]>();
  channel.onmessage = onBatch;
  const cancel = async () => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("list_dir_cancel", { requestId });
    } catch {
      // Best effort: the listing may already have finished.
    }
  };
  const outcome = (await invoke("list_dir_start", {
    path,
    sortKey: sort.key,
    sortDirection: sort.direction,
    requestId,
    onBatch: channel,
  })) as ListDirOutcome;
  return { outcome: { ...outcome, path: displayPath(outcome.path) }, requestId, cancel };
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

export async function watchStart(path: string, onEvent: (events: FsEventDto[]) => void): Promise<void> {
  const channel = new Channel<FsEventDto[]>();
  channel.onmessage = onEvent;
  await invoke("watch_start", { path, onEvent: channel });
}

export async function watchStop(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("watch_stop");
  } catch {
    // No watcher was running.
  }
}