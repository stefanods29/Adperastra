import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../components/Skeleton";
import { releaseCacheLease } from "../../services/cache";
import { errorText } from "../../services/errors";
import { fileUrl } from "../../services/files";
import { officeViewPage, type OfficePage } from "../../services/officeView";
import type { JobHandle } from "../../services/jobs";

interface PageSource {
  sessionId: string;
  sectionId: string;
  scale: number;
}

interface DocumentPagesProps extends PageSource {
  scrollRef: RefObject<HTMLElement | null>;
  pageCount: number;
  page: number;
  onPage: (page: number) => void;
  zoom: number;
}

export default function OfficeDocumentPages({ scrollRef, pageCount, page, onPage, zoom, ...source }: DocumentPagesProps) {
  const currentPage = useRef(page);
  currentPage.current = page;
  const scrollWidth = scrollRef.current?.clientWidth ?? 720;
  const surface = scrollRef.current;
  const padding = surface ? parseFloat(getComputedStyle(surface).paddingInlineStart) * 2 : 0;
  const pageWidth = Math.max(1, Math.min(scrollWidth - padding, 1200)) * zoom / 100;
  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pageWidth * 4 / 3 + 48,
    overscan: 1,
  });
  const items = virtualizer.getVirtualItems();
  const middle = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 2;
  const visiblePage = items.find((item) => item.start <= middle && item.end > middle)?.index;

  useEffect(() => {
    if (visiblePage !== undefined && visiblePage + 1 !== page) onPage(visiblePage + 1);
  }, [onPage, page, visiblePage]);

  useEffect(() => {
    virtualizer.measure();
    const offset = virtualizer.getOffsetForIndex(currentPage.current - 1, "start");
    if (offset) virtualizer.scrollToOffset(offset[0]);
  }, [virtualizer, zoom]);

  useEffect(() => {
    const surface = scrollRef.current;
    if (!surface) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const forward = event.key === "ArrowRight" || event.key === "PageDown";
      const backward = event.key === "ArrowLeft" || event.key === "PageUp";
      if (!forward && !backward) return;
      event.preventDefault();
      const next = Math.max(1, Math.min(pageCount, page + (forward ? 1 : -1)));
      if (next !== page) {
        const offset = virtualizer.getOffsetForIndex(next - 1, "start");
        if (offset) virtualizer.scrollToOffset(offset[0]);
      }
    };
    surface.addEventListener("keydown", handleKey);
    return () => surface.removeEventListener("keydown", handleKey);
  }, [page, pageCount, scrollRef, virtualizer]);

  return (
    <div className="adp-office-document-pages" style={{ height: virtualizer.getTotalSize(), minWidth: pageWidth }}>
      {items.map((item) => (
        <div key={item.key} ref={virtualizer.measureElement} data-index={item.index}
          className="adp-office-document-page-row" style={{ transform: `translateY(${item.start}px)` }}>
          <DocumentPage {...source} page={item.index + 1} pageCount={pageCount} width={pageWidth} />
        </div>
      ))}
    </div>
  );
}

function DocumentPage({ sessionId, sectionId, scale, page, pageCount, width }: PageSource & { page: number; pageCount: number; width: number }) {
  const { t } = useTranslation();
  const [image, setImage] = useState<OfficePage | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let disposed = false;
    let job: JobHandle<OfficePage> | undefined;
    let lease: string | undefined;
    void (async () => {
      try {
        job = await officeViewPage(sessionId, sectionId, page, scale);
        if (disposed) void job.cancel();
        const result = await job.completion;
        if (disposed) {
          await releaseCacheLease(result.image.lease_id).catch(() => undefined);
        } else {
          lease = result.image.lease_id;
          setImage(result);
        }
      } catch (caught) {
        if (!disposed) setError(caught);
      }
    })();
    return () => {
      disposed = true;
      if (lease) void releaseCacheLease(lease).catch(() => undefined);
      else if (job) void job.cancel();
    };
  }, [page, scale, sectionId, sessionId]);

  const label = t("office.pageOf", { page, count: pageCount });
  return (
    <figure className="adp-office-page" style={{ width }}>
      {image ? (
        <img src={fileUrl(image.image.token, image.image.name)} alt={label}
          width={image.image.width} height={image.image.height} />
      ) : (
        <div className="adp-office-document-page-placeholder">
          {error ? <p role="alert">{errorText(t, error, "office")}</p> : <Skeleton variant="rows" count={6} />}
        </div>
      )}
      <figcaption className="adp-office-page-caption">{label}</figcaption>
    </figure>
  );
}
