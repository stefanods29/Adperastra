/** Bounded progressive Gallery paging with generation-scoped cancellation. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  closeGallery, galleryPage, galleryPathKey, listenGalleryChanges,
  listenGalleryScanFinished, startGallery, setGalleryActive,
  type GalleryItem, type GalleryLimitReason, type GalleryPage, type GallerySettings,
} from "../../services/gallery";
import type { JobHandle } from "../../services/jobs";
import { galleryTimeZone, groupGalleryItems, sortGalleryItems, type GalleryGroup, type GalleryTakenLookup } from "./galleryDates";
import { mergeGalleryItems } from "./gallerySelection";
import { useGalleryTaken } from "./useGalleryTaken";

export const GALLERY_TAKEN_BATCH = 24;
export const GALLERY_IDLE_CLOSE_MS = 30_000;
export const GALLERY_EMPTY_PAGE_RETRY_MS = 500;
export interface GalleryState {
  generation: string | null; items: GalleryItem[]; groups: GalleryGroup[];
  loading: boolean; loadingMore: boolean; hasMore: boolean; complete: boolean;
  partial: boolean; skippedCount: number; limitReason: GalleryLimitReason | null; error: unknown | null;
}
export interface GalleryServices {
  start: typeof startGallery; page: typeof galleryPage; close: typeof closeGallery;
  listen: typeof listenGalleryChanges; listenFinished: typeof listenGalleryScanFinished;
}
export interface UseGalleryOptions {
  settings: GallerySettings; active: boolean; showHidden: boolean; showSystem: boolean;
  services?: Partial<GalleryServices>; metadata?: (path: string) => Promise<string | null>;
  timeZone?: string; visibleItems?: readonly GalleryItem[]; freezeGrouping?: boolean;
}
export interface GalleryController extends GalleryState {
  refresh: () => void; loadMore: () => void; takenFor: GalleryTakenLookup;
}
const EMPTY_ITEMS: readonly GalleryItem[] = [];
const IDLE_STATE: GalleryState = {
  generation: null, items: [], groups: [], loading: false, loadingMore: false,
  hasMore: false, complete: false, partial: false, skippedCount: 0, limitReason: null, error: null,
};
function covered(item: GalleryItem, settings: GallerySettings): boolean {
  const path = galleryPathKey(item.item.path);
  return settings.sources.some(source => {
    const root = galleryPathKey(source.path);
    if (!path.startsWith(root.endsWith("\\") ? root : root + "\\")) return false;
    const rest = path.slice(root.length).replace(/^\\/, "");
    return source.recursive || !rest.includes("\\");
  });
}
export function useGallery(options: UseGalleryOptions): GalleryController {
  const { i18n } = useTranslation();
  const { settings, active, showHidden, showSystem } = options;
  const timeZone = options.timeZone ?? galleryTimeZone();
  const services = useMemo<GalleryServices>(() => ({
    start: options.services?.start ?? startGallery, page: options.services?.page ?? galleryPage,
    close: options.services?.close ?? closeGallery, listen: options.services?.listen ?? listenGalleryChanges,
    listenFinished: options.services?.listenFinished ?? listenGalleryScanFinished,
  }), [options.services]);
  const [state, setState] = useState<GalleryState>(IDLE_STATE);
  const epoch = useRef(0), pageEpoch = useRef(0);
  const generation = useRef<string | null>(null), cursor = useRef<string | null>(null);
  const job = useRef<JobHandle<GalleryPage> | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const dirty = useRef(false), pending = useRef(false);
  const startedKey = useRef<string | null>(null);
  const retry = useRef<number | null>(null);
  const loadRef = useRef<() => void>(() => undefined), refreshRef = useRef<() => void>(() => undefined);
  const reloadHeadRef = useRef<() => Promise<void>>(async () => undefined);
  const taken = useGalleryTaken({ items: options.visibleItems ?? EMPTY_ITEMS, active,
    generation: state.generation, metadata: options.metadata });
  const takenFor = taken.lookup;
  const clearRetry = useCallback(() => { if (retry.current !== null) clearTimeout(retry.current); retry.current = null; }, []);
  const scheduleRetry = useCallback(() => {
    if (retry.current !== null || !activeRef.current) return;
    retry.current = window.setTimeout(() => { retry.current = null; loadRef.current(); }, GALLERY_EMPTY_PAGE_RETRY_MS);
  }, []);
  const applyPage = useCallback((page: GalleryPage, replace: boolean) => {
    cursor.current = page.next_cursor;
    setState(current => ({ ...current, generation: page.generation,
      items: mergeGalleryItems(replace ? [] : current.items, page.items),
      loading: !page.complete, hasMore: page.next_cursor !== null, complete: page.complete,
      partial: page.partial, skippedCount: page.skipped_count, limitReason: page.limit_reason, error: null,
    }));
  }, []);
  const stop = useCallback((clear: boolean) => {
    epoch.current += 1; pageEpoch.current += 1; clearRetry(); pending.current = false;
    const previous = generation.current; generation.current = null; cursor.current = null;
    const oldJob = job.current; job.current = null;
    if (oldJob) void oldJob.cancel().catch(() => undefined);
    if (previous) void services.close(previous).catch(() => undefined);
    if (clear) { startedKey.current = null; setState(IDLE_STATE); }
  }, [clearRetry, services]);
  const scanKey = JSON.stringify({ settings, showHidden, showSystem });
  const startRun = useCallback(async () => {
    stop(false);
    const run = epoch.current;
    if (!activeRef.current || settings.sources.length === 0) { setState(IDLE_STATE); return; }
    // Keep still-authorized rows during refresh; never show a removed source.
    setState(current => ({ ...current, items: current.items.filter(item => covered(item, settings)),
      loading: true, complete: false, hasMore: true, error: null }));
    try {
      const handle = await services.start({ sources: settings.sources, date_source: settings.date_source,
        show_hidden: showHidden, show_system: showSystem });
      if (run !== epoch.current) {
        void handle.cancel().catch(() => undefined);
        void handle.completion.then(page => services.close(page.generation)).catch(() => undefined);
        return;
      }
      job.current = handle;
      const first = await handle.completion;
      if (run !== epoch.current) { void services.close(first.generation).catch(() => undefined); return; }
      generation.current = first.generation;
      job.current = null;
      applyPage(first, true);
      if (!first.complete && first.items.length === 0) scheduleRetry();
    } catch (error) {
      if (run === epoch.current) setState(current => ({ ...current, loading: false, hasMore: false, error }));
    }
  }, [applyPage, scheduleRetry, services, settings, showHidden, showSystem, stop]);
  const refresh = useCallback(() => { startedKey.current = scanKey; dirty.current = false; void startRun(); }, [scanKey, startRun]);
  refreshRef.current = refresh;
  const reloadHead = useCallback(async () => {
    const current = generation.current; if (!current || !activeRef.current) return;
    const run = epoch.current, revision = ++pageEpoch.current;
    pending.current = false; clearRetry();
    const page = await services.page(current, null);
    if (run !== epoch.current || revision !== pageEpoch.current) return;
    applyPage(page, true);
    if (!page.complete) scheduleRetry();
  }, [applyPage, clearRetry, scheduleRetry, services]);
  reloadHeadRef.current = reloadHead;
  const loadMore = useCallback(async () => {
    const current = generation.current, next = cursor.current;
    if (!activeRef.current || !current || !next || pending.current || retry.current !== null) return;
    const run = epoch.current, revision = pageEpoch.current;
    pending.current = true; setState(current => ({ ...current, loadingMore: true }));
    try {
      const page = await services.page(current, next);
      if (run !== epoch.current || revision !== pageEpoch.current) return;
      applyPage(page, false);
      if (!page.complete && page.items.length === 0) scheduleRetry();
    } catch (error) {
      if (run !== epoch.current || revision !== pageEpoch.current) return;
      // A completed scan publishes a new immutable snapshot and invalidates
      // provisional cursors. Fetch its head; late pictures cannot be omitted.
      if (String(error instanceof Error ? error.message : error).includes("gallery.changed")) {
        try { await reloadHeadRef.current(); } catch (failure) { setState(current => ({ ...current, error: failure })); }
      } else setState(current => ({ ...current, error, hasMore: false }));
    } finally {
      if (run === epoch.current) { pending.current = false; setState(current => ({ ...current, loadingMore: false })); }
    }
  }, [applyPage, scheduleRetry, services]);
  loadRef.current = loadMore;
  useEffect(() => {
    if (startedKey.current !== null && startedKey.current !== scanKey && !active) stop(true);
    if (!active) {
      clearRetry();
      if (generation.current) void setGalleryActive(generation.current, false).catch(() => undefined);
      if (state.loading) { dirty.current = true; const handle = job.current; if (handle) void handle.cancel().catch(() => undefined); }

      const timer = window.setTimeout(() => { if (!activeRef.current) stop(true); }, GALLERY_IDLE_CLOSE_MS);
      return () => clearTimeout(timer);
    }
    if (generation.current) void setGalleryActive(generation.current, true).catch(() => undefined);
    if (startedKey.current !== scanKey || dirty.current) {
      startedKey.current = scanKey; dirty.current = false; void startRun();
    }
    return undefined;
  }, [active, clearRetry, scanKey, startRun, stop]);
  useEffect(() => () => stop(false), [stop]);
  useEffect(() => {
    let disposed = false; let timer: number | null = null;
    const stops: UnlistenFn[] = [];
    const keep = (unlisten: UnlistenFn) => { if (disposed) unlisten(); else stops.push(unlisten); };
    void services.listen(id => {
      if (disposed || id !== generation.current) return;
      if (!activeRef.current) { dirty.current = true; return; }
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(() => { timer = null; refreshRef.current(); }, 250);
    }).then(keep).catch(() => undefined);
    void services.listenFinished(event => {
      if (disposed || event.generation !== generation.current) return;
      if (!activeRef.current) { dirty.current = true; return; }
      void reloadHeadRef.current().catch(error => setState(current => ({ ...current, error, loading: false })));
    }).then(keep).catch(() => undefined);
    return () => { disposed = true; if (timer !== null) clearTimeout(timer); for (const unlisten of stops) unlisten(); };
  }, [services]);
  const [appliedDates, setAppliedDates] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (state.complete && !options.freezeGrouping) setAppliedDates(new Map(taken.values));
  }, [options.freezeGrouping, state.complete, taken.values]);
  const groups = useMemo(() => {
    const lookup: GalleryTakenLookup = item => appliedDates.get(item.identity) ?? null;
    return groupGalleryItems(sortGalleryItems(state.items, settings.date_source, lookup),
      settings.date_source, timeZone, i18n.language, lookup);
  }, [appliedDates, i18n.language, settings.date_source, state.items, timeZone]);
  return { ...state, groups, refresh, loadMore, takenFor };
}
