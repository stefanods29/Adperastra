import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeCrop } from "./geometry";
import type { ImageSize, Rect } from "./types";

/** Crop overlay (D3): draggable box and corner handles, rule-of-thirds lines
 * and labels kept inside the viewport. Entering values in the properties
 * panel remains the keyboard alternative. */

export interface CropOverlayProps {
  crop: Rect;
  source: ImageSize;
  /** Displayed image rectangle inside the canvas, in CSS pixels. */
  viewport: { x: number; y: number; width: number; height: number };
  onChange?: (crop: Rect) => void;
}

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface Drag {
  mode: DragMode;
  startX: number;
  startY: number;
  original: Rect;
  current: Rect;
}

export default function CropOverlay({ crop, source, viewport, onChange }: CropOverlayProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<Rect>(crop);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    setShown(crop);
  }, [crop]);

  if (source.width < 1 || source.height < 1) return null;
  const scaleX = viewport.width / source.width;
  const scaleY = viewport.height / source.height;
  const left = viewport.x + shown.x * scaleX;
  const top = viewport.y + shown.y * scaleY;
  const width = Math.max(1, shown.width * scaleX);
  const height = Math.max(1, shown.height * scaleY);

  const label = (value: number, axis: "x" | "y") => {
    const raw = axis === "x" ? viewport.x + value * scaleX : viewport.y + value * scaleY;
    const limit = axis === "x" ? viewport.x + viewport.width - 64 : viewport.y + viewport.height - 20;
    const minimum = axis === "x" ? viewport.x + 4 : viewport.y + 4;
    return Math.min(limit, Math.max(minimum, raw));
  };

  const begin = (mode: DragMode, event: React.PointerEvent<HTMLElement>) => {
    if (!onChange) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, original: shown, current: shown };
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = (event.clientX - state.startX) / Math.max(0.0001, scaleX);
    const dy = (event.clientY - state.startY) / Math.max(0.0001, scaleY);
    let next: Rect = state.original;
    switch (state.mode) {
      case "move":
        next = { ...state.original, x: state.original.x + dx, y: state.original.y + dy };
        break;
      case "nw":
        next = {
          x: state.original.x + dx,
          y: state.original.y + dy,
          width: state.original.width - dx,
          height: state.original.height - dy,
        };
        break;
      case "ne":
        next = { x: state.original.x, y: state.original.y + dy, width: state.original.width + dx, height: state.original.height - dy };
        break;
      case "sw":
        next = { x: state.original.x + dx, y: state.original.y, width: state.original.width - dx, height: state.original.height + dy };
        break;
      case "se":
        next = { ...state.original, width: state.original.width + dx, height: state.original.height + dy };
        break;
    }
    try {
      const normalized = normalizeCrop(next, source);
      state.current = normalized;
      setShown(normalized);
    } catch {
      // Keep the last valid rectangle.
    }
  };

  const end = (commit: boolean) => {
    const state = drag.current;
    drag.current = null;
    if (!state || !onChange) return;
    if (!commit) {
      setShown(state.original);
      return;
    }
    const changed = state.current.x !== state.original.x || state.current.y !== state.original.y || state.current.width !== state.original.width || state.current.height !== state.original.height;
    if (changed) onChange(state.current);
  };

  return (
    <div className="adp-crop-overlay" aria-hidden="true">
      <div
        className="adp-crop-box"
        style={{ left, top, width, height }}
        onPointerDown={(event) => begin("move", event)}
        onPointerMove={move}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
      >
        <span className="adp-crop-line adp-crop-line--v1" />
        <span className="adp-crop-line adp-crop-line--v2" />
        <span className="adp-crop-line adp-crop-line--h1" />
        <span className="adp-crop-line adp-crop-line--h2" />
        {(["nw", "ne", "sw", "se"] as const).map((corner) => (
          <span
            key={corner}
            className={`adp-crop-handle adp-crop-handle--${corner}`}
            onPointerDown={(event) => begin(corner, event)}
            onPointerMove={move}
            onPointerUp={() => end(true)}
            onPointerCancel={() => end(false)}
          />
        ))}
      </div>
      <span className="adp-crop-label adp-crop-label--left" style={{ left: label(shown.x, "x"), top }}>
        {Math.round(shown.x)}
      </span>
      <span className="adp-crop-label adp-crop-label--right" style={{ left: label(shown.x + shown.width, "x") - 40, top: top + height - 18 }}>
        {Math.round(shown.x + shown.width)}
      </span>
      <span className="adp-crop-label adp-crop-label--top" style={{ left, top: label(shown.y, "y") }}>
        {Math.round(shown.y)}
      </span>
      <span className="adp-crop-label adp-crop-label--bottom" style={{ left: left + width - 40, top: label(shown.y + shown.height, "y") - 18 }}>
        {Math.round(shown.y + shown.height)}
      </span>
      <span className="adp-crop-size" style={{ left, top: top + height + 4 }}>
        {t("viewer.dimensions", { width: Math.round(shown.width), height: Math.round(shown.height) })}
      </span>
    </div>
  );
}
