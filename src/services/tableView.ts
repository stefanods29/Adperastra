import { invoke } from "@tauri-apps/api/core";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";

/** Tables (Step 06f): open a CSV or TSV file, build one row order per sort
 * or filter, and read pages of cells. Mirrors src-tauri/src/data_views.rs and
 * crates/data-views. The file never changes. */

export type TextEncodingId = "utf8" | "utf16_le" | "utf16_be" | "windows1252";

export type SortDirection = "ascending" | "descending";

/** Mirrors Rust `TableSummary` (snake_case fields, same names). */
export interface TableSummary {
  session: string;
  columns: number;
  rows: number;
  /** Reading stopped at a limit; the note says so (never silent). */
  truncated: boolean;
  /** The separator that was detected, as one character. */
  delimiter: string;
  encoding: TextEncodingId;
  has_header: boolean;
  /** The first row, cut like a cell. */
  headers: string[];
}

/** Mirrors Rust `TableViewRequest`. */
export interface TableViewRequest {
  sort_column: number | null;
  direction: SortDirection;
  has_header: boolean;
  filter: string;
}

/** Mirrors Rust `TableViewInfo`. */
export interface TableViewInfo {
  view: number;
  rows: number;
}

export async function tableOpen(
  path: string,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<TableSummary>> {
  return runJob<TableSummary>(
    "tblopen",
    (requestId) => invoke("table_open_start", { requestId, path }),
    onProgress,
  );
}

export async function tableView(
  session: string,
  request: TableViewRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<TableViewInfo>> {
  return runJob<TableViewInfo>(
    "tblview",
    (requestId) => invoke("table_view_start", { requestId, session, request }),
    onProgress,
  );
}

export async function tableRows(
  session: string,
  view: number,
  start: number,
  count: number,
): Promise<string[][]> {
  return (await invoke("table_rows", { session, view, start, count })) as string[][];
}

/** Closing a tab never fails the user: an unknown session is already closed. */
export async function tableClose(session: string): Promise<void> {
  try {
    await invoke("table_close", { session });
  } catch {
    // The session was evicted already.
  }
}
