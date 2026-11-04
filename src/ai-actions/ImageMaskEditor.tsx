import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import type { AiBrushSegment, AiMaskSpec } from "../services/aiActionTypes";

/**
 * Local brush/rectangle mask for Erase object (Step 17b D4/D5).
 *
 * Coordinates are image pixels, never screen pixels. The keyboard rectangle
 * is a full alternative to the pointer brush; `alpha >= 128` means erase and
 * the polarity is converted once (native `ai_mask`/`ai_inpaint` own it).
 *
 * The editor sends a compact spec (rectangle or brush segments), never
 * megabytes of pixels: the native side paints the same mask and returns an
 * opaque `mask_artifact_id` for `erase_object`.
 */

export const MASK_BRUSH_MIN = 1;
export const MASK_BRUSH_MAX = 256;
export const MASK_BRUSH_DEFAULT = 24;

export interface MaskSelection {
  width: number;
  height: number;
  alpha: Uint8Array;
}

export interface MaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrushSegment = AiBrushSegment;
export type MaskSpec = AiMaskSpec;

export interface MaskChange {
  selection: MaskSelection;
  spec: MaskSpec;
}

export interface ImageMaskEditorProps {
  width: number;
  height: number;
  /** Optional already-authorized picture for the preview layer. */
  imageUrl?: string;
  disabled?: boolean;
  onChange: (change: MaskChange | null) => void;
  onOpenHelp: (slug: string) => void;
}

export function createMask(width: number, height: number): MaskSelection {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("ai_actions.invalid");
  }
  return { width, height, alpha: new Uint8Array(width * height) };
}

export function maskIsEmpty(mask: MaskSelection | null): boolean {
  if (!mask) return true;
  return !mask.alpha.some((value) => value >= 128);
}

export function maskPercent(mask: MaskSelection | null): number {
  if (!mask || mask.alpha.length === 0) return 0;
  let marked = 0;
  for (const value of mask.alpha) if (value >= 128) marked += 1;
  return Math.floor((marked * 100) / mask.alpha.length);
}

/** Keyboard rectangle; the same pixel rule the native command checks. */
export function maskFromRectangle(width: number, height: number, rect: MaskRect): MaskSelection {
  const mask = createMask(width, height);
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height) ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > width ||
    rect.y + rect.height > height
  ) {
    throw new Error("ai_actions.invalid");
  }
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      mask.alpha[y * width + x] = 255;
    }
  }
  return mask;
}

/** Hard round brush segment in image coordinates. */
export function paintMaskSegment(
  mask: MaskSelection,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): void {
  if (!Number.isInteger(radius) || radius < MASK_BRUSH_MIN || radius > MASK_BRUSH_MAX) {
    throw new Error("ai_actions.invalid");
  }
  const left = Math.max(0, Math.floor(Math.min(x0, x1) - radius));
  const right = Math.min(mask.width - 1, Math.ceil(Math.max(x0, x1) + radius));
  const top = Math.max(0, Math.floor(Math.min(y0, y1) - radius));
  const bottom = Math.min(mask.height - 1, Math.ceil(Math.max(y0, y1) + radius));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = Math.max(1, dx * dx + dy * dy);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSquared));
      const nearestX = x0 + t * dx;
      const nearestY = y0 + t * dy;
      if (Math.hypot(x - nearestX, y - nearestY) <= radius) {
        mask.alpha[y * mask.width + x] = 255;
      }
    }
  }
}

type Mode = "brush" | "rectangle";

export function ImageMaskEditor({
  width,
  height,
  imageUrl,
  disabled = false,
  onChange,
  onOpenHelp,
}: ImageMaskEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("brush");
  const [radius, setRadius] = useState(MASK_BRUSH_DEFAULT);
  const [rect, setRect] = useState<MaskRect>({
    x: 0,
    y: 0,
    width: Math.max(1, Math.floor(width / 2)),
    height: Math.max(1, Math.floor(height / 2)),
  });
  const [revision, setRevision] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<MaskSelection | null>(null);
  const strokesRef = useRef<BrushSegment[]>([]);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  if (!maskRef.current || maskRef.current.width !== width || maskRef.current.height !== height) {
    maskRef.current = createMask(width, height);
    strokesRef.current = [];
  }

  const publish = useCallback(
    (spec: MaskSpec | null) => {
      const current = maskRef.current;
      if (!current) return;
      setRevision((value) => value + 1);
      if (spec === null || maskIsEmpty(current)) {
        onChange(null);
        return;
      }
      onChange({ selection: { ...current, alpha: new Uint8Array(current.alpha) }, spec });
    },
    [onChange],
  );

  useEffect(() => {
    onChange(null);
  }, [width, height, onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const mask = maskRef.current;
    if (!mask) return;
    canvas.width = mask.width;
    canvas.height = mask.height;
    context.clearRect(0, 0, mask.width, mask.height);
    const image = context.createImageData(mask.width, mask.height);
    for (let index = 0; index < mask.alpha.length; index += 1) {
      image.data[index * 4] = 214;
      image.data[index * 4 + 1] = 69;
      image.data[index * 4 + 2] = 69;
      image.data[index * 4 + 3] = mask.alpha[index] > 0 ? 140 : 0;
    }
    context.putImageData(image, 0, 0);
  }, [revision]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = bounds.width === 0 ? 1 : width / bounds.width;
    const scaleY = bounds.height === 0 ? 1 : height / bounds.height;
    return {
      x: Math.max(0, Math.min(width - 1, Math.floor((event.clientX - bounds.left) * scaleX))),
      y: Math.max(0, Math.min(height - 1, Math.floor((event.clientY - bounds.top) * scaleY))),
    };
  };

  const applyRectangle = () => {
    try {
      maskRef.current = maskFromRectangle(width, height, rect);
      strokesRef.current = [];
      publish({ kind: "rect", ...rect });
    } catch {
      publish(null);
    }
  };

  const clear = () => {
    maskRef.current = createMask(width, height);
    strokesRef.current = [];
    publish(null);
  };

  const empty = maskIsEmpty(maskRef.current);

  return (
    <section className="adp-ai-mask" aria-label={t("aiActions.erase_object")}>
      <div className="adp-ai-mask-toolbar" role="group" aria-label={t("aiActions.brush")}>
        <button
          type="button"
          className="adp-ai-mask-mode"
          aria-pressed={mode === "brush"}
          onClick={() => setMode("brush")}
          disabled={disabled}
        >
          {t("aiActions.brush")}
        </button>
        <button
          type="button"
          className="adp-ai-mask-mode"
          aria-pressed={mode === "rectangle"}
          onClick={() => setMode("rectangle")}
          disabled={disabled}
        >
          {t("aiActions.rectangle")}
        </button>
        <label className="adp-ai-mask-radius">
          <span>{t("aiActions.brush")}</span>
          <input
            type="range"
            min={MASK_BRUSH_MIN}
            max={MASK_BRUSH_MAX}
            value={radius}
            disabled={disabled || mode !== "brush"}
            onChange={(event) => setRadius(Number(event.target.value))}
            aria-label={t("aiActions.brush")}
          />
        </label>
        <button type="button" onClick={clear} disabled={disabled}>
          {t("aiActions.clearMask")}
        </button>
        <HelpButton onOpenHelp={() => onOpenHelp("ai-actions-images")} />
      </div>

      <div className="adp-ai-mask-stage">
        {imageUrl ? <img className="adp-ai-mask-source" src={imageUrl} alt="" aria-hidden="true" /> : null}
        <canvas
          ref={canvasRef}
          className="adp-ai-mask-canvas"
          tabIndex={0}
          aria-label={t("aiActions.rectangle")}
          style={{ aspectRatio: `${width} / ${height}` }}
          onPointerDown={(event) => {
            if (disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointFromEvent(event);
            if (mode === "rectangle") {
              setRect({ x: point.x, y: point.y, width: 1, height: 1 });
              return;
            }
            drawing.current = point;
          }}
          onPointerMove={(event) => {
            if (disabled) return;
            const point = pointFromEvent(event);
            if (mode === "rectangle" && event.buttons === 1) {
              setRect((current) => {
                const x = Math.min(current.x, point.x);
                const y = Math.min(current.y, point.y);
                return { x, y, width: Math.abs(point.x - x) + 1, height: Math.abs(point.y - y) + 1 };
              });
              return;
            }
            const previous = drawing.current;
            const mask = maskRef.current;
            if (!previous || !mask) return;
            const segment: BrushSegment = {
              x0: previous.x,
              y0: previous.y,
              x1: point.x,
              y1: point.y,
              radius,
            };
            strokesRef.current = [...strokesRef.current, segment].slice(-4_096);
            paintMaskSegment(mask, segment.x0, segment.y0, segment.x1, segment.y1, radius);
            drawing.current = point;
            publish({ kind: "strokes", strokes: strokesRef.current });
          }}
          onPointerUp={() => {
            if (mode === "rectangle") applyRectangle();
            drawing.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = null;
          }}
        />
      </div>

      <div className="adp-ai-mask-rect" role="group" aria-label={t("aiActions.rectangle")}>
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label key={field}>
            <span>{field}</span>
            <input
              type="number"
              min={field === "width" || field === "height" ? 1 : 0}
              value={rect[field]}
              disabled={disabled}
              aria-label={field}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRect((current) => ({ ...current, [field]: Number.isFinite(value) ? value : 0 }));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyRectangle();
                }
              }}
            />
          </label>
        ))}
        <button type="button" onClick={applyRectangle} disabled={disabled}>
          {t("aiActions.rectangle")}
        </button>
      </div>

      <p className="adp-ai-mask-note" role="status">
        {empty ? t("aiActions.emptyMask") : `${maskPercent(maskRef.current)}%`}
      </p>
    </section>
  );
}
