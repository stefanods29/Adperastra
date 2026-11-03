/** The virtualized photo grid (Step 07c, decision D7).
 *
 * Cell 184x216, gap 12, padding 16, group header 32; the 160 px thumbnail is
 * requested through 07a `FileThumbnail` (never a second decoder). Keyboard and
 * selection semantics follow the existing Step 05a grid helpers, and only the
 * viewport plus four overscan rows are mounted. */

import { useVirtualizer } from "@tanstack/react-virtual";
import { Cloud, Image as ImageIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import FileThumbnail from "../../components/FileThumbnail";
import { displayName } from "../../services/names";
import {
  moveFocusTo,
  selectAll,
  selectOnly,
  selectRange,
  toggleFocused,
  toggleItem,
  type SelectionState,
} from "../../services/selection";
import type { GalleryItem } from "../../services/gallery";
import { buildGridLayout, columnsFor, gridMove, lineOfIndex, type GridMove } from "../explorer/views/gridLayout";
import { FALLBACK_WIDTH } from "../explorer/views/viewModes";
import type { GalleryGroup } from "./galleryDates";

export const GALLERY_CELL_WIDTH = 184;
export const GALLERY_CELL_HEIGHT = 216;
export const GALLERY_GAP = 12;
export const GALLERY_PADDING = 16;
export const GALLERY_HEADER_HEIGHT = 32;
export const GALLERY_THUMBNAIL = 160;
export const GALLERY_OVERSCAN = 4;

/** The smallest 07a bucket at least the visible thumbnail's device pixels. */
export function galleryThumbnailEdge(): 64 | 128 | 256 {
  const ratio =
    typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1;
  const need = GALLERY_THUMBNAIL * ratio;
  // Buckets are 64/128/256; 160 CSS px needs the 256 bucket at every ratio
  // above 0.8, so the top bucket is normally requested.
  if (need > 128) return 256;
  if (need > 64) return 128;
  return 64;
}

/** How many 184 px cells fit at a width; at least one. */
export function galleryColumns(width: number): number {
  const usable = Math.max(0, (width || FALLBACK_WIDTH) - GALLERY_PADDING * 2);
  return Math.max(1, columnsFor(usable, GALLERY_CELL_WIDTH, GALLERY_GAP));
}

const GRID_KEYS: Record<string, GridMove> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
  PageUp: "pageUp",
  PageDown: "pageDown",
};

export interface GalleryGridProps {
  groups: readonly GalleryGroup[];
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
  onOpen: (item: GalleryItem, background?: boolean) => void;
  onPreview: (item: GalleryItem, origin: HTMLElement | null) => void;
  showExtensions: boolean;
  /** False while another tab is shown: thumbnails stop requesting work. */
  active: boolean;
  label: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onFirstPaint?: () => void;
  onVisibleItems?: (items: readonly GalleryItem[]) => void;
  onPointerActive?: (active: boolean) => void;
}

export default function GalleryGrid({
  groups,
  selection,
  onSelectionChange,
  onOpen,
  onPreview,
  showExtensions,
  active,
  label,
  hasMore,
  loadingMore,
  onLoadMore,
  onFirstPaint, onVisibleItems, onPointerActive,
}: GalleryGridProps) {
  const { t } = useTranslation();
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const paintedRef = useRef(false);
  const [width, setWidth] = useState(0);

  const orderItems = useMemo(() => {
    const items: GalleryItem[] = [];
    for (const group of groups) items.push(...group.items);
    return items;
  }, [groups]);
  const order = useMemo(() => orderItems.map((item) => item.item.path), [orderItems]);
  const groupSizes = useMemo(() => groups.map((group) => group.items.length), [groups]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = galleryColumns(width);
  const layout = useMemo(
    () => buildGridLayout(groupSizes, columns, true),
    [columns, groupSizes],
  );

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = layout.rows[index];
      return row?.type === "header"
        ? GALLERY_HEADER_HEIGHT
        : GALLERY_CELL_HEIGHT + GALLERY_GAP;
    },
    getItemKey: (index) => layout.rows[index]?.key ?? index,
    overscan: GALLERY_OVERSCAN,
    paddingStart: GALLERY_PADDING,
    paddingEnd: GALLERY_PADDING,
  });

  useEffect(() => {
    if (paintedRef.current || orderItems.length === 0) return;
    paintedRef.current = true;
    const handle = requestAnimationFrame(() => onFirstPaint?.());
    return () => cancelAnimationFrame(handle);
  }, [onFirstPaint, orderItems.length]);

  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;
  const visibleSignature = virtualRows.map(row => row.index).join(",");
  useEffect(() => {
    if (!onVisibleItems) return;
    const scroll = scrollRef.current;
    const top = scroll?.scrollTop ?? 0;
    const bottom = top + (scroll?.clientHeight || 600);
    const visible: GalleryItem[] = [];
    for (const virtual of virtualRows) {
      const row = layout.rows[virtual.index];
      if (row?.type !== "cells" || virtual.start > bottom || top > virtual.start + GALLERY_CELL_HEIGHT) continue;
      for (let offset = 0; offset < row.count && visible.length < 24; offset++) {
        const item = orderItems[row.first + offset]; if (item) visible.push(item);
      }
    }
    onVisibleItems(visible);
  }, [visibleSignature, layout, onVisibleItems, orderItems]);

  useEffect(() => {
    if (!hasMore || loadingMore || lastVirtualIndex < 0) return;
    if (lastVirtualIndex >= layout.rows.length - 1 - 2) onLoadMore();
  }, [hasMore, lastVirtualIndex, layout.rows.length, loadingMore, onLoadMore]);

  const focusIndex =
    selection.focus !== null ? order.indexOf(selection.focus) : -1;
  useEffect(() => {
    if (focusIndex < 0) return;
    const line = lineOfIndex(layout, focusIndex);
    if (line >= 0) virtualizer.scrollToIndex(layout.lines[line], { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex]);

  const itemId = (index: number) => `${listId}-photo-${index}`;
  const originFor = (index: number): HTMLElement | null =>
    (scrollRef.current?.querySelector(`[data-index="${index}"]`) as HTMLElement | null) ??
    scrollRef.current;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== scrollRef.current) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const current = selection.focus !== null ? order.indexOf(selection.focus) : -1;
    if (!event.altKey) {
      const move = GRID_KEYS[event.key];
      if (move) {
        event.preventDefault();
        const height = scrollRef.current?.clientHeight ?? 0;
        const pageLines = Math.max(
          1,
          Math.floor(height / (GALLERY_CELL_HEIGHT + GALLERY_GAP)) - 1,
        );
        const target = gridMove(layout, current, move, pageLines);
        if (target >= 0) {
          onSelectionChange(
            moveFocusTo(selection, order, target, {
              shift: event.shiftKey,
              ctrl,
            }),
          );
        }
        return;
      }
    }
    if (ctrl && !event.shiftKey && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      onSelectionChange(selectAll(selection, order));
      return;
    }
    if (ctrl && event.key === " ") {
      event.preventDefault();
      onSelectionChange(toggleFocused(selection));
      return;
    }
    if (event.key === "Enter") {
      const item = current >= 0 ? orderItems[current] : undefined;
      if (item) {
        event.preventDefault();
        onOpen(item, false);
      }
      return;
    }
    if (event.key === " ") {
      const item = current >= 0 ? orderItems[current] : undefined;
      if (item) {
        event.preventDefault();
        onPreview(item, originFor(current));
      }
    }
  };

  const onItemClick = (event: ReactMouseEvent, item: GalleryItem) => {
    event.stopPropagation();
    if (event.shiftKey) {
      onSelectionChange(
        selectRange(selection, order, item.item.path, event.ctrlKey || event.metaKey),
      );
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      onSelectionChange(toggleItem(selection, item.item.path));
      return;
    }
    onSelectionChange(selectOnly(item.item.path));
  };

  const onItemContextMenu = (event: ReactMouseEvent, item: GalleryItem) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selection.selected.has(item.item.path)) {
      onSelectionChange(selectOnly(item.item.path));
    }
  };

  const onListClick = () => {
    if (selection.selected.size > 0) {
      onSelectionChange({ ...selection, selected: new Set() });
    }
  };

  const renderItem = (index: number) => {
    const item = orderItems[index];
    if (!item) return null;
    const selected = selection.selected.has(item.item.path);
    const focused = selection.focus === item.item.path;
    const name = displayName(item.item.name, item.item.kind, showExtensions);
    const className = [
      "adp-gallery-cell",
      selected ? "adp-gallery-cell--selected" : "",
      focused ? "adp-gallery-cell--focused" : "",
      item.item.hidden || item.item.system ? "adp-gallery-cell--hidden" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={item.item.path}
        id={itemId(index)}
        data-index={index}
        role="option"
        aria-selected={selected}
        className={className}
        style={{ width: GALLERY_CELL_WIDTH }}
        onClick={(event) => onItemClick(event, item)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpen(item, false);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) onOpen(item, true);
        }}
        onContextMenu={(event) => onItemContextMenu(event, item)}
      >
        <span
          className="adp-gallery-thumb"
          style={{ width: GALLERY_THUMBNAIL, height: GALLERY_THUMBNAIL }}
          aria-hidden="true"
        >
          <FileThumbnail
            path={item.item.path}
            edge={galleryThumbnailEdge()}
            active={active && !item.item.online_only}
            sourceRevision={item.item}
            fallback={
              <span className="adp-gallery-fallback">
                <ImageIcon size={48} aria-hidden="true" />
              </span>
            }
          />
        </span>
        <span className="adp-file-name adp-gallery-name" title={name}>
          {name}
        </span>
        {item.item.online_only ? (
          <span
            className="adp-file-badge adp-gallery-badge"
            title={t("explorer.onlineOnly")}
            aria-label={t("explorer.onlineOnly")}
          >
            <Cloud size={12} aria-hidden="true" />
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="adp-gallery-grid">
      <div
        ref={scrollRef}
        className="adp-gallery-scroll"
        role="listbox"
        aria-multiselectable="true"
        aria-label={label}
        aria-activedescendant={focusIndex >= 0 ? itemId(focusIndex) : undefined}
        tabIndex={0}
        onPointerEnter={() => onPointerActive?.(true)}
        onPointerLeave={() => onPointerActive?.(false)}
        onBlur={() => onPointerActive?.(false)}
        onKeyDown={onKeyDown}
        onClick={onListClick}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div
          className="adp-gallery-inner"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualRows.map((virtualRow) => {
            const row = layout.rows[virtualRow.index];
            if (!row) return null;
            const style = {
              transform: `translateY(${virtualRow.start}px)`,
              height:
                row.type === "header" ? GALLERY_HEADER_HEIGHT : GALLERY_CELL_HEIGHT,
            };
            if (row.type === "header") {
              const group = groups[row.group];
              return (
                <div
                  key={row.key}
                  role="presentation"
                  className="adp-gallery-header"
                  style={style}
                >
                  <span>{group?.label || t("gallery.undated")}</span>
                  <span className="adp-gallery-count">{group?.items.length ?? 0}</span>
                  <span className="adp-gallery-rule" aria-hidden="true" />
                </div>
              );
            }
            return (
              <div
                key={row.key}
                role="presentation"
                className="adp-gallery-row"
                style={{ ...style, gap: GALLERY_GAP }}
              >
                {Array.from({ length: row.count }, (_, offset) =>
                  renderItem(row.first + offset),
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
