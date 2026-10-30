import { Expand, RotateCcw, RotateCw, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { clampZoom, fitPercent, MAX_ZOOM, MIN_ZOOM, nextZoom } from "./zoom";

interface SavedImageState {
  mode: "fit" | "manual";
  percent: number;
  /** Clockwise quarter turns for viewing (0-3); the file never changes. */
  turns: number;
}

interface ImageCtx {
  hasImage: boolean;
  mode: "fit" | "manual";
  percent: number;
}

function readSaved(state: unknown): SavedImageState {
  const value = (state ?? {}) as Partial<SavedImageState>;
  const turns = typeof value.turns === "number" ? ((Math.round(value.turns) % 4) + 4) % 4 : 0;
  if (value.mode === "manual" && typeof value.percent === "number") return { mode: "manual", percent: clampZoom(value.percent), turns };
  return { mode: "fit", percent: 100, turns };
}

const RIBBON: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "zoom",
          labelKey: "ribbon.zoom",
          controls: [
            { type: "button", command: "image.zoomIn", showLabel: false, keyTip: "I" },
            { type: "button", command: "image.zoomOut", showLabel: false, keyTip: "O" },
            { type: "toggle", command: "image.fit", keyTip: "F" },
            { type: "toggle", command: "image.actualSize", keyTip: "A" },
          ],
        },
        {
          id: "rotate",
          labelKey: "ribbon.rotate",
          controls: [
            { type: "button", command: "image.rotateLeft", keyTip: "L" },
            { type: "button", command: "image.rotateRight", keyTip: "R" },
          ],
        },
      ],
    },
  ],
};

/** Image viewer (Steps 04a, 04b): fit to window, zoom with Ctrl+wheel and
 * Ctrl+=/Ctrl+-/Ctrl+0, pan by dragging, rotate the view, checkerboard
 * behind transparency. The browser decodes the image (`decoding="async"`). */
export default function ImageView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<SavedImageState>(() => readSaved(savedState));
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

  // Quarter turns swap width and height.
  const sideways = view.turns % 2 === 1;
  const shown = natural ? (sideways ? { width: natural.height, height: natural.width } : natural) : null;
  const percent = shown ? (view.mode === "fit" ? fitPercent(shown.width, shown.height, box.width, box.height) : view.percent) : 100;

  const apply = useCallback(
    (patch: Partial<SavedImageState>) => {
      setView((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );
  const setPercent = useCallback((value: number) => apply({ mode: "manual", percent: clampZoom(value) }), [apply]);
  const fit = useCallback(() => apply({ mode: "fit", percent: 100 }), [apply]);

  // Status bar: dimensions, size, zoom control.
  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (natural) items.unshift(t("viewer.dimensions", { width: natural.width, height: natural.height }));
    onStatus({ items, zoom: natural ? { percent, min: MIN_ZOOM, max: MAX_ZOOM, set: setPercent, fit } : undefined });
  }, [info.size, i18n.language, natural, percent, onStatus, setPercent, fit, t]);

  const ctx: ImageCtx = { hasImage: natural !== null, mode: view.mode, percent };
  const commands = useMemo<Command<ImageCtx>[]>(
    () => [
      { id: "image.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage && c.percent < MAX_ZOOM, run: (c) => setPercent(nextZoom(c.percent, 1)) },
      { id: "image.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage && c.percent > MIN_ZOOM, run: (c) => setPercent(nextZoom(c.percent, -1)) },
      { id: "image.fit", labelKey: "viewer.fitToWindow", icon: Expand, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-images", checkKind: "radio", checkedWhen: (c) => c.mode === "fit", enabledWhen: (c) => c.hasImage, run: () => fit() },
      { id: "image.actualSize", labelKey: "viewer.actualSize", icon: Scan, risk: "read-only", helpSlug: "viewing-images", checkKind: "radio", checkedWhen: (c) => c.mode === "manual" && c.percent === 100, enabledWhen: (c) => c.hasImage, run: () => setPercent(100) },
      { id: "image.rotateLeft", labelKey: "viewer.rotateLeft", icon: RotateCcw, risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage, run: () => setView((current) => { const next = { ...current, turns: (current.turns + 3) % 4 }; onStateChange(next); return next; }) },
      { id: "image.rotateRight", labelKey: "viewer.rotateRight", icon: RotateCw, risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage, run: () => setView((current) => { const next = { ...current, turns: (current.turns + 1) % 4 }; onStateChange(next); return next; }) },
    ],
    [setPercent, fit, onStateChange],
  );
  useCommandShortcuts(commands, ctx, active);

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
  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !boxRef.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: boxRef.current.scrollLeft, top: boxRef.current.scrollTop };
  };
  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!drag.current || !boxRef.current) return;
    boxRef.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    boxRef.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const ribbon = <Ribbon def={RIBBON} ctx={ctx} commands={commands} accent="image" active={active} />;

  if (failed) {
    return (
      <ViewerFrame ribbon={ribbon}>
        <div className="adp-viewer-message" role="alert">
          <p>{t("viewer.imageError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      </ViewerFrame>
    );
  }

  // The stage has the turned size; the image keeps its own size and is
  // turned around the stage's center.
  const imageWidth = natural ? Math.max(1, Math.round((natural.width * percent) / 100)) : 0;
  const imageHeight = natural ? Math.max(1, Math.round((natural.height * percent) / 100)) : 0;
  const stageWidth = sideways ? imageHeight : imageWidth;
  const stageHeight = sideways ? imageWidth : imageHeight;
  return (
    <ViewerFrame ribbon={ribbon}>
      <div ref={boxRef} className="adp-image-view" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endDrag} onMouseLeave={endDrag}>
        {!natural ? (
          <div className="adp-image-loading" role="status" aria-label={t("components.loading")}>
            <div className="adp-skeleton-tile adp-image-skeleton" />
            {slow ? <p>{t("viewer.loadingImage")}</p> : null}
          </div>
        ) : null}
        <div className="adp-image-stage" style={natural ? { width: stageWidth, height: stageHeight } : undefined}>
          <img
            className="adp-image-checker"
            src={url}
            alt={info.name}
            decoding="async"
            draggable={false}
            style={
              natural
                ? {
                    width: imageWidth,
                    height: imageHeight,
                    transform: `translate(${(stageWidth - imageWidth) / 2}px, ${(stageHeight - imageHeight) / 2}px) rotate(${view.turns * 90}deg)`,
                  }
                : { visibility: "hidden" }
            }
            onLoad={(event) =>
              // SVGs without a size report 0: show them at 800 x 600.
              setNatural({ width: event.currentTarget.naturalWidth || 800, height: event.currentTarget.naturalHeight || 600 })
            }
            onError={() => setFailed(true)}
          />
        </div>
      </div>
    </ViewerFrame>
  );
}
