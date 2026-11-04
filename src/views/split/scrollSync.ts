/** Synchronized scrolling between the two sides of a split (Step 09i,
 * scroll-sync-1).
 *
 * A port reports its document's *normalized* progress (0..1) and applies
 * remote progress. Linking never compares pixels or page numbers: both
 * sides speak the same 0..1 scale, so a 4-page PDF next to a 100-line text
 * file follows the same fraction. User motion is applied to the other port
 * at most once per animation frame, never re-emitted as user motion (no
 * oscillation) and never applied out of order (monotonic generation).
 *
 * Ports are registered by the views that can follow progress (PDF and text
 * today; Office and version views later). A split without two ports shows
 * that synchronized scrolling is unavailable instead of pretending. */

export type ScrollSyncOrigin = "user" | "sync";
export type ScrollSyncPortKind = "pdf" | "text" | "document" | "version";

export interface ScrollSyncState {
  /** Normalized document progress, 0..1. */
  progress: number;
  /** `user` means real user motion; `sync` means it came from the link. */
  origin: ScrollSyncOrigin;
  /** Grows on every emission from this port. */
  generation: number;
}

export interface ScrollSyncPort {
  view_id: string;
  kind: ScrollSyncPortKind;
  getProgress(): number;
  /** Apply progress from the other side. A port must not re-emit this as
   * user motion. */
  setProgress(progress: number, generation: number): void;
  subscribe(listener: (state: ScrollSyncState) => void): () => void;
  /** Stop timers/listeners for this view. Called when the view closes. */
  dispose(): void;
}

const PORTS = new Map<string, ScrollSyncPort>();

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Normalized progress for a scrolling element: offset over extent. A
 * zero (or unknown) extent is progress 0, never a division by zero. An
 * infinite offset clamps to the matching end (1 for +Infinity), while a
 * NaN offset has no position and reads as 0. */
export function normalizedScrollProgress(offset: number, extent: number): number {
  if (!Number.isFinite(extent) || extent <= 0) return 0;
  const progress = offset / extent;
  return Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));
}

/** PDF progress: ((page - 1) + within_page_fraction) / page_count. */
export function pdfScrollProgress(page: number, withinFraction: number, pageCount: number): number {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return 0;
  const current = Number.isFinite(page) ? Math.min(pageCount, Math.max(1, Math.floor(page))) : 1;
  const within = Number.isFinite(withinFraction) ? clamp01(withinFraction) : 0;
  return clamp01((current - 1 + within) / pageCount);
}

/** The inverse for a PDF target: which page and how far into it. */
export function pdfScrollTarget(progress: number, pageCount: number): { page: number; within: number } {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return { page: 1, within: 0 };
  const exact = clamp01(progress) * pageCount;
  const page = Math.min(pageCount, Math.max(1, Math.floor(exact) + 1));
  return { page, within: clamp01(exact - (page - 1)) };
}

function assertPort(port: ScrollSyncPort): void {
  if (!port || typeof port.view_id !== "string" || port.view_id === "") {
    throw new Error("splits.invalid");
  }
  if (typeof port.getProgress !== "function" || typeof port.setProgress !== "function") {
    throw new Error("splits.invalid");
  }
  if (typeof port.subscribe !== "function" || typeof port.dispose !== "function") {
    throw new Error("splits.invalid");
  }
}

/** Register one port per view id (E3). A duplicate registration is a
 * programming error and is refused. The returned function revokes exactly
 * this port, so a closed view can never be resolved again. */
export function registerScrollSyncPort(port: ScrollSyncPort): () => void {
  assertPort(port);
  if (PORTS.has(port.view_id)) throw new Error("splits.invalid");
  PORTS.set(port.view_id, port);
  return () => {
    if (PORTS.get(port.view_id) === port) PORTS.delete(port.view_id);
  };
}

export function resolveScrollSyncPort(viewId: string): ScrollSyncPort | null {
  return PORTS.get(viewId) ?? null;
}

/** Test and window-close helper: drop every registration. */
export function clearScrollSyncPorts(): void {
  PORTS.clear();
}

export interface ScrollSyncPortOptions {
  view_id: string;
  kind: ScrollSyncPortKind;
  /** The view's current normalized progress, computed by the viewer. */
  getProgress: () => number;
  /** Move the view to this normalized progress. Must not re-enter. */
  applyProgress: (progress: number) => void;
}

export interface CreatedScrollSyncPort {
  port: ScrollSyncPort;
  /** Call from the view's own scroll listener: real user motion. */
  reportUserProgress: () => void;
  dispose: () => void;
}

/** The shared port implementation for viewers (PDF, text, later document
 * and version views): generation, origin and the no-re-emit rule live
 * here once, so every viewer reports the same way. Applying progress from
 * the other side never produces `user` motion. */
export function createScrollSyncPort(options: ScrollSyncPortOptions): CreatedScrollSyncPort {
  const listeners = new Set<(state: ScrollSyncState) => void>();
  let generation = 0;
  let disposed = false;

  const emit = (progress: number, origin: ScrollSyncOrigin): void => {
    generation += 1;
    const state: ScrollSyncState = { progress: clamp01(progress), origin, generation };
    for (const listener of listeners) listener(state);
  };

  const port: ScrollSyncPort = {
    view_id: options.view_id,
    kind: options.kind,
    getProgress: () => clamp01(options.getProgress()),
    setProgress(progress, incomingGeneration) {
      if (disposed) return;
      options.applyProgress(clamp01(progress));
      // Re-emit as sync motion so the link (and any other listener) knows
      // this was not the user: no oscillation, no reversed feedback.
      generation = Math.max(generation, incomingGeneration);
      emit(progress, "sync");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };

  return {
    port,
    reportUserProgress: () => {
      if (!disposed) emit(options.getProgress(), "user");
    },
    dispose: () => port.dispose(),
  };
}

export interface ScrollSyncScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

function defaultScheduler(): ScrollSyncScheduler {
  if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
    return {
      request: (callback) => requestAnimationFrame(() => callback()),
      cancel: (handle) => cancelAnimationFrame(handle),
    };
  }
  return {
    request: (callback) => setTimeout(callback, 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  };
}

/** Link two ports (E4). The host aligns them once from the active side
 * before calling this; the link only follows user motion afterwards.
 * Returns the dispose function: it cancels a pending frame and unsubscribes
 * both ports. */
export function linkScrollPorts(
  first: ScrollSyncPort,
  second: ScrollSyncPort,
  scheduler: ScrollSyncScheduler = defaultScheduler(),
): () => void {
  assertPort(first);
  assertPort(second);
  if (first === second || first.view_id === second.view_id) throw new Error("splits.invalid");

  let disposed = false;
  let frame: number | null = null;
  const pending = new Map<ScrollSyncPort, { progress: number; generation: number }>();
  const lastApplied = new Map<ScrollSyncPort, number>();

  const flush = (): void => {
    frame = null;
    if (disposed) return;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [target, value] of batch) {
      if (disposed) return;
      if (value.generation <= (lastApplied.get(target) ?? 0)) continue;
      lastApplied.set(target, value.generation);
      target.setProgress(value.progress, value.generation);
    }
  };

  const push = (target: ScrollSyncPort, progress: number, generation: number): void => {
    // Latest value wins: two user events before the frame apply once.
    pending.set(target, { progress: clamp01(progress), generation });
    if (frame !== null) return;
    frame = scheduler.request(flush);
  };

  const fromFirst = (state: ScrollSyncState): void => {
    if (disposed || state.origin !== "user") return;
    push(second, state.progress, state.generation);
  };
  const fromSecond = (state: ScrollSyncState): void => {
    if (disposed || state.origin !== "user") return;
    push(first, state.progress, state.generation);
  };

  const unsubscribeFirst = first.subscribe(fromFirst);
  const unsubscribeSecond = second.subscribe(fromSecond);

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeFirst();
    unsubscribeSecond();
    if (frame !== null) {
      scheduler.cancel(frame);
      frame = null;
    }
    pending.clear();
    lastApplied.clear();
  };
}
