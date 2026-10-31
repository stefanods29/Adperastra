import { useCallback, useEffect, useRef, useState } from "react";
import { errorCode } from "../../services/errors";
import type { OpProgress } from "../../services/fileops";
import type { JobHandle } from "../../services/jobs";
import {
  tableClose,
  tableOpen,
  tableRows,
  tableView,
  type SortDirection,
  type TableSummary,
  type TableViewInfo,
} from "../../services/tableView";

/** The table tab's session (Step 06f): open the file once, build one row
 * order per sort or filter in Rust, and keep a small page cache. Answers for
 * older views are ignored, and the session closes with the tab (P-28). */

/** Rows one page asks Rust for. */
export const TABLE_PAGE_ROWS = 200;
/** How long typing must pause before the table is filtered. */
export const FILTER_DELAY_MS = 200;
/** The most pages kept in memory at once. */
const MAX_CACHED_PAGES = 20;

export interface TableSettings {
  has_header: boolean;
  sort_column: number | null;
  direction: SortDirection;
}

export type TablePhase =
  | { kind: "loading"; progress: OpProgress | null }
  | { kind: "ready"; summary: TableSummary }
  | { kind: "error"; error: unknown }
  | { kind: "cancelled" };

export interface TableSession {
  phase: TablePhase;
  settings: TableSettings;
  /** The view the rows belong to; grows with every sort or filter. */
  viewNumber: number;
  /** Rows in the current view, after the filter and the sort. */
  rowCount: number;
  /** A new row order is being built. */
  sorting: boolean;
  /** The text the filter currently uses (as typed). */
  filter: string;
  /** Changes whenever a page arrived, so the view redraws. */
  cacheVersion: number;
  /** Ask for the pages that hold these rows. */
  rowsBetween: (start: number, end: number) => void;
  /** One row from the cache, or null while its page loads. */
  rowAt: (index: number) => string[] | null;
  /** One whole cached page, or null while it loads. */
  page: (pageIndex: number) => string[][] | null;
  setHeader: (hasHeader: boolean) => void;
  cycleSort: (column: number) => void;
  setFilter: (text: string) => void;
  cancelOpen: () => void;
  reload: () => void;
}

/** The tab state the table saves (Step 06f T6.10). */
export function readTableState(state: unknown): Partial<TableSettings> {
  const value = (state ?? {}) as Partial<TableSettings>;
  const next: Partial<TableSettings> = {};
  if (typeof value.has_header === "boolean") next.has_header = value.has_header;
  if (typeof value.sort_column === "number" || value.sort_column === null) {
    next.sort_column = value.sort_column;
  }
  if (value.direction === "ascending" || value.direction === "descending") {
    next.direction = value.direction;
  }
  return next;
}

export function useTableSession(path: string, initial: Partial<TableSettings>): TableSession {
  const initialRef = useRef(initial);
  const [phase, setPhase] = useState<TablePhase>({ kind: "loading", progress: null });
  const [settings, setSettings] = useState<TableSettings>({
    has_header: initial.has_header ?? true,
    sort_column: initial.sort_column ?? null,
    direction: initial.direction ?? "ascending",
  });
  const [view, setView] = useState<TableViewInfo | null>(null);
  const [sorting, setSorting] = useState(false);
  const [filter, setFilterText] = useState("");
  const [cacheVersion, setCacheVersion] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const sessionRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const filterRef = useRef("");
  const readyRef = useRef(false);
  const openJobRef = useRef<JobHandle<TableSummary> | null>(null);
  const viewJobRef = useRef<JobHandle<TableViewInfo> | null>(null);
  const viewRequest = useRef(0);
  const filterTimer = useRef<number | null>(null);
  const reopened = useRef(false);
  const cacheRef = useRef<{ view: number; pages: Map<number, string[][]> }>({
    view: 0,
    pages: new Map(),
  });
  const loadingPages = useRef(new Set<number>());

  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);
  const cancelOpen = useCallback(() => {
    void openJobRef.current?.cancel();
  }, []);

  // Build one row order in Rust; a newer request makes the older answer old.
  const runView = useCallback((next: TableSettings, text: string) => {
    const session = sessionRef.current;
    if (!session) return;
    viewRequest.current += 1;
    const request = viewRequest.current;
    void viewJobRef.current?.cancel();
    setSorting(true);
    void (async () => {
      try {
        const job = await tableView(session, {
          sort_column: next.sort_column,
          direction: next.direction,
          has_header: next.has_header,
          filter: text,
        });
        if (viewRequest.current !== request) {
          void job.cancel();
          return;
        }
        viewJobRef.current = job;
        const info = await job.completion;
        if (viewRequest.current !== request) return;
        viewJobRef.current = null;
        cacheRef.current = { view: info.view, pages: new Map() };
        loadingPages.current.clear();
        setView(info);
        setSorting(false);
        setCacheVersion((value) => value + 1);
      } catch (error) {
        if (viewRequest.current !== request) return;
        viewJobRef.current = null;
        setSorting(false);
        const code = errorCode(error);
        if (code === "data.cancelled") return;
        if (code === "table.no_session" && !reopened.current) {
          reopened.current = true;
          setReloadNonce((value) => value + 1);
          return;
        }
        setPhase({ kind: "error", error });
      }
    })();
  }, []);

  // Read the file once; a reload closes the old session first.
  useEffect(() => {
    let cancelled = false;
    const previous = sessionRef.current;
    sessionRef.current = null;
    readyRef.current = false;
    if (previous) void tableClose(previous);
    if (filterTimer.current !== null) {
      window.clearTimeout(filterTimer.current);
      filterTimer.current = null;
    }
    reopened.current = false;
    setPhase({ kind: "loading", progress: null });
    setView(null);
    setSorting(false);
    cacheRef.current = { view: 0, pages: new Map() };
    loadingPages.current.clear();
    const open = async () => {
      const job = await tableOpen(path, (progress) => {
        if (!cancelled) setPhase({ kind: "loading", progress });
      });
      openJobRef.current = job;
      if (cancelled) {
        void job.cancel();
        return;
      }
      const summary = await job.completion;
      openJobRef.current = null;
      if (cancelled) return;
      sessionRef.current = summary.session;
      readyRef.current = true;
      const saved = initialRef.current;
      const next: TableSettings = {
        has_header: saved.has_header ?? summary.has_header,
        sort_column: saved.sort_column ?? null,
        direction: saved.direction ?? "ascending",
      };
      settingsRef.current = next;
      setSettings(next);
      setPhase({ kind: "ready", summary });
      runView(next, filterRef.current);
    };
    void open().catch((error: unknown) => {
      openJobRef.current = null;
      if (cancelled) return;
      if (errorCode(error) === "data.cancelled") setPhase({ kind: "cancelled" });
      else setPhase({ kind: "error", error });
    });
    return () => {
      cancelled = true;
      void openJobRef.current?.cancel();
    };
  }, [path, reloadNonce, runView]);

  const setFilter = useCallback(
    (text: string) => {
      if (text === filterRef.current) return;
      filterRef.current = text;
      setFilterText(text);
      if (filterTimer.current !== null) {
        window.clearTimeout(filterTimer.current);
        filterTimer.current = null;
      }
      filterTimer.current = window.setTimeout(() => {
        filterTimer.current = null;
        if (!readyRef.current) return;
        runView(settingsRef.current, filterRef.current);
      }, FILTER_DELAY_MS);
    },
    [runView],
  );

  const applySettings = useCallback(
    (next: TableSettings) => {
      settingsRef.current = next;
      setSettings(next);
      runView(next, filterRef.current);
    },
    [runView],
  );

  const setHeader = useCallback(
    (hasHeader: boolean) => applySettings({ ...settingsRef.current, has_header: hasHeader }),
    [applySettings],
  );

  const cycleSort = useCallback(
    (column: number) => {
      const current = settingsRef.current;
      if (current.sort_column !== column) {
        applySettings({ ...current, sort_column: column, direction: "ascending" });
      } else if (current.direction === "ascending") {
        applySettings({ ...current, direction: "descending" });
      } else {
        applySettings({ ...current, sort_column: null, direction: "ascending" });
      }
    },
    [applySettings],
  );

  const rowAt = useCallback((index: number) => {
    const page = cacheRef.current.pages.get(Math.floor(index / TABLE_PAGE_ROWS));
    return page ? (page[index % TABLE_PAGE_ROWS] ?? null) : null;
  }, []);

  const page = useCallback((pageIndex: number) => {
    return cacheRef.current.pages.get(pageIndex) ?? null;
  }, []);

  const rowsBetween = useCallback((start: number, end: number) => {
    const session = sessionRef.current;
    const cache = cacheRef.current;
    if (!session || cache.view === 0 || end <= start) return;
    const first = Math.floor(start / TABLE_PAGE_ROWS);
    const last = Math.floor((end - 1) / TABLE_PAGE_ROWS);
    for (let pageIndex = first; pageIndex <= last; pageIndex += 1) {
      if (cache.pages.has(pageIndex) || loadingPages.current.has(pageIndex)) continue;
      loadingPages.current.add(pageIndex);
      const captured = cache.view;
      void tableRows(session, captured, pageIndex * TABLE_PAGE_ROWS, TABLE_PAGE_ROWS)
        .then((rows) => {
          loadingPages.current.delete(pageIndex);
          if (cacheRef.current.view !== captured) return;
          cacheRef.current.pages.set(pageIndex, rows);
          while (cacheRef.current.pages.size > MAX_CACHED_PAGES) {
            const oldest = cacheRef.current.pages.keys().next().value;
            if (oldest === undefined) break;
            cacheRef.current.pages.delete(oldest);
          }
          setCacheVersion((value) => value + 1);
        })
        .catch((error: unknown) => {
          loadingPages.current.delete(pageIndex);
          if (errorCode(error) === "table.no_session" && !reopened.current) {
            reopened.current = true;
            setReloadNonce((value) => value + 1);
          }
        });
    }
  }, []);

  // Closing the tab closes the session and stops the timers.
  useEffect(
    () => () => {
      if (filterTimer.current !== null) window.clearTimeout(filterTimer.current);
      void viewJobRef.current?.cancel();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void tableClose(session);
    },
    [],
  );

  return {
    phase,
    settings,
    viewNumber: view?.view ?? 0,
    rowCount: view?.rows ?? 0,
    sorting,
    filter,
    cacheVersion,
    rowsBetween,
    rowAt,
    page,
    setHeader,
    cycleSort,
    setFilter,
    cancelOpen,
    reload,
  };
}
