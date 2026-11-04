import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampColumnWidth, columnBounds, defaultColumnWidth, type ColumnId } from "../../../services/folderPresentation";

export function useColumnResize(id: ColumnId, value: number, onCommit: (width: number) => void) {
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{ pointer: number; start: number; width: number; scale: number; element: HTMLElement } | null>(null);
  const current = useRef(value);
  current.current = draft ?? value;
  const cancel = () => {
    const state = drag.current;
    drag.current = null;
    if (state?.element.hasPointerCapture?.(state.pointer)) state.element.releasePointerCapture(state.pointer);
    setDraft(null);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); cancelRef.current(); } };
    const onBlur = () => cancelRef.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      const state = drag.current;
      drag.current = null;
      if (state?.element.hasPointerCapture?.(state.pointer)) state.element.releasePointerCapture(state.pointer);
    };
  }, []);
  const [min, max] = columnBounds(id);
  return {
    width: draft ?? value,
    separatorProps: {
      role: "separator" as const, tabIndex: 0, "aria-orientation": "vertical" as const,
      "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": draft ?? value,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.stopPropagation();
        const element = event.currentTarget;
        const parent = element.parentElement;
        const scale = parent && parent.offsetWidth ? parent.getBoundingClientRect().width / parent.offsetWidth : 1;
        drag.current = { pointer: event.pointerId, start: event.clientX, width: value, scale: scale || 1, element };
        element.setPointerCapture(event.pointerId);
        setDraft(value);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const state = drag.current;
        if (state?.pointer !== event.pointerId) return;
        current.current = clampColumnWidth(id, state.width + (event.clientX - state.start) / state.scale);
        setDraft(current.current);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const state = drag.current;
        if (state?.pointer !== event.pointerId) return;
        const next = clampColumnWidth(id, state.width + (event.clientX - state.start) / state.scale);
        cancel(); onCommit(next);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: () => { if (drag.current) cancel(); },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
        if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const delta = event.shiftKey ? 32 : 8;
        onCommit(event.key === "Home" ? defaultColumnWidth(id) : clampColumnWidth(id, value + (event.key === "ArrowRight" ? delta : -delta)));
      },
    },
  };
}
