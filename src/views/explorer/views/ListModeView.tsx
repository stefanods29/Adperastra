import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Cloud, Link2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRowSizes } from "../../../appearance/density";
import type { ExplorerItem } from "../../../services/explorer";
import { displayName } from "../../../services/names";
import { fileTile } from "../fileTile";
import RenameInput from "../RenameInput";
import { flowMove, type GridMove } from "./gridLayout";
import { useItemInteractions, type ItemViewProps } from "./useItemInteractions";
import { FALLBACK_HEIGHT, GRID_PADDING, LIST_COLUMN_WIDTH } from "./viewModes";

const FLOW_KEYS: Record<string, GridMove> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
  PageUp: "pageUp",
  PageDown: "pageDown",
};

/** List view (Step 05a D2): items flow down a column, then on to the next
 * one; the list scrolls sideways. No group headers. */
export default function ListModeView(props: ItemViewProps) {
  const { t } = useTranslation();
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const paintedRef = useRef(false);
  const [height, setHeight] = useState(0);
  const { listItem: itemHeight } = useRowSizes();

  const orderItems = useMemo<ExplorerItem[]>(() => {
    if (!props.groups) return props.items;
    const out: ExplorerItem[] = [];
    for (const group of props.groups) out.push(...group.items);
    return out;
  }, [props.groups, props.items]);
  const order = useMemo(() => orderItems.map((item) => item.path), [orderItems]);

  // The height of the scroll area drives how many items fit in a column.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setHeight(element.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowsPerColumn = Math.max(
    1,
    Math.floor(((height || FALLBACK_HEIGHT) - GRID_PADDING * 2) / itemHeight),
  );
  const columnCount = Math.ceil(order.length / rowsPerColumn);

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_COLUMN_WIDTH,
    overscan: 2,
    paddingStart: GRID_PADDING,
    paddingEnd: GRID_PADDING,
  });

  useEffect(() => {
    paintedRef.current = false;
  }, [props.items]);

  useEffect(() => {
    if (paintedRef.current || props.items.length === 0) return;
    paintedRef.current = true;
    const handle = requestAnimationFrame(() => props.onFirstPaint?.());
    return () => cancelAnimationFrame(handle);
  }, [props.items, props]);

  // Keep the caret's column on screen when it moves (keyboard, type-ahead,
  // "Show in folder").
  const focus = props.selection.focus;
  useEffect(() => {
    if (focus === null) return;
    const index = order.indexOf(focus);
    if (index < 0) return;
    virtualizer.scrollToIndex(Math.floor(index / rowsPerColumn), { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const interactions = useItemInteractions(props, {
    order,
    orderItems,
    scrollRef,
    moveTarget: (key, current) => {
      const move = FLOW_KEYS[key];
      if (!move) return null;
      const width = scrollRef.current?.clientWidth ?? 0;
      const pageColumns = Math.max(1, Math.floor(width / LIST_COLUMN_WIDTH));
      return flowMove(orderItems.length, rowsPerColumn, pageColumns, current, move);
    },
    elementForIndex: (index) => scrollRef.current?.querySelector(`[data-index="${index}"]`) ?? null,
  });

  // React's wheel prop is passive, so the sideways scroll uses a native
  // listener that can stop the page from moving. Ctrl+wheel is left to the
  // view switcher (ItemView).
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      element.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 40 : 1);
      event.preventDefault();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const itemId = (index: number) => `${listId}-item-${index}`;
  const focusIndex = props.selection.focus !== null ? order.indexOf(props.selection.focus) : -1;

  const renderItem = (index: number) => {
    const item = orderItems[index];
    if (!item) return null;
    const selected = props.selection.selected.has(item.path);
    const focused = props.selection.focus === item.path;
    const renaming = props.renamingPath === item.path;
    const tile = fileTile(item.name, item.kind);
    const Icon = tile.icon;
    const shownName = displayName(item.name, item.kind, props.showExtensions);
    const isContainer = item.kind === "folder" || item.kind === "drive";
    const className = [
      "adp-itemgrid-cell",
      "adp-itemgrid-cell--inline",
      "adp-flowlist-item",
      selected ? "adp-itemgrid-cell--selected" : "",
      focused ? "adp-itemgrid-cell--focused" : "",
      item.hidden || item.system ? "adp-itemgrid-cell--hidden" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={item.path}
        id={itemId(index)}
        data-index={index}
        role="option"
        aria-selected={selected}
        className={className}
        data-drop-folder={isContainer ? item.path : undefined}
        data-drop-name={isContainer ? item.name : undefined}
        onMouseDown={(event) => props.onItemMouseDown?.(event, item)}
        onClick={(event) => interactions.onItemClick(event, item)}
        onDoubleClick={(event) => interactions.onItemDoubleClick(event, item)}
        onContextMenu={(event) => interactions.onItemContextMenu(event, item)}
        onAuxClick={(event) => interactions.onItemAuxClick(event, item)}
      >
        {props.checkboxes ? (
          <span
            className={`adp-row-check${selected ? " adp-row-check--on" : ""}`}
            aria-hidden="true"
            onClick={(event) => interactions.onCheckClick(event, item)}
          >
            {selected ? <Check size={12} /> : null}
          </span>
        ) : null}
        <span
          className={`adp-file-tile adp-file-tile--${tile.tone} adp-itemgrid-tile`}
          style={{ width: 16, height: 16 }}
          aria-hidden="true"
        >
          <Icon size={12} aria-hidden="true" />
        </span>
        {renaming ? (
          <RenameInput
            item={item}
            showExtensions={props.showExtensions}
            onCommit={(newName) => props.onRenameCommit(item, newName)}
            onCancel={props.onRenameCancel}
          />
        ) : (
          <span className="adp-file-name adp-itemgrid-name" title={shownName}>
            {shownName}
          </span>
        )}
        <span className="adp-itemgrid-badges">
          {item.online_only ? (
            <span className="adp-file-badge" title={t("explorer.onlineOnly")} aria-label={t("explorer.onlineOnly")}>
              <Cloud size={12} aria-hidden="true" />
            </span>
          ) : null}
          {item.is_link ? (
            <span className="adp-file-badge" title={t("explorer.isLink")} aria-label={t("explorer.isLink")}>
              <Link2 size={11} aria-hidden="true" />
            </span>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div className="adp-filelist adp-flowlist">
      <div
        ref={scrollRef}
        className="adp-filelist-scroll adp-flowlist-scroll"
        role="listbox"
        aria-multiselectable="true"
        aria-label={props.label}
        aria-activedescendant={focusIndex >= 0 ? itemId(focusIndex) : undefined}
        tabIndex={0}
        onKeyDown={interactions.onListKeyDown}
        onClick={interactions.onListClick}
        onContextMenu={interactions.onListContextMenu}
      >
        <div className="adp-flowlist-inner" style={{ width: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualColumn) => (
            <div
              key={virtualColumn.key}
              role="presentation"
              className="adp-flowlist-column"
              style={{ transform: `translateX(${virtualColumn.start}px)`, width: LIST_COLUMN_WIDTH }}
            >
              {Array.from({ length: rowsPerColumn }, (_, row) =>
                renderItem(virtualColumn.index * rowsPerColumn + row),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
