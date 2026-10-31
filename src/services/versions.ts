import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";
import type { SavedFile } from "./textFiles";

/** Mirrors Rust `version_store::VersionInfo` (snake_case fields). */
export interface VersionInfo {
  id: number;
  created_unix: number;
  reason: string;
  size: number;
  file_modified_unix: number;
}

/** Mirrors Rust `versions::VersionList`. */
export interface VersionList {
  versions: VersionInfo[];
  /** The current file is over 256 MB, so no version is kept. */
  too_large: boolean;
}

/** Mirrors Rust `versions::RestoreResult`. */
export interface RestoreResult {
  /** The snapshot of the content from before the restore, when it was kept. */
  previous_id: number | null;
  saved: SavedFile;
}

/** A file's kept versions, newest first. */
export async function versionsList(path: string): Promise<VersionList> {
  if (!isTauriRuntime()) return { versions: [], too_large: false };
  return (await invoke("versions_list", { path })) as VersionList;
}

/** Extract a version to a read-only copy and return its path. */
export async function versionsExtract(id: number, fileName: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("versions.other");
  return (await invoke("versions_extract", { id, fileName })) as string;
}

/** Put a version back into the file; the old content is kept first. */
export async function versionsRestore(path: string, id: number): Promise<RestoreResult> {
  if (!isTauriRuntime()) throw new Error("versions.other");
  return (await invoke("versions_restore", { path, id })) as RestoreResult;
}

/** Save a version as a separate file; null when the dialog is cancelled. */
export async function versionsSaveCopy(
  id: number,
  title: string,
  fileName: string,
  filterName: string,
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return (await invoke("versions_save_copy", { id, title, fileName, filterName })) as string | null;
}

/** Delete every kept version; user files are not changed. */
export async function versionsDeleteAll(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("versions_delete_all");
}

/** The compressed size of everything the store keeps, in bytes. */
export async function versionsStoreSize(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return (await invoke("versions_store_size")) as number;
}
