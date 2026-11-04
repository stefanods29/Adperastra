import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import PaperPage from "./PaperPage";

interface Props extends Omit<ComponentProps<typeof PaperPage>, "width" | "page"> {
  slide: boolean;
  page: number;
  onPage: (page: number) => void;
  zoom: number;
}

export default function PaperCanvas({ slide, page, onPage, zoom, ...props }: Props) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(900);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setAvailable(Math.max(240, element.clientWidth - 64));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.min(available, slide ? 1100 : 840) * zoom / 100;
  const virtualizer = useVirtualizer({
    count: props.layout.pages,
    getScrollElement: () => scroll.current,
    estimateSize: () => width * 1.414 + 48,
    overscan: 1,
    enabled: !slide,
  });
  const virtualPages = virtualizer.getVirtualItems();
  const middle = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 2;
  const visible = virtualPages.find(row => row.start <= middle && row.end > middle)?.index;
  useEffect(() => {
    if (!slide && visible !== undefined && visible + 1 !== page && !props.draft) onPage(visible + 1);
  }, [slide, visible, page, props.draft, onPage]);
  const choose = (value: number) => {
    onPage(value);
    if (!slide && !props.draft) virtualizer.scrollToIndex(value - 1, { align: "start" });
  };
  return <div className="adp-paper-body">
    {slide ? <nav className="adp-paper-slides" aria-label={t("office.slides")}>
      {Array.from({ length: props.layout.pages }, (_, index) => <button key={index} type="button"
        className="adp-paper-slide-button" aria-current={page === index + 1 ? "page" : undefined}
        disabled={!!props.draft} onClick={() => choose(index + 1)}>
        {t("office.paperSlide", { index: index + 1 })}
      </button>)}
    </nav> : null}
    <div className="adp-paper-scroll" ref={scroll} tabIndex={0}
      onKeyDown={event => {
        if (props.draft || event.ctrlKey || event.altKey || event.metaKey) return;
        const forward = ["PageDown", "ArrowRight"].includes(event.key);
        const back = ["PageUp", "ArrowLeft"].includes(event.key);
        if (forward || back) {
          event.preventDefault();
          choose(Math.max(1, Math.min(props.layout.pages, page + (forward ? 1 : -1))));
        }
      }}>
      {slide ? <PaperPage {...props} page={page} width={width} /> : (
        <div className="adp-paper-pages" style={{ height: virtualizer.getTotalSize(), minWidth: width + 64 }}>
          {virtualPages.map(row => <div className="adp-paper-page-row" key={row.key}
            ref={virtualizer.measureElement} data-index={row.index} style={{ transform: `translateY(${row.start}px)` }}>
            <PaperPage {...props} page={row.index + 1} width={width} />
          </div>)}
        </div>
      )}
    </div>
  </div>;
}
