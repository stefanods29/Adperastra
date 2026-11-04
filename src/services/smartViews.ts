import { invoke } from "@tauri-apps/api/core";
import type { JobHandle } from "./jobs";
import { runJob } from "./jobs";
import type { FileIdentityKey } from "./fileIdentity";
import type { SearchFilter, SearchQuery, SearchResult } from "./search";

/** Typed smart folders and indexed views (Step 11b E4). Native commands are
 * only called from this service; the views use these wrappers. */

export type IndexedView = "timeline" | "calendar" | "by_kind" | "recent_activity" | "map";
export type DateSource = "modified" | "created" | "date_taken";
export type ViewGroup = "day" | "week" | "month" | "year";
export type ViewKind =
  | "documents"
  | "spreadsheets"
  | "presentations"
  | "pdf"
  | "images"
  | "video"
  | "audio"
  | "archives"
  | "code"
  | "other";

export const VIEW_KINDS: readonly ViewKind[] = [
  "documents",
  "spreadsheets",
  "presentations",
  "pdf",
  "images",
  "video",
  "audio",
  "archives",
  "code",
  "other",
];

export const VIEW_GROUP_LABEL_KEYS: Readonly<Record<ViewGroup, string>> = {
  day: "views.day",
  week: "views.week",
  month: "views.month",
  year: "views.year",
};

/** The 11a filter labels already name these three dates in both languages. */
export const DATE_SOURCE_LABEL_KEYS: Readonly<Record<DateSource, string>> = {
  modified: "search.fieldModified",
  created: "search.fieldCreated",
  date_taken: "search.fieldDateTaken",
};

export const INDEXED_VIEW_LABEL_KEYS: Readonly<Record<IndexedView, string>> = {
  timeline: "views.timeline",
  calendar: "views.calendar",
  by_kind: "views.byKind",
  recent_activity: "views.activity",
  map: "views.map",
};

export const VIEW_KIND_LABEL_KEYS: Readonly<Record<ViewKind, string>> = {
  documents: "views.kindDocuments",
  spreadsheets: "views.kindSpreadsheets",
  presentations: "views.kindPresentations",
  pdf: "views.kindPdf",
  images: "views.kindImages",
  video: "views.kindVideo",
  audio: "views.kindAudio",
  archives: "views.kindArchives",
  code: "views.kindCode",
  other: "views.kindOther",
};

export interface SmartFolder {
  id: string;
  name: string;
  saved_search_id: string;
  created_unix: number;
  modified_unix: number;
}

export interface IndexedViewQuery {
  view: IndexedView;
  query: SearchQuery;
  date_source?: DateSource;
  group?: ViewGroup;
  month?: string | null;
  kind?: ViewKind | null;
  cursor?: string | null;
}

export interface ViewBucket {
  id: string;
  label_key?: string | null;
  date_from_unix?: number | null;
  date_to_unix?: number | null;
  count: number;
  total_bytes: number;
}

export interface IndexedViewPage {
  buckets: ViewBucket[];
  results: SearchResult[];
  next_cursor?: string | null;
  complete: boolean;
  generation: number;
}

export interface EnabledViews {
  timeline: boolean;
  calendar: boolean;
  by_kind: boolean;
  recent_activity: boolean;
  map: boolean;
}

export interface ViewsSettings {
  enabled_views: EnabledViews;
  date_source: DateSource;
  activity_enabled: boolean;
  map_online_enabled: boolean;
  write_embedded_tags: boolean;
}

export const DEFAULT_ENABLED_VIEWS: EnabledViews = {
  timeline: true,
  calendar: true,
  by_kind: true,
  recent_activity: true,
  map: false,
};

export const DEFAULT_VIEWS_SETTINGS: ViewsSettings = {
  enabled_views: DEFAULT_ENABLED_VIEWS,
  date_source: "modified",
  activity_enabled: true,
  map_online_enabled: false,
  write_embedded_tags: false,
};

const DATE_SOURCES: readonly DateSource[] = ["modified", "created", "date_taken"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Pure: every `views` field falls back independently when missing or
 * invalid, so a corrupt section never resets the other settings. */
export function normalizeViewsSettings(input: unknown): ViewsSettings {
  const defaults = DEFAULT_VIEWS_SETTINGS;
  const enabledInput = isRecord(input) && isRecord(input.enabled_views) ? input.enabled_views : {};
  const source = isRecord(input) ? input : {};
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    enabled_views: {
      timeline: flag(enabledInput.timeline, defaults.enabled_views.timeline),
      calendar: flag(enabledInput.calendar, defaults.enabled_views.calendar),
      by_kind: flag(enabledInput.by_kind, defaults.enabled_views.by_kind),
      recent_activity: flag(
        enabledInput.recent_activity,
        defaults.enabled_views.recent_activity,
      ),
      map: flag(enabledInput.map, defaults.enabled_views.map),
    },
    date_source: DATE_SOURCES.includes(source.date_source as DateSource)
      ? (source.date_source as DateSource)
      : defaults.date_source,
    activity_enabled: flag(source.activity_enabled, defaults.activity_enabled),
    map_online_enabled: flag(source.map_online_enabled, defaults.map_online_enabled),
    write_embedded_tags: flag(source.write_embedded_tags, defaults.write_embedded_tags),
  };
}

/** The view never accepts a drop or paste: a smart query has no write path. */
export function indexedViewDropTarget(_request: IndexedViewQuery): null {
  return null;
}

export async function listSmartFolders(): Promise<SmartFolder[]> {
  return (await invoke("smart_folders_list")) as SmartFolder[];
}

export async function saveSmartFolder(folder: SmartFolder): Promise<SmartFolder> {
  return (await invoke("smart_folder_save", { folder })) as SmartFolder;
}

export async function removeSmartFolder(id: string, removeSavedQuery = false): Promise<void> {
  await invoke("smart_folder_remove", { id, removeSavedQuery });
}

export async function queryIndexedView(
  request: IndexedViewQuery,
): Promise<JobHandle<IndexedViewPage>> {
  return runJob<IndexedViewPage>("indexedview", (requestId) =>
    invoke("indexed_view_start", { requestId, request }),
  );
}

// ---------------------------------------------------------------------------
// Recent activity (E5, decision 8)
// ---------------------------------------------------------------------------

export type ActivityKind = "open" | "edit" | "convert" | "move" | "download";

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "open",
  "edit",
  "convert",
  "move",
  "download",
];

export const ACTIVITY_LABEL_KEYS: Readonly<Record<ActivityKind, string>> = {
  open: "views.actionOpen",
  edit: "views.actionEdit",
  convert: "views.actionConvert",
  move: "views.actionMove",
  download: "views.actionDownload",
};

/** One action the app itself finished and recorded. There is no write path:
 * only native commit sites may append, never this service. */
export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  key?: FileIdentityKey | null;
  path: string;
  dest_path?: string | null;
  created_unix: number;
  operation_id?: string | null;
}

export interface ActivityPage {
  events: ActivityEvent[];
  next_cursor?: string | null;
  complete: boolean;
}

export interface ActivityStatus {
  paused: boolean;
}

export async function listActivity(cursor?: string | null): Promise<ActivityPage> {
  return (await invoke("activity_list", { cursor: cursor ?? null })) as ActivityPage;
}

export async function clearActivity(): Promise<void> {
  await invoke("activity_clear");
}

export async function getActivityStatus(): Promise<ActivityStatus> {
  return (await invoke("activity_status")) as ActivityStatus;
}

export async function setActivityPaused(paused: boolean): Promise<ActivityStatus> {
  return (await invoke("activity_set_paused", { paused })) as ActivityStatus;
}

// ---------------------------------------------------------------------------
// Pure local-calendar helpers
// ---------------------------------------------------------------------------

export interface CalendarCell {
  /** Local `YYYY-MM-DD`. */
  key: string;
  day: number;
  in_month: boolean;
}

export interface LocalMonth {
  year: number;
  /** 0-11, like `Date.getMonth()`. */
  month_index: number;
}

export function parseLocalMonth(month: string): LocalMonth | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  if (year < 1601 || year > 9998 || monthNumber < 1 || monthNumber > 12) return null;
  return { year, month_index: monthNumber - 1 };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function localDateKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localMonthKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}`;
}

export function localYear(unixSeconds: number): number {
  return new Date(unixSeconds * 1000).getFullYear();
}

/** Local midnight to one second before the next local month. `null` means the
 * string is not a calendar month. */
export function monthBounds(month: string): { from_unix: number; to_unix: number } | null {
  const parsed = parseLocalMonth(month);
  if (!parsed) return null;
  const start = new Date(2000, 0, 1, 0, 0, 0, 0);
  start.setFullYear(parsed.year, parsed.month_index, 1);
  const end = new Date(start.getTime());
  end.setFullYear(parsed.year, parsed.month_index + 1, 1);
  return {
    from_unix: Math.floor(start.getTime() / 1000),
    to_unix: Math.floor(end.getTime() / 1000) - 1,
  };
}

/** 0 = Sunday, 1 = Monday. `system` asks the WebView's locale information. */
export function resolveWeekStart(setting: "system" | "monday" | "sunday"): 0 | 1 {
  if (setting === "monday") return 1;
  if (setting === "sunday") return 0;
  try {
    const language = typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
    const locale = new Intl.Locale(language) as Intl.Locale & {
      weekInfo?: { firstDay?: number };
    };
    return locale.weekInfo?.firstDay === 7 ? 0 : 1;
  } catch {
    return 0;
  }
}

export function startOfLocalWeek(unixSeconds: number, weekStart: 0 | 1): number {
  const date = new Date(unixSeconds * 1000);
  const offset = (date.getDay() - weekStart + 7) % 7;
  date.setDate(date.getDate() - offset);
  return Math.floor(date.getTime() / 1000);
}

/** One local day, from midnight to one second before the next midnight. */
export function dayBounds(key: string): { from_unix: number; to_unix: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1601 || year > 9998 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = new Date(2000, 0, 1, 0, 0, 0, 0);
  start.setFullYear(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return null;
  }
  const end = new Date(start.getTime());
  end.setDate(start.getDate() + 1);
  return {
    from_unix: Math.floor(start.getTime() / 1000),
    to_unix: Math.floor(end.getTime() / 1000) - 1,
  };
}

/** Compose one extra clause without replacing an existing filter AST. */
export function addFilter(
  filter: SearchFilter | null | undefined,
  extra: SearchFilter,
): SearchFilter {
  if (!filter) return extra;
  if (filter.kind === "all" && filter.clauses.length < 31) {
    return { kind: "all", clauses: [...filter.clauses, extra] };
  }
  return { kind: "all", clauses: [filter, extra] };
}

/** Column labels in the current week order. */
export function weekdayLabels(locale: string, weekStart: 0 | 1): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const sunday = new Date(2024, 0, 7, 12, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday.getTime());
    date.setDate(sunday.getDate() + ((index + weekStart) % 7));
    return formatter.format(date);
  });
}

/** The bucket id a row belongs to; 0/negative timestamps are undated. */
export function timelineBucketId(
  unixSeconds: number,
  group: ViewGroup,
  weekStart: 0 | 1,
): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "undated";
  if (group === "year") return String(localYear(unixSeconds));
  if (group === "month") return localMonthKey(unixSeconds);
  if (group === "week") return localDateKey(startOfLocalWeek(unixSeconds, weekStart));
  return localDateKey(unixSeconds);
}

export function dateSourceUnix(result: SearchResult, source: DateSource): number {
  if (source === "created") return result.created_unix ?? 0;
  if (source === "date_taken") return result.date_taken_unix ?? 0;
  return result.item.modified_unix;
}

/** A 6x7 local month grid. The first cell is the local week start on or before
 * the first day of the month. */
export function calendarGrid(month: string, weekStart: 0 | 1): CalendarCell[] {
  const parsed = parseLocalMonth(month);
  const bounds = monthBounds(month);
  if (!parsed || !bounds) return [];
  const first = new Date(bounds.from_unix * 1000);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(first.getTime());
    date.setDate(first.getDate() - offset + index);
    cells.push({
      key: localDateKey(Math.floor(date.getTime() / 1000)),
      day: date.getDate(),
      in_month: date.getFullYear() === parsed.year && date.getMonth() === parsed.month_index,
    });
  }
  return cells;
}

/** Fold real day counts into week buckets; counts stay native, only their
 * grouping follows the PC's first-day-of-week setting. */
export function foldWeekBuckets(
  buckets: readonly ViewBucket[],
  weekStart: 0 | 1,
): ViewBucket[] {
  const folded = new Map<string, ViewBucket>();
  for (const bucket of buckets) {
    const from = bucket.date_from_unix;
    if (bucket.id === "undated" || from == null) continue;
    const id = timelineBucketId(from, "week", weekStart);
    const existing = folded.get(id);
    if (existing) {
      existing.count += bucket.count;
      existing.total_bytes += bucket.total_bytes;
      existing.date_from_unix = Math.min(existing.date_from_unix ?? from, from);
      existing.date_to_unix = Math.max(
        existing.date_to_unix ?? bucket.date_to_unix ?? from,
        bucket.date_to_unix ?? from,
      );
    } else {
      folded.set(id, { ...bucket, id });
    }
  }
  return [...folded.values()].sort(
    (left, right) => (left.date_from_unix ?? 0) - (right.date_from_unix ?? 0),
  );
}

export function undatedBucket(buckets: readonly ViewBucket[]): ViewBucket | null {
  return buckets.find((bucket) => bucket.id === "undated") ?? null;
}

/** A display label for a native bucket; `undated` has none on purpose. */
export function bucketLabel(bucket: ViewBucket, group: ViewGroup, locale: string): string {
  if (bucket.id === "undated") return "";
  const unix = bucket.date_from_unix ?? 0;
  const date = new Date(unix * 1000);
  if (group === "year") return String(date.getFullYear());
  if (group === "month") {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
