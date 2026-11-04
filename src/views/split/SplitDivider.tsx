import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_STEP,
  SPLIT_RATIO_STEP_LARGE,
  stepSplitRatio,
  type SplitDirection,
} from "../../services/splitViews";

/** The movable divider between two split sides (Step 09i T3, E5).
 *
 * A 6 px hit area with a 1 px visible line. The pointer captures the
 * divider, previews on every move and commits exactly once on release, so
 * resizing is one history entry, not one per pixel. Escape (or a cancelled
 * pointer) restores the ratio the drag started from. The keyboard changes
 * the ratio by 1 % (Shift: 5 %), Home returns to the middle, and every
 * accepted key commits once. Screen readers get a separator with the
 * current percent and its 20-80 range. */

export interface SplitDividerProps {
  direction: SplitDirection;
  ratio: number;
  min: number;
  max: number;
  onPreview: (ratio: number) => void;
  onCommit: (ratio: number) => void;
  onCancel: () => void;
}

interface DragState {
  pointerId: number;
  startRatio: number;
  startX: number;
  startY: number;
  extent: number;
  next: number;
}

function clampInto(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(max, Math.max(min, value));
}

export default function SplitDivider({ direction, ratio, min, max, onPreview, onCommit, onCancel }: SplitDividerProps) {
  const { t } = useTranslation();
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  // The latest callbacks without restarting listeners on every preview.
  const callbacks = useRef({ onPreview, onCommit, onCancel });
  callbacks.current = { onPreview, onCommit, onCancel };
  const label = t("splits.divider");

  const finish = (commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    if (commit) callbacks.current.onCommit(current.next);
    else callbacks.current.onCancel();
  };

  // Escape during a pointer drag restores the starting ratio and must not
  // also reach the app's own Escape handling.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // `finish` only reads refs, so the listener follows the drag state.
  }, [dragging]);

  const extentOf = (node: HTMLElement): number => {
    const parent = node.parentElement;
    if (!parent) return 0;
    const rect = parent.getBoundingClientRect();
    return direction === "vertical" ? rect.width : rect.height;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const extent = extentOf(event.currentTarget);
    if (extent <= 0) return;
    drag.current = {
      pointerId: event.pointerId ?? 1,
      startRatio: ratio,
      startX: event.clientX,
      startY: event.clientY,
      extent,
      next: ratio,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // preventDefault keeps text selection from starting; focus the handle
    // explicitly so the arrow keys work right after a mouse drag.
    event.currentTarget.focus();
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const delta = direction === "vertical" ? event.clientX - current.startX : event.clientY - current.startY;
    const next = clampInto(current.startRatio + delta / current.extent, min, max);
    current.next = next;
    callbacks.current.onPreview(next);
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    try {
      event.currentTarget.releasePointerCapture?.(current.pointerId);
    } catch {
      // The pointer was never captured (pointer cancelled by the system).
    }
    finish(commit);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const vertical = direction === "vertical";
    const decrease = vertical ? "ArrowLeft" : "ArrowUp";
    const increase = vertical ? "ArrowRight" : "ArrowDown";
    if (event.key === decrease || event.key === increase) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? SPLIT_RATIO_STEP_LARGE : SPLIT_RATIO_STEP;
      onCommit(clampInto(stepSplitRatio(ratio, event.key === increase ? step : -step), min, max));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      onCommit(clampInto(SPLIT_RATIO_DEFAULT, min, max));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      className="adp-split-divider"
      role="separator"
      aria-orientation={direction === "vertical" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      data-dragging={dragging ? "true" : undefined}
      tabIndex={0}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => release(event, true)}
      onPointerCancel={(event) => release(event, false)}
      onKeyDown={onKeyDown}
    />
  );
}
