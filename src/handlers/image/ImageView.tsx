import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { formatSize } from "../../services/format";
import type { HandlerViewProps } from "../types";
import { clampZoom, fitPercent, MAX_ZOOM, MIN_ZOOM, nextZoom } from "./zoom";

interface SavedImageState {
  mode: "fit" | "manual";
  percent: number;
}

function readSaved(state: unknown): SavedImageState {
  if (state !== null && typeof state === "object") {
    const value = state as Partial<SavedImageState>;
    if (value.mode === "manual" && typeof value.percent === "number") return { mode: "manual", percent: clampZoom(value.percent) };
  }
  return { mode: "fit", percent: 100 };
}

/** Image viewer (Step 04a): fit to window, zoom with Ctrl+wheel and
 * Ctrl+=/Ctrl+-/Ctrl+0, pan by dragging, checkerboard behind transparency.
 * The browser decodes the image off the main thread (`decoding="async"`). */
export default function ImageView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<SavedImageState>(() => readSaved(savedState));
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // Track the visible area so "fit" follows window resizes.
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // After 1 s without the image, say what is happening (plan/rules.md R-UI-2).
  useEffect(() => {
    if (natural || failed) return;
    const timer = window.setTimeout(() => setSlow(true), 1000);
    return () => window.clearTimeout(timer);
  }, [natural, failed]);

  const percent = natural
    ? zoom.mode === "fit"
      ? fitPercent(natural.width, natural.height, box.width, box.height)
      : zoom.percent
    : 100;

  const applyZoom = useCallback(
    (next: SavedImageState) => {
      setZoom(next);
      onStateChange(next);
    },
    [onStateChange],
  );
  const setPercent = useCallback((value: number) => applyZoom({ mode: "manual", percent: clampZoom(value) }), [applyZoom]);
  const fit = useCallback(() => applyZoom({ mode: "fit", percent: 100 }), [applyZoom]);

  // Status bar: size, dimensions, zoom control.
  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (natural) items.unshift(t("viewer.dimensions", { width: natural.width, height: natural.height }));
    onStatus({ items, zoom: natural ? { percent, min: MIN_ZOOM, max: MAX_ZOOM, set: setPercent, fit } : undefined });
  }, [info.size, i18n.language, natural, percent, onStatus, setPercent, fit, t]);

  // Keyboard zoom, only while this tab is visible and not typing.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setPercent(nextZoom(percent, 1));
      } else if (event.key === "-") {
        event.preventDefault();
        setPercent(nextZoom(percent, -1));
      } else if (event.key === "0") {
        event.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, percent, setPercent, fit]);

  // Ctrl+wheel zooms around the pointer; a plain wheel scrolls. A native
  // listener, because React's wheel listener cannot cancel the event.
  const percentRef = useRef(percent);
  percentRef.current = percent;
  const hasImage = natural !== null;
  useEffect(() => {
    const element = boxRef.current;
    if (!element || !hasImage) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left + element.scrollLeft;
      const pointerY = event.clientY - rect.top + element.scrollTop;
      const current = percentRef.current;
      const next = nextZoom(current, event.deltaY < 0 ? 1 : -1);
      const ratio = next / current;
      setPercent(next);
      requestAnimationFrame(() => {
        element.scrollLeft = pointerX * ratio - (event.clientX - rect.left);
        element.scrollTop = pointerY * ratio - (event.clientY - rect.top);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [hasImage, setPercent]);

  // Drag to pan when the image is larger than the view.
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !boxRef.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: boxRef.current.scrollLeft, top: boxRef.current.scrollTop };
  };
  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!drag.current || !boxRef.current) return;
    boxRef.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    boxRef.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  if (failed) {
    return (
      <div className="adp-viewer-message" role="alert">
        <p>{t("viewer.imageError")}</p>
        <Button variant="primary" onClick={onOpenInWindowsApp}>
          {t("fileTab.openInWindowsApp")}
        </Button>
      </div>
    );
  }

  const width = natural ? Math.max(1, Math.round((natural.width * percent) / 100)) : 0;
  const height = natural ? Math.max(1, Math.round((natural.height * percent) / 100)) : 0;
  return (
    <div
      ref={boxRef}
      className="adp-image-view"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {!natural ? (
        <div className="adp-image-loading" role="status" aria-label={t("components.loading")}>
          <div className="adp-skeleton-tile adp-image-skeleton" />
          {slow ? <p>{t("viewer.loadingImage")}</p> : null}
        </div>
      ) : null}
      <div className="adp-image-stage" style={natural ? { width, height } : undefined}>
        <img
          className="adp-image-checker"
          src={url}
          alt={info.name}
          decoding="async"
          draggable={false}
          style={natural ? { width, height } : { visibility: "hidden" }}
          onLoad={(event) =>
            // SVGs without a size report 0: show them at 800 x 600.
            setNatural({ width: event.currentTarget.naturalWidth || 800, height: event.currentTarget.naturalHeight || 600 })
          }
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
