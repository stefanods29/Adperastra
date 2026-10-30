import { useEffect, useRef, type ReactNode } from "react";
import type { ViewModeId } from "../../../services/settings";
import FileList from "../FileList";
import ColumnView from "./ColumnView";
import FileGrid from "./FileGrid";
import ListModeView from "./ListModeView";
import type { ColumnViewOptions } from "./columnTrail";
import type { ItemViewProps } from "./useItemInteractions";
import { ZOOM_STEP_DELTA, ZOOM_STEP_INTERVAL_MS, isGridMode } from "./viewModes";

interface ItemViewComponentProps extends ItemViewProps {
  mode: ViewModeId;
  /** Ctrl+wheel steps the view (Step 05a D6). */
  onZoomStep?: (direction: 1 | -1) => void;
  /** Column view only (Step 05b). */
  columnOptions?: ColumnViewOptions;
}

/** Draws the folder in the chosen view (Step 05a D2) and handles
 * Ctrl+mouse wheel over the items. */
export default function ItemView({ mode, onZoomStep, columnOptions, ...props }: ItemViewComponentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(onZoomStep);
  zoomRef.current = onZoomStep;
  const accumulator = useRef(0);
  const lastStep = useRef(0);

  // Not React's wheel prop: it is passive, so the page would zoom instead.
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      accumulator.current += event.deltaY * (event.deltaMode === 1 ? 40 : 1);
      if (Math.abs(accumulator.current) >= ZOOM_STEP_DELTA) {
        const now = Date.now();
        if (now - lastStep.current >= ZOOM_STEP_INTERVAL_MS) {
          zoomRef.current?.(accumulator.current < 0 ? 1 : -1);
          lastStep.current = now;
        }
        accumulator.current = 0;
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  let content: ReactNode = null;
  if (mode === "details") content = <FileList {...props} />;
  else if (mode === "list") content = <ListModeView key="list" {...props} />;
  else if (mode === "columns") {
    content = columnOptions ? (
      <ColumnView key="columns" {...props} options={columnOptions} />
    ) : (
      <FileList {...props} />
    );
  } else if (isGridMode(mode)) content = <FileGrid key={mode} mode={mode} {...props} />;

  return (
    <div className="adp-itemview" ref={rootRef}>
      {content}
    </div>
  );
}
