import { invoke } from "@tauri-apps/api/core";
import type { CacheLease, SourceStamp } from "./cache";
import type { FileTypeInfo } from "./files";
import { runJob, type JobHandle } from "./jobs";

/** Read-only extra viewers (Step 07f, interface `extra-viewers-1`):
 * e-books, notebooks, email, subtitles, logs and SQLite. Mirrors
 * `src-tauri/src/extra_view_types.rs` and the `data-views` parser modules.
 * No function here executes file content, and every request is bound to one
 * native session and its source revision. */

export type ExtraViewKind = "book" | "notebook" | "email" | "subtitle" | "log" | "sqlite";

export const EXTRA_VIEW_KINDS: readonly ExtraViewKind[] = [
  "book",
  "notebook",
  "email",
  "subtitle",
  "log",
  "sqlite",
];

/** One page never exceeds this serialized size (D5, P-10). */
export const MAX_PAGE_BYTES = 768 * 1024;
/** One page never carries more records than this (D5). */
export const MAX_PAGE_RECORDS = 256;
/** One text chunk inside a page. */
export const MAX_TEXT_CHUNK_CHARS = 64 * 1024;
/** One sanitized markup block. */
export const MAX_HTML_CHARS = 256 * 1024;
/** Live cursors one session may have. */
export const MAX_LIVE_CURSORS = 64;

/** Source caps mirrored from Rust `extra_view_types.rs` (handler maxBytes). */
export const MAX_BOOK_SOURCE_BYTES = 256 * 1024 * 1024;
export const MAX_NOTEBOOK_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_EMAIL_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_SUBTITLE_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_SQLITE_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
/** Logs are read by ranges; the native cap is 1 TiB. */
export const MAX_LOG_SOURCE_BYTES = 1024 * 1024 * 1024 * 1024;

export interface ExtraViewSession {
  session_id: string;
  source: SourceStamp;
  kind: ExtraViewKind;
  title: string;
  item_count: number;
  partial: boolean;
}

export type BookDirection = "ltr" | "rtl";

export interface BookContentsItem {
  id: string;
  label: string;
  section: number;
  children: BookContentsItem[];
}

export interface BookPage {
  section: number;
  page: number;
  page_count: number;
  html: string;
  resource_refs: CacheLease[];
  contents: BookContentsItem[];
  direction: BookDirection;
}

export interface BookContentsPage {
  items: BookContentsItem[];
  next_cursor: string | null;
  complete: boolean;
}

export type NotebookCellKind = "markdown" | "code" | "raw";
export type NotebookOutputKind = "text" | "html" | "image" | "error";

export interface NotebookOutput {
  kind: NotebookOutputKind;
  text: string | null;
  image: CacheLease | null;
  html: string | null;
}

export interface NotebookCell {
  index: number;
  kind: NotebookCellKind;
  source: string;
  language: string;
  outputs: NotebookOutput[];
  next_source_offset: number | null;
}

export interface EmailSummary {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string | null;
  plain_text: string;
  html: string | null;
  attachment_count: number;
}

export interface EmailAddress {
  name: string;
  address: string;
}

export interface EmailAttachment {
  id: string;
  name: string;
  mime: string;
  byte_len: number;
}

export interface SubtitleCue {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "none";

export interface LogRecord {
  line: string;
  byte_offset: string;
  level: LogLevel;
  text: string;
  truncated: boolean;
}

export interface SqliteColumn {
  name: string;
  declared_type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface SqliteTableInfo {
  name: string;
  columns: SqliteColumn[];
}

export type SqliteCell =
  | { kind: "null" }
  | { kind: "text"; value: string; truncated: boolean }
  | { kind: "integer"; value: string }
  | { kind: "real"; value: string }
  | { kind: "blob"; blob_size: string; preview_hex: string };

export type SqliteRow = SqliteCell[];

export type ExtraViewPayload =
  | { kind: "book"; page: BookPage }
  | { kind: "notebook"; cells: NotebookCell[] }
  | { kind: "email"; message: EmailSummary | null; attachments: EmailAttachment[] }
  | { kind: "subtitle"; cues: SubtitleCue[] }
  | { kind: "log"; lines: LogRecord[] }
  | { kind: "sqlite"; table: SqliteTableInfo; rows: SqliteRow[] };

export interface ExtraViewPage {
  session_id: string;
  kind: ExtraViewKind;
  payload: ExtraViewPayload;
  next_cursor: string | null;
  complete: boolean;
  partial: boolean;
}

export type SortDirection = "asc" | "desc";

export interface ExtraPageRequest {
  session_id: string;
  cursor?: string | null;
  table?: string | null;
  section?: number | null;
  page?: number | null;
  sort_column?: number | null;
  sort_direction?: SortDirection | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throws `extra_view.bad_request` for an unknown kind. */
export function validateExtraViewKind(value: string): ExtraViewKind {
  if ((EXTRA_VIEW_KINDS as readonly string[]).includes(value)) {
    return value as ExtraViewKind;
  }
  throw new Error("extra_view.bad_request");
}

export function isExtraViewKind(value: unknown): value is ExtraViewKind {
  return typeof value === "string" && (EXTRA_VIEW_KINDS as readonly string[]).includes(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Pure request validation: kind-specific fields are refused, never ignored. */
export function validateExtraPageRequest(
  request: ExtraPageRequest,
  kind: ExtraViewKind,
): ExtraPageRequest {
  if (!isUuid(request.session_id)) throw new Error("extra_view.bad_request");
  if (request.cursor != null && request.cursor !== "" && !isUuid(request.cursor)) {
    throw new Error("extra_view.bad_request");
  }
  const sqliteField =
    request.table != null || request.sort_column != null || request.sort_direction != null;
  if (sqliteField && kind !== "sqlite") throw new Error("extra_view.bad_request");
  const bookField = request.section != null || request.page != null;
  if (bookField && kind !== "book") throw new Error("extra_view.bad_request");
  if (request.sort_column != null && (!Number.isInteger(request.sort_column) || request.sort_column < 0)) {
    throw new Error("extra_view.bad_request");
  }
  if (request.page != null && (!Number.isInteger(request.page) || request.page < 0)) {
    throw new Error("extra_view.bad_request");
  }
  if (request.section != null && (!Number.isInteger(request.section) || request.section < 0)) {
    throw new Error("extra_view.bad_request");
  }
  return request;
}

/** Pure: take at most `maxRecords` items and at most `maxBytes` measured
 * bytes. An item larger than the whole budget goes on one page by itself so
 * the caller still gets a continuation instead of an endless request. */
export function takePage<T>(
  items: readonly T[],
  measure: (item: T) => number,
  maxBytes: number = MAX_PAGE_BYTES,
  maxRecords: number = MAX_PAGE_RECORDS,
): { items: T[]; rest: T[] } {
  const page: T[] = [];
  let bytes = 0;
  let index = 0;
  while (index < items.length && page.length < maxRecords) {
    const size = Math.max(0, measure(items[index]));
    if (page.length > 0 && bytes + size > maxBytes) break;
    page.push(items[index]);
    bytes += size;
    index += 1;
    if (bytes > maxBytes) break;
  }
  return { items: page, rest: items.slice(index) };
}

/** The handler kind for a detected file, or null. A `.db` file opens here
 * only when its content was recognized as SQLite (T7). */
export function extraViewKindFor(
  info: Pick<FileTypeInfo, "ext" | "mime">,
): ExtraViewKind | null {
  const ext = info.ext.toLowerCase();
  if (ext === "epub" || ext === "mobi" || ext === "azw3") return "book";
  if (ext === "ipynb") return "notebook";
  if (ext === "eml") return "email";
  if (ext === "srt" || ext === "vtt") return "subtitle";
  if (ext === "log") return "log";
  if (ext === "sqlite" || ext === "sqlite3") return "sqlite";
  if (ext === "db") {
    return info.mime === "application/vnd.sqlite3" || info.mime === "application/x-sqlite3"
      ? "sqlite"
      : null;
  }
  if (info.mime === "application/epub+zip" || info.mime === "application/x-mobipocket-ebook") {
    return "book";
  }
  if (info.mime === "application/x-ipynb+json") return "notebook";
  if (info.mime === "message/rfc822") return "email";
  if (info.mime === "application/x-subrip" || info.mime === "text/vtt") return "subtitle";
  if (info.mime === "application/vnd.sqlite3" || info.mime === "application/x-sqlite3") {
    return "sqlite";
  }
  return null;
}

/** Open a file in a native extra-view session; the job resolves with the
 * session summary once the parser has accepted the source. */
export async function openExtraView(
  path: string,
  kind: ExtraViewKind,
): Promise<JobHandle<ExtraViewSession>> {
  const checked = validateExtraViewKind(kind);
  return runJob<ExtraViewSession>("xvopen", (requestId) =>
    invoke("extra_view_open_start", { requestId, path, kind: checked }),
  );
}

/** One bounded page. Generic ids are checked here; the session's kind and
 * every kind-specific field are checked again in Rust (E3). */
export async function extraViewPage(request: ExtraPageRequest): Promise<ExtraViewPage> {
  if (!isUuid(request.session_id)) throw new Error("extra_view.bad_request");
  if (request.cursor != null && request.cursor !== "" && !isUuid(request.cursor)) {
    throw new Error("extra_view.bad_request");
  }
  return (await invoke("extra_view_page", { request })) as ExtraViewPage;
}

/** Close a session. Unknown or already-closed sessions succeed (E4). */
export async function closeExtraView(sessionId: string): Promise<void> {
  try {
    await invoke("extra_view_close", { sessionId });
  } catch {
    // The session was evicted or the tab closed twice.
  }
}

/** Explicitly open one saved attachment. Nothing is extracted before the
 * user chooses this (D5). The result is an app-owned opened copy. */
export async function openEmailAttachment(
  sessionId: string,
  attachmentId: string,
): Promise<JobHandle<string>> {
  if (!isUuid(sessionId) || !isUuid(attachmentId)) {
    throw new Error("extra_view.bad_request");
  }
  return runJob<string>("xvattach", (requestId) =>
    invoke("extra_view_attachment_start", { requestId, sessionId, attachmentId }),
  );
}

/** The bounded physical-table list of a SQLite session. This is an additive
 * companion to E3 (the table picker cannot be built from a single page). */
export async function sqliteTables(sessionId: string): Promise<SqliteTableInfo[]> {
  if (!isUuid(sessionId)) throw new Error("extra_view.bad_request");
  return (await invoke("extra_view_sqlite_tables", { sessionId })) as SqliteTableInfo[];
}

/** The subtitle cue page (E6). Later media steps import these same times. */
export async function subtitleCues(
  sessionId: string,
  cursor?: string | null,
): Promise<ExtraViewPage> {
  if (!isUuid(sessionId)) throw new Error("extra_view.bad_request");
  if (cursor != null && !isUuid(cursor)) throw new Error("extra_view.bad_request");
  return (await invoke("extra_view_subtitles", { sessionId, cursor: cursor ?? null })) as ExtraViewPage;
}

/** One page of the e-book table of contents (E7). */
export async function bookContents(
  sessionId: string,
  cursor?: string | null,
): Promise<BookContentsPage> {
  if (!isUuid(sessionId)) throw new Error("extra_view.bad_request");
  if (cursor != null && !isUuid(cursor)) throw new Error("extra_view.bad_request");
  return (await invoke("extra_view_book_contents", {
    sessionId,
    cursor: cursor ?? null,
  })) as BookContentsPage;
}
