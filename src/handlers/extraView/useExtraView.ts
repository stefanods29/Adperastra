import { useCallback, useEffect, useRef, useState } from "react";
import { releaseCacheLease } from "../../services/cache";
import { errorCode } from "../../services/errors";
import {
  closeExtraView,
  extraViewPage,
  openExtraView,
  type ExtraPageRequest,
  type ExtraViewKind,
  type ExtraViewPage,
  type ExtraViewSession,
} from "../../services/extraViews";
import type { JobHandle } from "../../services/jobs";

/** One read-only extra-view session owned by a file tab (Step 07f). It opens
 * once, ignores late pages from an older revision, and closes the native
 * session with the tab (P-28). `previewOnly` never changes this path: there is
 * no editor or save handle to register. */
export interface ExtraViewState {
  phase: "loading" | "ready" | "error" | "cancelled";
  session: ExtraViewSession | null;
  page: ExtraViewPage | null;
  error: unknown;
  loadingPage: boolean;
  reload: () => void;
  cancelOpen: () => void;
  request: (request: Omit<ExtraPageRequest, "session_id">) => Promise<ExtraViewPage | null>;
  setPage: (page: ExtraViewPage) => void;
}

function pageLeaseIds(page: ExtraViewPage): string[] {
  if (page.payload.kind === "book") {
    return page.payload.page.resource_refs.map((lease) => lease.lease_id);
  }
  // Notebook pages are appended in the UI, so every image lease stays until
  // the native session closes and releases its whole set.
  return [];
}

function releaseUnused(previous: ExtraViewPage | null, next: ExtraViewPage): void {
  if (!previous) return;
  const keep = new Set(pageLeaseIds(next));
  for (const id of pageLeaseIds(previous)) {
    if (!keep.has(id)) void releaseCacheLease(id);
  }
}

export function useExtraView(
  path: string,
  kind: ExtraViewKind,
  active: boolean,
  firstRequest: Omit<ExtraPageRequest, "session_id"> = {},
): ExtraViewState {
  const [phase, setPhase] = useState<ExtraViewState["phase"]>("loading");
  const [session, setSession] = useState<ExtraViewSession | null>(null);
  const [page, setPage] = useState<ExtraViewPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [nonce, setNonce] = useState(0);
  const sessionRef = useRef<ExtraViewSession | null>(null);
  const pageRef = useRef<ExtraViewPage | null>(null);
  const openJob = useRef<JobHandle<ExtraViewSession> | null>(null);
  const requestNumber = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const firstRequestRef = useRef(firstRequest);
  firstRequestRef.current = firstRequest;

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const cancelOpen = useCallback(() => {
    void openJob.current?.cancel();
  }, []);

  const request = useCallback(
    async (next: Omit<ExtraPageRequest, "session_id">): Promise<ExtraViewPage | null> => {
      const current = sessionRef.current;
      if (!current) return null;
      requestNumber.current += 1;
      const number = requestNumber.current;
      setLoadingPage(true);
      try {
        const answer = await extraViewPage({ ...next, session_id: current.session_id });
        if (requestNumber.current !== number || sessionRef.current?.session_id !== current.session_id) {
          return null;
        }
        if (answer.kind !== kind) return null;
        releaseUnused(pageRef.current, answer);
        pageRef.current = answer;
        setPage(answer);
        return answer;
      } catch (failure) {
        if (requestNumber.current !== number) return null;
        if (errorCode(failure) === "extra_view.changed") {
          setError(failure);
          setPhase("error");
        }
        return null;
      } finally {
        if (requestNumber.current === number) setLoadingPage(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    let cancelled = false;
    const previous = sessionRef.current;
    sessionRef.current = null;
    pageRef.current = null;
    setSession(null);
    setPage(null);
    setError(null);
    setPhase("loading");
    setLoadingPage(false);
    requestNumber.current += 1;
    if (previous) void closeExtraView(previous.session_id);
    void (async () => {
      try {
        const job = await openExtraView(path, kind);
        openJob.current = job;
        if (cancelled) {
          void job.cancel();
          return;
        }
        const opened = await job.completion;
        openJob.current = null;
        if (cancelled) return;
        sessionRef.current = opened;
        setSession(opened);
        setPhase("ready");
        if (activeRef.current) {
          await request(firstRequestRef.current);
        }
      } catch (failure) {
        openJob.current = null;
        if (cancelled) return;
        if (errorCode(failure) === "files.cancelled") {
          setPhase("cancelled");
          return;
        }
        setError(failure);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      void openJob.current?.cancel();
    };
  }, [path, kind, nonce, request]);

  // A tab that is no longer visible stops waiting for pages; a new visible
  // turn asks for the current page again only when none is loaded.
  useEffect(() => {
    if (active && phase === "ready" && page === null) {
      void request(firstRequestRef.current);
    }
    // The request is intentionally not a dependency: only visibility changes
    // should trigger this recovery request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase]);

  useEffect(
    () => () => {
      requestNumber.current += 1;
      const current = sessionRef.current;
      sessionRef.current = null;
      if (current) void closeExtraView(current.session_id);
    },
    [],
  );

  return {
    phase,
    session,
    page,
    error,
    loadingPage,
    reload,
    cancelOpen,
    request,
    setPage,
  };
}
