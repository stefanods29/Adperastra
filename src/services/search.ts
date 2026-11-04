import { invoke } from "@tauri-apps/api/core";
import type { ExplorerItem, SortSpec } from "./explorer";
import type { FileIdentityKey } from "./fileIdentity";
import { runJob, type JobHandle } from "./jobs";

/** Typed search index service (Step 11a E1-E3). Only this file calls the
 * search commands; components use these wrappers. */

export type SearchMode = "name" | "content" | "filters" | "regex";
export type RegexScope = "name" | "content";
export type SearchCoverage = "pending" | "partial" | "complete";
/** Native `IndexStatus` never reports `pending`; only a page may. */
export type IndexCoverage = Exclude<SearchCoverage, "pending">;

export interface IndexRoot {
  id: string;
  path: string;
  filename: boolean;
  content: boolean;
  ocr: boolean;
  enabled: boolean;
}

export interface SearchSettings {
  roots: IndexRoot[];
  default_mode: SearchMode;
  index_limit_mb: number;
  content_max_chars: number;
  usn_enabled: boolean;
  excluded_paths: string[];
}

export type SearchFilter =
  | { kind: "all"; clauses: SearchFilter[] }
  | { kind: "any"; clauses: SearchFilter[] }
  | { kind: "not"; clause: SearchFilter }
  | { kind: "string"; field: "kind" | "ext" | "author"; op: "eq" | "contains"; value: string }
  | {
      kind: "number";
      field: "size" | "width" | "height" | "duration_ms" | "pages";
      op: "eq" | "gte" | "lte";
      value: number;
    }
  | {
      kind: "date";
      field: "modified" | "created" | "date_taken";
      from_unix?: number;
      to_unix?: number;
    }
  | { kind: "ext_list"; values: string[]; exclude: boolean }
  | { kind: "missing_date"; field: "modified" | "created" | "date_taken" }
  | { kind: "tags"; tag_ids: string[]; match: "all" | "any" };

export interface SearchQuery {
  mode: SearchMode;
  text: string;
  roots: string[];
  filter?: SearchFilter | null;
  regex_scope: RegexScope;
  match_case: boolean;
  /** Optional indexed Timeline ordering; absent or null keeps `sort`. */
  sort_date?: "modified" | "created" | "date_taken" | null;
  sort: SortSpec;
}

export interface SearchResult {
  item: ExplorerItem;
  key: FileIdentityKey;
  found_by: SearchMode;
  snippet: string | null;
  content_truncated: boolean;
  metadata_available: boolean;
  created_unix: number;
  date_taken_unix: number | null;
}

export interface SearchPage {
  results: SearchResult[];
  next_cursor: string | null;
  generation: number;
  total_estimate: number;
  total_bytes: number;
  total_exact: boolean;
  complete: boolean;
  coverage: SearchCoverage;
  skipped_count: number;
}

export interface IndexStatus {
  generation: number;
  files_count: number;
  disk_bytes: number;
  running: boolean;
  paused: boolean;
  coverage: IndexCoverage;
  skipped_count: number;
  limit_reached: boolean;
  reason_code: string | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: SearchQuery;
  created_unix: number;
  modified_unix: number;
  version: number;
}

export {
  DEFAULT_SEARCH_SETTINGS,
  SEARCH_INDEX_LIMITS_MB,
  normalizeSearchSettings,
} from "../search/searchSettings";

/** Start a first-page search job. Cancel it through `cancelSearch`. */
export async function search(query: SearchQuery): Promise<JobHandle<SearchPage>> {
  return runJob<SearchPage>("search", (requestId) =>
    invoke("search_start", { requestId, query }),
  );
}

/** Continue from an opaque cursor. A changed generation rejects with
 * `search.changed`; the view then reloads the first page. */
export async function searchPage(cursor: string): Promise<JobHandle<SearchPage>> {
  return runJob<SearchPage>("search", (requestId) =>
    invoke("search_page_start", { requestId, cursor }),
  );
}

export async function cancelSearch(handle: JobHandle<unknown>): Promise<void> {
  await handle.cancel();
}

export async function getIndexStatus(): Promise<IndexStatus> {
  return (await invoke("index_status")) as IndexStatus;
}

export async function rebuildIndex(rootIds: readonly string[]): Promise<JobHandle<IndexStatus>> {
  return runJob<IndexStatus>("rebuild", (requestId) =>
    invoke("index_rebuild_start", { requestId, rootIds: [...rootIds] }),
  );
}

export async function pauseIndex(paused: boolean): Promise<IndexStatus> {
  return (await invoke("index_pause", { paused })) as IndexStatus;
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  return (await invoke("saved_searches_list")) as SavedSearch[];
}

export async function saveSearch(search: SavedSearch): Promise<SavedSearch> {
  return (await invoke("saved_search_save", { search })) as SavedSearch;
}

export async function removeSavedSearch(id: string): Promise<void> {
  await invoke("saved_search_remove", { id });
}
