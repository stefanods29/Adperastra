import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../components/Skeleton";
import { fileUrl } from "../../services/files";
import type { PdfPageImage, PdfSession } from "../../services/pdf";
import PdfOutline from "./PdfOutline";
import { clampSidebarWidth, pdfSidebarMode, PDF_THUMBNAIL_ROW_HEIGHT } from "./pdfState";

/** Thumbnails and outline of one PDF (Step 07d T4/T5).
 *
 * One panel is open at a time, 196 px wide by default and draggable between
 * 160 and 320 px. Thumbnail rows are 144 px and virtualized, so a 1,000-page
 * document mounts only what is on screen. */

export interface PdfSidebarProps {
  session: PdfSession;
  sourceKey: string;
  page: number;
  thumbnailsOpen: boolean;
  outlineOpen: boolean;
  width: number;
  active: boolean;
  /** Thumbnails by `page:thumbnail` key. */
  images: ReadonlyMap<string, PdfPageImage>;
  requestPage: (page: number, bucket: "page" | "thumbnail") => void;
  onWidthChange: (width: number) => void;
  onSelectPage: (page: number) => void;
}

export default function PdfSidebar({
  session,
  sourceKey,
  page,
  thumbnailsOpen,
  outlineOpen,
  width,
  active,
  images,
  requestPage,
  onWidthChange,
  onSelectPage,
}: PdfSidebarProps) {
  const { t } = useTranslation();
  const mode = pdfSidebarMode(thumbnailsOpen, outlineOpen);
  if (mode === "none") return null;
  const label = mode === "thumbnails" ? t("pdf.thumbnails") : t("pdf.outline");
  return (
    <aside className="adp-pdf-sidebar" style={{ width: clampSidebarWidth(width) }} aria-label={label}>
      <div className="adp-pdf-sidebar-title">{label}</div>
      {mode === "thumbnails" ? (
        <PdfThumbnails
          session={session}
          page={page}
          active={active}
          images={images}
          requestPage={requestPage}
          onSelectPage={onSelectPage}
        />
      ) : (
        <PdfOutline sessionId={session.session_id} sourceKey={sourceKey} active={active} onGoToPage={onSelectPage} />
      )}
      <ResizeHandle width={width} onWidthChange={onWidthChange} />
    </aside>
  );
}

function PdfThumbnails({
  session,
  page,
  active,
  images,
  requestPage,
  onSelectPage,
}: {
  session: PdfSession;
  page: number;
  active: boolean;
  images: ReadonlyMap<string, PdfPageImage>;
  requestPage: (page: number, bucket: "page" | "thumbnail") => void;
  onSelectPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: session.page_count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PDF_THUMBNAIL_ROW_HEIGHT,
    overscan: 4,
    getItemKey: (index) => index + 1,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    if (!active) return;
    for (const item of items) requestPage(item.index + 1, "thumbnail");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.map((item) => item.index).join(",")]);

  useEffect(() => {
    if (!active) return;
    virtualizer.scrollToIndex(page - 1, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, active]);

  return (
    <div ref={scrollRef} className="adp-pdf-thumbnails">
      <div className="adp-pdf-thumbnails-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const number = item.index + 1;
          const image = images.get(`${number}:thumbnail`);
          const selected = number === page;
          return (
            <button
              key={item.key}
              type="button"
              className={selected ? "adp-pdf-thumb adp-pdf-thumb--selected" : "adp-pdf-thumb"}
              style={{ transform: `translateY(${item.start}px)`, height: PDF_THUMBNAIL_ROW_HEIGHT }}
              aria-current={selected ? "page" : undefined}
              aria-label={t("pdf.page", { page: number, count: session.page_count })}
              onClick={() => onSelectPage(number)}
              data-page={number}
            >
              <span className="adp-pdf-thumb-frame">
                {image ? (
                  <img src={fileUrl(image.image.token, image.image.name)} alt="" aria-hidden="true" draggable={false} />
                ) : (
                  <Skeleton variant="tiles" count={1} />
                )}
              </span>
              <span className="adp-pdf-thumb-number" aria-hidden="true">
                {number}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Drag the right edge of the sidebar between 160 and 320 px. */
function ResizeHandle({ width, onWidthChange }: { width: number; onWidthChange: (width: number) => void }) {
  const { t } = useTranslation();
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current) return;
      const delta = event.clientX - dragging.current.startX;
      onWidthChange(clampSidebarWidth(dragging.current.startWidth + delta));
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onWidthChange]);
  return (
    <div
      className="adp-pdf-sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("pdf.sidebarSize")}
      aria-valuemin={160}
      aria-valuemax={320}
      aria-valuenow={clampSidebarWidth(width)}
      onMouseDown={(event) => {
        dragging.current = { startX: event.clientX, startWidth: width };
      }}
    />
  );
}
