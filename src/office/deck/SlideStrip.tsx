import { useVirtualizer } from "@tanstack/react-virtual";
import { EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SLIDE_ROW_HEIGHT,
  SLIDE_STRIP_MAX,
  SLIDE_STRIP_MIN,
  SLIDE_THUMBNAIL_HEIGHT,
  SLIDE_THUMBNAIL_WIDTH,
  clampPanelSize,
} from "./deckCoordinates";

/** One slide row in the left strip. Mapped from the 20a slide item page. */
export interface DeckSlideSummary {
  id: string;
  index: number;
  hidden: boolean;
  title: string;
  layout_id: string;
  /** Bounded preview only; never treated as the full notes text. */
  notes_preview?: string;
}

export interface SlideStripProps {
  slides: readonly DeckSlideSummary[];
  selectedIds: readonly string[];
  activeSlideId: string | null;
 /** Rendered thumbnail URLs keyed by slide id; absent entries stay neutral. */
  thumbnails?: Readonly<Record<string, string>>;
  width: number;
  onResize: (width: number) => void;
  onSelect: (slideId: string, mode: "replace" | "add" | "range") => void;
  onReorder: (slideId: string, beforeId: string | null) => void;
  onOpenHelp: (slug: string) => void;
}

/** Virtualized slide thumbnails (Step 22a T2, D2). The strip mounts only
 * the visible thumbnails plus four rows; 10,000 slides never create 10,000
 * DOM nodes. Dragging is a local, inert preview and commits one move on
 * release; Escape cancels it. */
export default function SlideStrip({
  slides,
  selectedIds,
  activeSlideId,
  thumbnails,
  width,
  onResize,
  onSelect,
  onReorder,
  onOpenHelp,
}: SlideStripProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // A reorder can complete before React has re-rendered the pointerdown
  // state; the ref keeps the drag source available for the pointerup.
  const draggingRef = useRef<string | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const virtualizer = useVirtualizer({
    count: slides.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SLIDE_ROW_HEIGHT,
    overscan: 4,
  });

  useEffect(() => {
    if (!activeSlideId) return;
    const index = slides.findIndex((slide) => slide.id === activeSlideId);
    if (index >= 0) virtualizer.scrollToIndex(index);
  }, [activeSlideId, slides, virtualizer]);

  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        draggingRef.current = null;
        setDragging(null);
        setDropTarget(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dragging]);

  const selected = new Set(selectedIds);

  return (
    <div
      className="adp-deck-strip"
      style={{ width }}
      role="group"
      aria-label={t("officeDeck.slidesPane")}
    >
      <div className="adp-deck-strip-head">
        <span>{t("officeDeck.slides")}</span>
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("help.title")}
          title={t("help.title")}
          onClick={() => onOpenHelp("editing-presentations")}
        >
          ?
        </button>
      </div>
      <div className="adp-deck-strip-scroll" ref={scrollRef} role="listbox" aria-label={t("officeDeck.slides")}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const slide = slides[row.index];
            if (!slide) return null;
            const isSelected = selected.has(slide.id);
            const thumbnail = thumbnails?.[slide.id];
            return (
              <div
                key={slide.id}
                role="option"
                aria-selected={isSelected}
                aria-label={t("officeDeck.slideLabel", { slide: slide.index + 1 })}
                className={
                  "adp-deck-thumb" +
                  (isSelected ? " adp-deck-thumb--selected" : "") +
                  (activeSlideId === slide.id ? " adp-deck-thumb--active" : "") +
                  (dropTarget === slide.id ? " adp-deck-thumb--drop" : "")
                }
                data-slide-id={slide.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: SLIDE_THUMBNAIL_HEIGHT,
                  transform: `translateY(${row.start}px)`,
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  const mode = event.ctrlKey || event.metaKey ? "add" : event.shiftKey ? "range" : "replace";
                  onSelect(slide.id, mode);
                  draggingRef.current = slide.id;
                  setDragging(slide.id);
                }}
                onPointerEnter={() => {
                  if (draggingRef.current && draggingRef.current !== slide.id) setDropTarget(slide.id);
                }}
                onPointerUp={() => {
                  const source = draggingRef.current;
                  if (source && source !== slide.id) onReorder(source, slide.id);
                  draggingRef.current = null;
                  setDragging(null);
                  setDropTarget(null);
                }}
              >
                <span className="adp-deck-thumb-number" aria-hidden="true">
                  {slide.index + 1}
                </span>
                {thumbnail ? (
                  <img
                    className="adp-deck-thumb-image"
                    src={thumbnail}
                    width={SLIDE_THUMBNAIL_WIDTH}
                    height={SLIDE_THUMBNAIL_HEIGHT}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span className="adp-deck-thumb-empty" aria-hidden="true" />
                )}
                {slide.hidden ? (
                  <span className="adp-deck-thumb-hidden" title={t("officeDeck.hidden")}>
                    <EyeOff size={12} aria-hidden="true" />
                    <span>{t("officeDeck.hidden")}</span>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="adp-deck-strip-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("officeDeck.slidesPaneWidth")}
        tabIndex={0}
        onPointerDown={(event) => {
          resizeRef.current = { startX: event.clientX, startWidth: width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = resizeRef.current;
          if (!start) return;
          onResize(clampPanelSize(start.startWidth + event.clientX - start.startX, SLIDE_STRIP_MIN, SLIDE_STRIP_MAX, width));
        }}
        onPointerUp={() => {
          resizeRef.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? -8 : 8;
          onResize(clampPanelSize(width + delta, SLIDE_STRIP_MIN, SLIDE_STRIP_MAX, width));
        }}
      />
    </div>
  );
}
