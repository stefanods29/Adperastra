import { useCallback, useEffect, useRef, useState } from "react";
import type { OpProgress } from "../../services/fileops";
import {
  archiveClose,
  archiveFolder,
  archiveOpen,
  archiveSearch,
  type ArchiveFolderPage,
  type ArchiveSummary,
} from "../../services/archive";
import { errorCode } from "../../services/errors";
import type { JobHandle } from "../../services/jobs";
import type { SortDirection, SortKey } from "../../services/explorer";

/** Everything the archive tab asks of Rust (Step 06d D3): one open archive,
 * one folder at a time, search results, and a reload when the archive
 * changed. Answers for older requests are ignored. */

export type ArchivePhase =
  | { kind: "loading"; progress: OpProgress | null }
  | { kind: "ready"; summary: ArchiveSummary }
  | { kind: "error"; error: unknown }
  | { kind: "cancelled" };

export interface ArchiveSort {
  key: SortKey;
  direction: SortDirection;
}

export interface ArchiveSession {
  phase: ArchivePhase;
  /** Stop reading the archive. */
  cancelOpen: () => void;
  /** Read it again from the start (after a failure or a change). */
  reload: () => void;
  folder: string;
  setFolder: (folder: string) => void;
  sort: ArchiveSort;
  setSort: (key: SortKey) => void;
  page: ArchiveFolderPage | null;
  results: ArchiveFolderPage | null;
  /** Empty text clears the results. */
  search: (text: string) => void;
}

/** How long typing must pause before the archive is searched. */
export const SEARCH_DELAY_MS = 150;

export function useArchiveSession(path: string): ArchiveSession {
  const [phase, setPhase] = useState<ArchivePhase>({ kind: "loading", progress: null });
  const [folder, setFolderState] = useState("");
  const [sort, setSort] = useState<ArchiveSort>({ key: "name", direction: "ascending" });
  const [page, setPage] = useState<ArchiveFolderPage | null>(null);
  const [results, setResults] = useState<ArchiveFolderPage | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const sessionRef = useRef<string | null>(null);
  const openJobRef = useRef<JobHandle<ArchiveSummary> | null>(null);
  const folderRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchTimer = useRef<number | null>(null);
  const reopened = useRef(false);

  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);
  const cancelOpen = useCallback(() => {
    void openJobRef.current?.cancel();
  }, []);

  // Read the archive once; a reload closes the old session first.
  useEffect(() => {
    let cancelled = false;
    const previous = sessionRef.current;
    sessionRef.current = null;
    if (previous) void archiveClose(previous);
    reopened.current = false;
    setPhase({ kind: "loading", progress: null });
    setFolderState("");
    setPage(null);
    setResults(null);
    void (async () => {
      try {
        const job = await archiveOpen(path, (progress) => {
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
        setPhase({ kind: "ready", summary });
      } catch (error) {
        openJobRef.current = null;
        if (cancelled) return;
        if (errorCode(error) === "archive.cancelled") setPhase({ kind: "cancelled" });
        else setPhase({ kind: "error", error });
      }
    })();
    return () => {
      cancelled = true;
      void openJobRef.current?.cancel();
    };
  }, [path, reloadNonce]);

  const session = phase.kind === "ready" ? phase.summary.session : null;

  // One folder at a time; the previous page stays until the next arrives.
  useEffect(() => {
    if (!session) return;
    folderRequest.current += 1;
    const request = folderRequest.current;
    void (async () => {
      try {
        const next = await archiveFolder(session, folder, sort.key, sort.direction);
        if (folderRequest.current !== request) return;
        setPage(next);
      } catch (error) {
        if (folderRequest.current !== request) return;
        const code = errorCode(error);
        if (code === "archive.no_session" && !reopened.current) {
          // The app keeps eight sessions: read the archive once more.
          reopened.current = true;
          setReloadNonce((value) => value + 1);
        } else if (code === "archive.bad_request") {
          setFolderState("");
          setPage(null);
        }
      }
    })();
  }, [session, folder, sort.key, sort.direction]);

  const search = useCallback((text: string) => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      searchRequest.current += 1;
      setResults(null);
      return;
    }
    const id = sessionRef.current;
    if (!id) return;
    searchTimer.current = window.setTimeout(() => {
      searchTimer.current = null;
      searchRequest.current += 1;
      const request = searchRequest.current;
      void archiveSearch(id, trimmed)
        .then((next) => {
          if (searchRequest.current === request) setResults(next);
        })
        .catch(() => undefined);
    }, SEARCH_DELAY_MS);
  }, []);

  // Closing the tab closes the session (plan/pitfalls.md P-28).
  useEffect(
    () => () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void archiveClose(id);
    },
    [],
  );

  const setFolder = useCallback((next: string) => {
    setFolderState(next);
    setResults(null);
  }, []);

  const changeSort = useCallback((key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
        : { key, direction: "ascending" },
    );
  }, []);

  return {
    phase,
    cancelOpen,
    reload,
    folder,
    setFolder,
    sort,
    setSort: changeSort,
    page,
    results,
    search,
  };
}
