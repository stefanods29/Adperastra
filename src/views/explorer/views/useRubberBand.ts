import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { contentPoint, intersectSelection, type ItemRect, type RubberBandState, type SelectionRect } from "../selectionGeometry";

export interface RubberBandOptions {
  rootRef: RefObject<HTMLDivElement | null>;
  layoutRects: () => readonly ItemRect[];
  selection: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  enabled: boolean;
}
export function useRubberBand(options: RubberBandOptions) {
  const live = useRef(options); live.current = options;
  const state = useRef<RubberBandState | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const active = useRef(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [overlayRect, setOverlayRect] = useState<SelectionRect | null>(null);
  const finish = (restore: boolean) => {
    const current = state.current;
    state.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null; last.current = null;
    if (active.current) suppressClick.current = true;
    active.current = false;
    setOverlayRect(null);
    const root = live.current.rootRef.current;
    if (current && root?.hasPointerCapture?.(current.pointer_id)) root.releasePointerCapture(current.pointer_id);
    if (restore && current) live.current.onSelectionChange([...current.initial_selection]);
  };
  const update = () => {
    const current = state.current;
    const root = live.current.rootRef.current;
    if (!current || !root) return;
    current.current = contentPoint(root, pointer.current.x, pointer.current.y);
    const dx = current.current.x - current.origin.x;
    const dy = current.current.y - current.origin.y;
    if (!active.current && Math.hypot(dx, dy) < 4) return;
    active.current = true;
    const rect = { x: Math.min(current.origin.x, current.current.x), y: Math.min(current.origin.y, current.current.y), width: Math.abs(dx), height: Math.abs(dy) };
    setOverlayRect(rect);
    live.current.onSelectionChange(intersectSelection(live.current.layoutRects(), rect, current.initial_selection, current.mode));
  };
  const tick = (now: number) => {
    const root = live.current.rootRef.current;
    if (!state.current || !root) return;
    const dt = last.current === null ? 0 : Math.min(32, Math.max(0, now - last.current));
    last.current = now;
    if (active.current) {
      const point = contentPoint(root, pointer.current.x, pointer.current.y);
      const x = point.x - root.scrollLeft, y = point.y - root.scrollTop;
      const velocity = (position: number, size: number) => position < 24 ? -600 * Math.min(1, (24 - position) / 24) : position > size - 24 ? 600 * Math.min(1, (position - size + 24) / 24) : 0;
      root.scrollLeft += velocity(x, root.clientWidth) * dt / 1000;
      root.scrollTop += velocity(y, root.clientHeight) * dt / 1000;
      update();
    }
    raf.current = requestAnimationFrame(tick);
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && state.current) { event.preventDefault(); finishRef.current(true); } };
    const onBlur = () => finishRef.current(false);
    window.addEventListener("keydown", onKey, true); window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", onBlur);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      const current = state.current; state.current = null;
      const root = live.current.rootRef.current;
      if (current && root?.hasPointerCapture?.(current.pointer_id)) root.releasePointerCapture(current.pointer_id);
    };
  }, []);
  useEffect(() => { if (!options.enabled && state.current) finishRef.current(true); }, [options.enabled]);
  return { overlayRect,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!state.current) suppressClick.current = false;
      const root = live.current.rootRef.current;
      if (!root || !live.current.enabled || state.current || event.button !== 0 || !event.isPrimary) return;
      if ((event.target as Element).closest('[role="option"],input,textarea,select,button,[contenteditable], [role="separator"],[role="columnheader"],.adp-filelist-header,.adp-group-header')) return;
      const point = contentPoint(root, event.clientX, event.clientY);
      const x = point.x - root.scrollLeft, y = point.y - root.scrollTop;
      if (x < 0 || y < 0 || x >= root.clientWidth || y >= root.clientHeight) return;
      suppressClick.current = false;
      event.preventDefault(); root.focus(); root.setPointerCapture(event.pointerId);
      pointer.current = { x: event.clientX, y: event.clientY };
      state.current = { pointer_id: event.pointerId, origin: point, current: point, initial_selection: [...live.current.selection], mode: event.ctrlKey ? "toggle" : event.shiftKey ? "add" : "replace" };
      raf.current = requestAnimationFrame(tick);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (state.current?.pointer_id !== event.pointerId) return;
      pointer.current = { x: event.clientX, y: event.clientY }; update();
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (state.current?.pointer_id !== event.pointerId) return;
      pointer.current = { x: event.clientX, y: event.clientY }; update(); finish(false);
    },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { if (state.current?.pointer_id === event.pointerId) finish(true); },
    onLostPointerCapture: () => { if (state.current) finish(true); },
    onClickCapture: (event: { preventDefault(): void; stopPropagation(): void }) => {
      if (!suppressClick.current) return;
      suppressClick.current = false; event.preventDefault(); event.stopPropagation();
    },
  };
}
