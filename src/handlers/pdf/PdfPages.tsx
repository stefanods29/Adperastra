import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../components/Skeleton";
import { fileUrl } from "../../services/files";
import type { PdfPageImage, PdfPageInfo, PdfRotation, PdfSearchMatch, PdfSession, PdfTextPage } from "../../services/pdf";
import OcrOverlay from "../../ocr/OcrOverlay";
import type { OcrMatch } from "../../ocr/ocrSelection";
import type { OcrPage } from "../../services/ocr";
import { pdfRunBox, pdfViewportSize } from "./pdfCoordinates";
import { clampPage, PDF_PAGE_GAP, pdfPageRowHeight } from "./pdfState";

/** The scrolling pages of one PDF (Step 07d T4).
 *
 * Only the pages the virtualizer shows are mounted; a page paints its
 * bounded PNG and, as it becomes visible, a transparent text layer placed
 * with the exact viewport transform, so the user can select real text
 * without any PDF HTML reaching the app's DOM (D7). */

/** A4 in PDF points, used only to estimate rows whose size is not known yet. */
const A4: PdfPageInfo = { page: 1, width_pt: 595, height_pt: 842, rotation: 0 };

export interface PdfPagesProps {
  session: PdfSession;
  page: number;
  zoom: number;
  rotation: PdfRotation;
  pageInfos: ReadonlyMap<number, PdfPageInfo>;
  /** Page images by `page:bucket` key. */
  images: ReadonlyMap<string, PdfPageImage>;
  texts: ReadonlyMap<number, PdfTextPage>;
  highlights: readonly PdfSearchMatch[];
  /** Recognized words for the current page, when OCR ran. */
  ocrPage?: OcrPage | null;
  ocrMatches?: readonly OcrMatch[];
  ocrMatchIndex?: number;
  onOcrSelection?: (text: string) => void;
  active: boolean;
  requestPage: (page: number, bucket: "page" | "thumbnail") => void;
  requestText: (page: number) => void;
  onVisiblePage: (page: number) => void;
  /** Scroll to this page when it arrives (null: nothing to do). */
  scrollTo: number | null;
  onScrolled: () => void;
}

export default function PdfPages({
  session,
  page,
  zoom,
  rotation,
  pageInfos,
  images,
  texts,
  highlights,
  ocrPage = null,
  ocrMatches = [],
  ocrMatchIndex = -1,
  onOcrSelection,
  active,
  requestPage,
  requestText,
  onVisiblePage,
  scrollTo,
  onScrolled,
}: PdfPagesProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageCount = session.page_count;
  const infoOf = (number: number): PdfPageInfo => pageInfos.get(number) ?? { ...A4, page: number };

  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => pdfPageRowHeight(infoOf(index + 1), zoom, rotation),
    overscan: 1,
    getItemKey: (index) => index + 1,
  });

  // New sizes (zoom, rotation, a page that arrived) re-measure the rows.
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, rotation, pageInfos]);

  useEffect(() => {
    if (scrollTo === null || !active) return;
    virtualizer.scrollToIndex(clampPage(scrollTo, pageCount) - 1, { align: "start" });
    onScrolled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo, active, pageCount]);

  // Every visible page asks for its image and, once, its text.
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!active) return;
    for (const item of items) {
      const number = item.index + 1;
      requestPage(number, "page");
      requestText(number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.map((item) => item.index).join(","), zoom, rotation]);

  // The page most in view is the current page. A container without a real
  // height (a hidden tab, a test) reports nothing: it cannot know.
  useEffect(() => {
    if (!active || items.length === 0) return;
    const height = scrollRef.current?.clientHeight ?? 0;
    if (height <= 0) return;
    const middle = height / 2;
    const nearest = items.reduce((best, item) =>
      Math.abs(item.start + item.size / 2 - middle) < Math.abs(best.start + best.size / 2 - middle) ? item : best,
    );
    const number = nearest.index + 1;
    if (number !== page) onVisiblePage(number);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.map((item) => item.index).join(","), page]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const next = clampPage(page + (event.key === "PageDown" ? 1 : -1), pageCount);
      if (next !== page) {
        onVisiblePage(next);
        virtualizer.scrollToIndex(next - 1, { align: "start" });
      }
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onVisiblePage(1);
      virtualizer.scrollToIndex(0, { align: "start" });
    }
    if (event.key === "End") {
      event.preventDefault();
      onVisiblePage(pageCount);
      virtualizer.scrollToIndex(pageCount - 1, { align: "start" });
    }
  };

  return (
    <div
      ref={scrollRef}
      className="adp-pdf-scroll"
      tabIndex={0}
      role="region"
      aria-label={t("pdf.canvas")}
      onKeyDown={onKeyDown}
      data-page={page}
      data-count={pageCount}
    >
      <div className="adp-pdf-pages" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const number = item.index + 1;
          const info = infoOf(number);
          const size = pdfViewportSize(info, zoom, rotation);
          const image = images.get(`${number}:page`);
          return (
            <div
              key={item.key}
              className="adp-pdf-page-row"
              style={{ transform: `translateY(${item.start}px)`, height: item.size, paddingBottom: PDF_PAGE_GAP }}
              data-page={number}
            >
              <div
                className="adp-pdf-page"
                style={{ width: Math.max(1, Math.ceil(size.width)), height: Math.max(1, Math.ceil(size.height)) }}
                aria-label={t("pdf.page", { page: number, count: pageCount })}
                role="group"
              >
                {image ? (
                  <img
                    className="adp-pdf-page-image"
                    src={fileUrl(image.image.token, image.image.name)}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    width={image.render_width}
                    height={image.render_height}
                    style={{ width: Math.max(1, Math.ceil(size.width)), height: Math.max(1, Math.ceil(size.height)) }}
                  />
                ) : (
                  <Skeleton variant="tiles" count={1} />
                )}
                <PdfTextLayer
                  number={number}
                  info={info}
                  zoom={zoom}
                  rotation={rotation}
                  text={texts.get(number)}
                  highlights={highlights.filter((match) => match.page === number)}
                />
                {ocrPage && ocrPage.page === number && image && onOcrSelection ? (
                  <OcrOverlay
                    result={ocrPage}
                    viewWidth={Math.max(1, Math.ceil(size.width))}
                    viewHeight={Math.max(1, Math.ceil(size.height))}
                    rotation={0}
                    zoom={Math.max(1, Math.ceil(size.width)) / image.render_width}
                    onSelectionText={onOcrSelection}
                    highlight={ocrMatches[ocrMatchIndex]?.words}
                  />
                ) : null}
              </div>
              <div className="adp-pdf-page-number" aria-hidden="true">
                {number}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Transparent, selectable text placed with the exact page transform. */
function PdfTextLayer({
  number,
  info,
  zoom,
  rotation,
  text,
  highlights,
}: {
  number: number;
  info: PdfPageInfo;
  zoom: number;
  rotation: PdfRotation;
  text: PdfTextPage | undefined;
  highlights: readonly PdfSearchMatch[];
}) {
  if (!text || text.runs.length === 0) return null;
  const highlighted = new Set(highlights.map((match) => String(match.run)));
  const runs = [...text.runs].sort((a, b) => a.order - b.order);
  return (
    <div className="adp-pdf-text" data-page={number} data-runs={runs.length} data-complete={text.complete}>
      {runs.map((run) => {
        const box = pdfRunBox(run, info, zoom, rotation);
        return (
          <span
            key={`${run.order}`}
            className={highlighted.has(String(run.order)) ? "adp-pdf-text-run adp-pdf-text-run--found" : "adp-pdf-text-run"}
            dir={run.direction}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              fontSize: Math.max(1, run.font_size * (zoom / 100)),
            }}
          >
            {run.text}
          </span>
        );
      })}
    </div>
  );
}
