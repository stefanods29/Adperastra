/** Hover activation and file drops for one tab-strip target (Step 09c T4,
 * E3). The hook never looks at private App state: it only reads the drag's
 * typed payload, starts one activation timer for its target and hands real
 * host file paths to `onDropFiles`. The drag payload itself is never
 * modified, so activation preserves what the user is dragging (D2). */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { readDropPayload, type DropDataTransfer } from "./tabDropRouting";

export const HOVER_MIN_MS = 200;
export const HOVER_MAX_MS = 2000;
export const HOVER_DEFAULT_MS = 600;

/** The delay a stored setting really means: whole milliseconds inside
 * 200..2000; anything else falls back to 600 ms. */
export function normalizeHoverMs(value: number): number {
  if (!Number.isFinite(value)) return HOVER_DEFAULT_MS;
  return Math.min(HOVER_MAX_MS, Math.max(HOVER_MIN_MS, Math.round(value)));
}

export interface TabHoverScheduler {
  /** Start (or keep) the timer for `tabId` with this delay. */
  enter(tabId: string, delayMs: number): void;
  /** The pointer left the target or the drag was cancelled. */
  leave(): void;
  /** The drag session ended (drop, Escape, window leave, unmount). */
  end(): void;
}

/** One timer for one target. Re-entering the same tab keeps the running
 * timer; entering a different tab restarts it; leaving always cancels.
 * Shared by HTML drag events (the hook) and the Explorer's mouse drag
 * session, which never produces drag events. */
export function createTabHoverScheduler(activate: (tabId: string) => void): TabHoverScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return {
    enter(tabId: string, delayMs: number): void {
      if (pending === tabId) return;
      clear();
      pending = tabId;
      timer = setTimeout(() => {
        timer = null;
        const target = pending;
        pending = null;
        if (target !== null) activate(target);
      }, normalizeHoverMs(delayMs));
    },
    leave: clear,
    end: clear,
  };
}

export interface TabDropTargetProps {
  target_id: string;
  tab_id: string;
  hover_ms: number;
  active: boolean;
  onActivate: (tabId: string) => void;
  onDropFiles: (paths: readonly string[]) => Promise<void>;
}

export interface TabDropTargetHandlers {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface TabDropTarget extends TabDropTargetHandlers {
  /** True while a compatible file drag is over this target. */
  hover: boolean;
}

/** E3: the drag handlers and hover state of one tab-strip target. */
export function useTabDropTarget(props: TabDropTargetProps): TabDropTarget {
  const [hover, setHover] = useState(false);
  const activeRef = useRef(props.active);
  const tabRef = useRef(props.tab_id);
  const hoverMsRef = useRef(props.hover_ms);
  const onActivateRef = useRef(props.onActivate);
  const onDropFilesRef = useRef(props.onDropFiles);
  const mountedRef = useRef(false);
  const hoveredRef = useRef(false);

  activeRef.current = props.active;
  tabRef.current = props.tab_id;
  hoverMsRef.current = props.hover_ms;
  onActivateRef.current = props.onActivate;
  onDropFilesRef.current = props.onDropFiles;

  const schedulerRef = useRef<TabHoverScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createTabHoverScheduler((tabId) => {
      if (mountedRef.current && activeRef.current) onActivateRef.current(tabId);
    });
  }

  const setHovered = useCallback((next: boolean) => {
    if (hoveredRef.current === next) return;
    hoveredRef.current = next;
    setHover(next);
  }, []);

  const cancel = useCallback(() => {
    schedulerRef.current?.end();
    setHovered(false);
  }, [setHovered]);

  useEffect(() => {
    mountedRef.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const end = () => cancel();
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragend", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    // Any drop elsewhere ends the session; a drop on this target runs its
    // own handler immediately afterwards.
    window.addEventListener("drop", end, true);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragend", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("drop", end, true);
      schedulerRef.current?.end();
    };
  }, [cancel]);

  useEffect(() => {
    if (!props.active) cancel();
  }, [props.active, cancel]);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!activeRef.current) return;
      const payload = readDropPayload(event.dataTransfer as unknown as DropDataTransfer);
      if (payload.kind !== "files" || payload.paths.length === 0) return;
      setHovered(true);
      schedulerRef.current?.enter(tabRef.current, hoverMsRef.current);
    },
    [setHovered],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!activeRef.current) return;
      const payload = readDropPayload(event.dataTransfer as unknown as DropDataTransfer);
      if (payload.kind !== "files" || payload.paths.length === 0) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setHovered(true);
      // An enter can be missed when a drop crosses into a child element;
      // entering the same tab again keeps the running timer.
      schedulerRef.current?.enter(tabRef.current, hoverMsRef.current);
    },
    [setHovered],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const related = event.relatedTarget as Node | null;
      if (related && event.currentTarget.contains(related)) return;
      cancel();
    },
    [cancel],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      cancel();
      if (!activeRef.current) return;
      const payload = readDropPayload(event.dataTransfer as unknown as DropDataTransfer);
      if (payload.kind !== "files" || payload.paths.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void Promise.resolve(onDropFilesRef.current(payload.paths)).catch(() => undefined);
    },
    [cancel],
  );

  return { onDragEnter, onDragOver, onDragLeave, onDrop, hover };
}
