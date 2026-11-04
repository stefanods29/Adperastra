import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobHandle } from "../services/jobs";
import {
  queryIndexedView,
  type IndexedViewPage,
  type IndexedViewQuery,
} from "../services/smartViews";

export interface IndexedViewState {
  page: IndexedViewPage | null;
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
  reload: () => void;
  loadMore: () => void;
}

/** Loads one indexed-view page and cancels every older request, so a slow
 * answer can never replace the newest view. `loadMore` follows the native
 * `next_cursor`, appending only to the page it belongs to. */
export function useIndexedViewPage(
  request: IndexedViewQuery | null,
  active: boolean,
): IndexedViewState {
  const [page, setPage] = useState<IndexedViewPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(request);
  latest.current = request;
  const pageRef = useRef<IndexedViewPage | null>(null);
  pageRef.current = page;
  const generation = useRef(0);
  const moreHandle = useRef<JobHandle<IndexedViewPage> | null>(null);
  const moreActive = useRef(false);
  const key = request ? JSON.stringify(request) : "";

  useEffect(() => {
    if (!active || !latest.current) return;
    generation.current += 1;
    const currentGeneration = generation.current;
    let disposed = false;
    let handle: JobHandle<IndexedViewPage> | null = null;
    setPage(null);
    pageRef.current = null;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    queryIndexedView(latest.current)
      .then((started) => {
        handle = started;
        if (disposed || currentGeneration !== generation.current) {
          void started.cancel();
          return;
        }
        return started.completion.then((result) => {
          if (!disposed && currentGeneration === generation.current) setPage(result);
        });
      })
      .catch((caught: unknown) => {
        if (!disposed && currentGeneration === generation.current) {
          setError(typeof caught === "string" ? caught : "views.unavailable");
        }
      })
      .finally(() => {
        if (!disposed && currentGeneration === generation.current) setLoading(false);
      });
    return () => {
      disposed = true;
      void handle?.cancel();
      void moreHandle.current?.cancel();
      moreHandle.current = null;
    };
  }, [key, active, nonce]);

  const loadMore = useCallback(() => {
    const current = pageRef.current;
    const requestAtStart = latest.current;
    const cursor = current?.next_cursor ?? null;
    if (
      !active ||
      !requestAtStart ||
      !current ||
      !cursor ||
      loadingMore ||
      moreActive.current
    ) {
      return;
    }
    moreActive.current = true;
    const currentGeneration = generation.current;
    setLoadingMore(true);
    setError(null);
    queryIndexedView({ ...requestAtStart, cursor })
      .then((started) => {
        moreHandle.current = started;
        if (currentGeneration !== generation.current) {
          void started.cancel();
          moreHandle.current = null;
          return undefined;
        }
        return started.completion;
      })
      .then((next) => {
        if (!next || currentGeneration !== generation.current) return;
        setPage((previous) => {
          if (!previous || previous.next_cursor !== cursor) return previous;
          return {
            ...previous,
            results: [...previous.results, ...next.results],
            next_cursor: next.next_cursor,
            complete: next.complete,
            generation: next.generation,
          };
        });
      })
      .catch((caught: unknown) => {
        if (currentGeneration === generation.current) {
          setError(typeof caught === "string" ? caught : "views.unavailable");
        }
      })
      .finally(() => {
        moreHandle.current = null;
        moreActive.current = false;
        if (currentGeneration === generation.current) setLoadingMore(false);
      });
  }, [active, loadingMore]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { page, error, loading, loadingMore, reload, loadMore };
}

export function viewErrorText(t: TFunction, error: unknown): string {
  return t(error === "views.invalid" ? "errors.views.invalid" : "errors.views.unavailable");
}
