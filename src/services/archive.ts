import { invoke } from "@tauri-apps/api/core";
import { displayPath } from "./explorer";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Archives (Step 06d): open, browse, open a file inside, extract. Mirrors
 * src-tauri/src/archive.rs. All archive bytes are read by the Rust side's
 * separate helper process; this file only asks for pages of results. */

export type ArchiveFormatId =
  | "zip"
  | "seven_z"
  | "tar"
  | "tar_gz"
  | "tar_xz"
  | "gz"
  | "xz"
  | "bz2"
  | "tar_bz2"
  | "rar";

export type ArchiveEntryKind = "file" | "folder" | "link";

/** One open archive (mirrors Rust `ArchiveSummary`). */
export interface ArchiveSummary {
  session: string;
  format: ArchiveFormatId;
  files: number;
  folders: number;
  links: number;
  encrypted_entries: number;
  /** Items whose names could not be used safely; they are never extracted. */
  hidden_entries: number;
  total_size: number;
  packed_size: number;
  /** The archive is damaged after the entries that could be read. */
  partial: boolean;
  /** This is one of the app's own copies, made when a file was opened. */
  temporary: boolean;
}

/** One row inside an archive. `path` is the path inside the archive, not a
 * path on disk. */
export interface ArchiveItem {
  path: string;
  name: string;
  kind: ArchiveEntryKind;
  size: number;
  packed_size: number;
  modified_unix: number;
  encrypted: boolean;
}

export interface ArchiveFolderPage {
  items: ArchiveItem[];
  total: number;
  truncated: boolean;
}

/** Something an extraction left out, and why (`errors.archive.<reason>`). */
export interface ArchiveSkippedEntry {
  path: string;
  reason: string;
}

export interface ArchiveExtractReport {
  created: string[];
  files_written: number;
  folders_created: number;
  skipped: ArchiveSkippedEntry[];
  skipped_more: number;
  cancelled: boolean;
  /** The written file when one file was opened instead of extracted. */
  opened: string | null;
  /** Why items were created but the work stopped (the app adds it). */
  error: string | null;
}

/** Mirrors Rust `ExtractArgs`. */
export interface ArchiveExtractRequest {
  archive: string;
  paths: string[];
  base: string;
  dest_dir: string;
  new_folder: string | null;
  expected_size: number;
  expected_modified: number;
}

/** Mirrors Rust `OpenEntryArgs`. */
export interface OpenEntryRequest {
  archive: string;
  inner_path: string;
  expected_size: number;
  expected_modified: number;
}

export interface OpenedEntry {
  path: string;
}

/** Read an archive and keep it open for browsing. The job's result is the
 * summary; cancel asks the helper to stop. */
export async function archiveOpen(
  path: string,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<ArchiveSummary>> {
  return runJob<ArchiveSummary>(
    "arcopen",
    async (requestId) => {
      await invoke("archive_open_start", { requestId, path });
    },
    onProgress,
  );
}

export async function archiveFolder(
  session: string,
  folder: string,
  sortKey: string,
  sortDirection: string,
): Promise<ArchiveFolderPage> {
  if (!isTauriRuntime()) throw new Error("archive.other");
  return (await invoke("archive_folder", {
    session,
    folder,
    sortKey,
    sortDirection,
  })) as ArchiveFolderPage;
}

export async function archiveSearch(session: string, text: string): Promise<ArchiveFolderPage> {
  if (!isTauriRuntime()) throw new Error("archive.other");
  return (await invoke("archive_search", { session, text })) as ArchiveFolderPage;
}

/** Forget an open archive. A session that is already gone is not an error. */
export async function archiveClose(session: string): Promise<void> {
  try {
    await invoke("archive_close", { session });
  } catch {
    // The session was already dropped (the app keeps eight).
  }
}

/** Copy one file out of an archive and open it. The completion's path is a
 * real path on disk, ready for a file tab. */
export async function archiveOpenEntry(
  request: OpenEntryRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<OpenedEntry>> {
  const job = await runJob<OpenedEntry>(
    "arcentry",
    async (requestId) => {
      await invoke("archive_open_entry_start", { requestId, request });
    },
    onProgress,
  );
  return {
    id: job.id,
    cancel: job.cancel,
    completion: job.completion.then((opened) => ({ path: displayPath(opened.path) })),
  };
}

/** Extract as a job; the completion's paths are real paths on disk. */
export async function archiveExtract(
  request: ArchiveExtractRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<ArchiveExtractReport>> {
  const job = await runJob<ArchiveExtractReport>(
    "arcextract",
    async (requestId) => {
      await invoke("archive_extract_start", { requestId, request });
    },
    onProgress,
  );
  return {
    id: job.id,
    cancel: job.cancel,
    completion: job.completion.then((report) => ({
      ...report,
      created: (report.created ?? []).map(displayPath),
      skipped: (report.skipped ?? []).map((skip) => ({
        path: displayPath(skip.path).replace(/\//g, "\\"),
        reason: skip.reason,
      })),
    })),
  };
}

/** Ask where to extract; null when the user cancels the dialog. */
export async function archivePickFolder(title: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const chosen = (await invoke("archive_pick_folder", { title })) as string | null;
  return chosen === null ? null : displayPath(chosen);
}
