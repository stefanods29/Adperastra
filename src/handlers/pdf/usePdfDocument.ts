import { useCallback, useEffect, useRef, useState } from "react";
import { releaseCacheLease, type CacheLease } from "../../services/cache";
import { errorCode } from "../../services/errors";
import type { JobHandle } from "../../services/jobs";
import {
  bucketForDisplay,
  clampPdfZoom,
  closePdf,
  openPdf,
  PDF_MAX_TEXT_RUNS,
  readPdfText,
  readPdfViewState,
  renderPdfPage,
  type PdfPageImage,
  type PdfPageInfo,
  type PdfSession,
  type PdfTextPage,
  type PdfViewState,
} from "../../services/pdf";
import { clampPage, pdfPageRowHeight, pdfPrefetchOrder, PDF_MAX_IMAGE_LEASES, PDF_PAGE_GAP } from "./pdfState";

/** One open PDF and everything the viewer derives from it (Step 07d T3/T4).
 *
 * Owns the session, the page images and their cache leases, the text
 * chunks and every cancellation. Work stops when the tab is not visible
 * (07b E5 `active`), when the document or rotation changes, and on unmount;
 * every lease is released exactly once (D6). A tab keeps at most twelve page
 * images leased; the ones that are not on screen go first. */

export type PdfPhase =
  | { kind: "loading" }
  | { kind: "password"; failed: boolean }
  | { kind: "ready"; session: PdfSession }
  | { kind: "error"; code: string };

export interface PdfDocumentApi {
  phase: PdfPhase;
  state: PdfViewState;
  pageInfos: ReadonlyMap<number, PdfPageInfo>;
  /** Page images by `${page}:${bucket}`. */
  images: ReadonlyMap<string, PdfPageImage>;
  texts: ReadonlyMap<number, PdfTextPage>;
  unlock: (password: string) => void;
  retry: () => void;
  update: (patch: Partial<PdfViewState>) => void;
  goToPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  requestPage: (page: number, bucket: "page" | "thumbnail") => void;
  requestText: (page: number) => void;
}

interface LeaseEntry {
  lease: CacheLease;
  key: string;
}

/** A4 in points, used to size a page before its real size is known. */
const A4 = { width_pt: 595, height_pt: 842 };
/** Most text chunks one page reads (8 × 50,000 runs is far past the cap). */
const MAX_TEXT_CHUNKS = 8;

export function usePdfDocument(
  path: string,
  active: boolean,
  savedState: unknown,
  onStateChange: (state: unknown) => void,
  previewOnly: boolean,
): PdfDocumentApi {
  const [phase, setPhase] = useState<PdfPhase>({ kind: "loading" });
  const [state, setState] = useState<PdfViewState>(() => readPdfViewState(savedState, 1));
  const [pageInfos, setPageInfos] = useState<ReadonlyMap<number, PdfPageInfo>>(new Map());
  const [images, setImages] = useState<ReadonlyMap<string, PdfPageImage>>(new Map());
  const [texts, setTexts] = useState<ReadonlyMap<number, PdfTextPage>>(new Map());
  const [openToken, setOpenToken] = useState(0);

  const sessionRef = useRef<PdfSession | null>(null);
  const savedRef = useRef(savedState);
  const imagesRef = useRef<Map<string, PdfPageImage>>(new Map());
  const pageInfosRef = useRef<ReadonlyMap<number, PdfPageInfo>>(new Map());
  const leaseEdges = useRef(new Map<string, number>());
  const leases = useRef<LeaseEntry[]>([]);
  const pageJobs = useRef(new Map<string, JobHandle<PdfPageImage>>());
  const textPages = useRef(new Set<number>());
  const openJob = useRef<JobHandle<PdfSession> | null>(null);
  const generation = useRef(0);
  const stateRef = useRef(state);
  const activeRef = useRef(active);
  const requestRevision = useRef(0);
  const passwordRef = useRef<string | undefined>(undefined);

  stateRef.current = state;
  activeRef.current = active;

  const setPageImages = useCallback((next: Map<string, PdfPageImage>) => {
    imagesRef.current = next;
    setImages(new Map(next));
  }, []);

  /** Release one lease through the one 07a API, exactly once. */
  const releaseLease = useCallback((key: string) => {
    const index = leases.current.findIndex((entry) => entry.key === key);
    leaseEdges.current.delete(key);
    if (index === -1) return;
    const [entry] = leases.current.splice(index, 1);
    void releaseCacheLease(entry.lease.lease_id).catch(() => undefined);
  }, []);

  const releaseAll = useCallback(() => {
    for (const entry of leases.current) {
      void releaseCacheLease(entry.lease.lease_id).catch(() => undefined);
    }
    leases.current = [];
    leaseEdges.current.clear();
    imagesRef.current = new Map();
    setPageImages(new Map());
  }, [setPageImages]);

  const cancelPages = useCallback(() => {
    for (const job of pageJobs.current.values()) void job.cancel();
    pageJobs.current.clear();
  }, []);

  /** Drop page images over the lease budget, keeping the visible page. */
  const trimLeases = useCallback(
    (keepKeys: readonly string[]) => {
      const keep = new Set(keepKeys);
      while (leases.current.length > PDF_MAX_IMAGE_LEASES) {
        const index = leases.current.findIndex((entry) => !keep.has(entry.key));
        if (index === -1) return;
        const [entry] = leases.current.splice(index, 1);
        leaseEdges.current.delete(entry.key);
        if (imagesRef.current.delete(entry.key)) setPageImages(new Map(imagesRef.current));
        void releaseCacheLease(entry.lease.lease_id).catch(() => undefined);
      }
    },
    [setPageImages],
  );

  // Open (or reopen) the document. A password retry or Retry bumps the token.
  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    let cancelled = false;
    sessionRef.current = null;
    cancelPages();
    releaseAll();
    pageInfosRef.current = new Map();
    setPageInfos(new Map());
    setTexts(new Map());
    textPages.current.clear();
    setPhase({ kind: "loading" });
    if (!path) {
      setPhase({ kind: "error", code: "pdf.bad_request" });
      return;
    }
    void (async () => {
      try {
        const job = await openPdf(path, passwordRef.current);
        openJob.current = job;
        if (cancelled || generation.current !== current) {
          void job.cancel();
          return;
        }
        const session = await job.completion;
        openJob.current = null;
        if (cancelled || generation.current !== current) return;
        sessionRef.current = session;
        const restored = readPdfViewState(savedRef.current, session.page_count);
        stateRef.current = restored;
        setState(restored);
        setPhase({ kind: "ready", session });
      } catch (error) {
        openJob.current = null;
        if (cancelled || generation.current !== current) return;
        const code = errorCode(error) || "pdf.corrupt";
        if (code === "pdf.password_required") setPhase({ kind: "password", failed: false });
        else if (code === "pdf.bad_password") setPhase({ kind: "password", failed: true });
        else setPhase({ kind: "error", code });
      }
    })();
    return () => {
      cancelled = true;
      void openJob.current?.cancel();
      openJob.current = null;
    };
  }, [path, openToken, cancelPages, releaseAll]);

  // Unmount: cancel everything, release every lease, close the session.
  useEffect(
    () => () => {
      generation.current += 1;
      cancelPages();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void closePdf(session.session_id);
      for (const entry of leases.current) {
        void releaseCacheLease(entry.lease.lease_id).catch(() => undefined);
      }
      leases.current = [];
    },
    [cancelPages],
  );

  // Leaving the tab stops the work in flight and gives back its leases; the
  // session itself stays open so coming back is instant.
  useEffect(() => {
    if (active) return;
    cancelPages();
    releaseAll();
  }, [active, cancelPages, releaseAll]);

  const pageWidth = useCallback((page: number): number => {
    const size = pageInfosRef.current.get(page) ?? A4;
    const rotation = stateRef.current.rotation;
    const width = rotation === 90 || rotation === 270 ? size.height_pt : size.width_pt;
    return width * (stateRef.current.zoom / 100);
  }, []);

  const renderPage = useCallback(
    async (page: number, bucket: "page" | "thumbnail") => {
      const session = sessionRef.current;
      if (!session || !activeRef.current) return;
      const edge = bucket === "thumbnail" ? 512 : bucketForDisplay(pageWidth(page), window.devicePixelRatio);
      const key = `${page}:${bucket}`;
      if (pageJobs.current.has(key)) return;
      if ((leaseEdges.current.get(key) ?? 0) >= edge) return;
      requestRevision.current += 1;
      const revisionValue = requestRevision.current;
      try {
        const job = await renderPdfPage({
          session_id: session.session_id,
          page,
          raster: { kind: "bucket", edge },
          rotation: stateRef.current.rotation,
          request_revision: revisionValue,
        });
        pageJobs.current.set(key, job);
        const image = await job.completion;
        pageJobs.current.delete(key);
        const stillCurrent = sessionRef.current?.session_id === session.session_id;
        const rotationSame = stateRef.current.rotation === image.rendered_rotation;
        if (!stillCurrent || !rotationSame || !activeRef.current) {
          // A late or offscreen answer: its lease is not shown, so drop it.
          void releaseCacheLease(image.image.lease_id).catch(() => undefined);
          return;
        }
        const previousEdge = leaseEdges.current.get(key) ?? 0;
        if (previousEdge >= edge) {
          void releaseCacheLease(image.image.lease_id).catch(() => undefined);
          return;
        }
        if (previousEdge > 0) releaseLease(key);
        leases.current.push({ lease: image.image, key });
        leaseEdges.current.set(key, edge);
        const next = new Map(imagesRef.current);
        next.set(key, image);
        setPageImages(next);
        pageInfosRef.current = new Map(pageInfosRef.current).set(page, image.info);
        setPageInfos(new Map(pageInfosRef.current));
        // Keep the visible page and the pages being read for now.
        const keep = [`${stateRef.current.page}:page`, ...pageJobs.current.keys()];
        trimLeases(keep);
      } catch (error) {
        pageJobs.current.delete(key);
        // A cancelled or superseded render is not an error the user needs.
        void error;
      }
    },
    [pageWidth, releaseLease, setPageImages, trimLeases],
  );

  const requestPage = useCallback(
    (page: number, bucket: "page" | "thumbnail") => {
      const count = sessionRef.current?.page_count ?? 1;
      void renderPage(clampPage(page, count), bucket);
    },
    [renderPage],
  );

  const requestText = useCallback(
    (page: number) => {
      const session = sessionRef.current;
      if (!session || !activeRef.current || textPages.current.has(page)) return;
      textPages.current.add(page);
      void (async () => {
        try {
          const runs: PdfTextPage["runs"] = [];
          let afterRun: number | undefined;
          let source = session.source;
          let complete = false;
          for (let chunk = 0; chunk < MAX_TEXT_CHUNKS && !complete; chunk += 1) {
            const answer = await readPdfText(session.session_id, page, afterRun);
            runs.push(...answer.runs);
            source = answer.source;
            complete = answer.complete;
            afterRun = answer.next_run ?? undefined;
            if (runs.length >= PDF_MAX_TEXT_RUNS) break;
          }
          if (!activeRef.current || sessionRef.current?.session_id !== session.session_id) return;
          const answer: PdfTextPage = { page, runs, complete, source };
          setTexts((current) => {
            if (current.has(page)) return current;
            const next = new Map(current);
            next.set(page, answer);
            return next;
          });
        } catch {
          // A page whose text cannot be read still shows its picture.
        }
      })();
    },
    [],
  );

  // Prefetch the visible page first, then its neighbours (D5).
  useEffect(() => {
    if (!active || phase.kind !== "ready") return;
    for (const page of pdfPrefetchOrder(state.page, phase.session.page_count)) {
      requestPage(page, "page");
    }
  }, [active, phase, state.page, state.rotation, state.zoom, requestPage]);

  const persist = useCallback(
    (next: PdfViewState, session: PdfSession) => {
      const bounded = { ...next, page: clampPage(next.page, session.page_count) };
      stateRef.current = bounded;
      setState(bounded);
      if (!previewOnly) onStateChange(bounded);
    },
    [onStateChange, previewOnly],
  );

  const update = useCallback(
    (patch: Partial<PdfViewState>) => {
      const session = sessionRef.current;
      if (!session) return;
      const rotationChanged = patch.rotation !== undefined && patch.rotation !== stateRef.current.rotation;
      if (rotationChanged) {
        // Rotation is baked into the PNG: every page image is now old.
        cancelPages();
        releaseAll();
        pageInfosRef.current = new Map();
        setPageInfos(new Map());
      }
      persist(
        {
          ...stateRef.current,
          ...patch,
          zoom: patch.zoom === undefined ? stateRef.current.zoom : clampPdfZoom(patch.zoom),
        },
        session,
      );
    },
    [cancelPages, persist, releaseAll],
  );

  const goToPage = useCallback(
    (page: number) => {
      const session = sessionRef.current;
      if (!session) return;
      persist({ ...stateRef.current, page: clampPage(page, session.page_count) }, session);
    },
    [persist],
  );

  const setZoom = useCallback(
    (zoom: number) => {
      const session = sessionRef.current;
      if (!session) return;
      cancelPages();
      persist({ ...stateRef.current, zoom: clampPdfZoom(zoom), fit: "none" }, session);
    },
    [cancelPages, persist],
  );

  const unlock = useCallback((password: string) => {
    passwordRef.current = password.slice(0, 1024);
    setPhase({ kind: "loading" });
    setOpenToken((value) => value + 1);
  }, []);

  const retry = useCallback(() => {
    passwordRef.current = undefined;
    setPhase({ kind: "loading" });
    setOpenToken((value) => value + 1);
  }, []);

  return {
    phase,
    state,
    pageInfos,
    images,
    texts,
    unlock,
    retry,
    update,
    goToPage,
    setZoom,
    requestPage,
    requestText,
  };
}

/** The row height of one page in the pages list; exported for the tests. */
export function pdfRowHeightFor(info: PdfPageInfo | undefined, zoom: number, rotation: PdfViewState["rotation"]): number {
  return pdfPageRowHeight(info ?? A4, zoom, rotation) - PDF_PAGE_GAP;
}
