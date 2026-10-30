import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Cloud, Link2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ExplorerItem } from "../../../services/explorer";
import { formatDate, formatSize } from "../../../services/format";
import { displayName } from "../../../services/names";
import { fileTile } from "../fileTile";
import RenameInput from "../RenameInput";
import { buildGridLayout, columnsFor, gridMove, lineOfIndex, type GridMove } from "./gridLayout";
import { useItemInteractions, type ItemViewProps } from "./useItemInteractions";
import {
  FALLBACK_WIDTH,
  GRID_PADDING,
  GRID_SPECS,
  GROUP_HEADER_HEIGHT,
  type GridModeId,
} from "./viewModes";

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

interface FileGridProps extends ItemViewProps {
  mode: GridModeId;
}

/** Icon grids, Tiles and Content (Step 05a D2, D3): items flow left to
 * right, then on to the next row; groups get their own header rows. */
export default function FileGrid({ mode, ...props }: FileGridProps) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const paintedRef = useRef(false);
  const [width, setWidth] = useState(0);
  const spec = GRID_SPECS[mode];

  const orderItems = useMemo<ExplorerItem[]>(() => {
    if (!props.groups) return props.items;
    const out: ExplorerItem[] = [];
    for (const group of props.groups) out.push(...group.items);
    return out;
  }, [props.groups, props.items]);
  const order = useMemo(() => orderItems.map((item) => item.path), [orderItems]);
  const groupSizes = useMemo(
    () => (props.groups ? props.groups.map((group) => group.items.length) : [orderItems.length]),
    [props.groups, orderItems],
  );

  // The width of the scroll area drives how many cells fit in a row.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const usableWidth = (width || FALLBACK_WIDTH) - GRID_PADDING * 2;
  const columns = spec.cellWidth === 0 ? 1 : columnsFor(usableWidth, spec.cellWidth, spec.gap);
  const layout = useMemo(
    () => buildGridLayout(groupSizes, columns, props.groups !== null),
    [groupSizes, columns, props.groups],
  );

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = layout.rows[index];
      return row?.type === "header" ? GROUP_HEADER_HEIGHT : spec.cellHeight + spec.gap;
    },
    getItemKey: (index) => layout.rows[index]?.key ?? index,
    overscan: 4,
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

  // Keep the caret's row on screen when it moves (keyboard, type-ahead,
  // "Show in folder").
  const focus = props.selection.focus;
  useEffect(() => {
    if (focus === null) return;
    const index = order.indexOf(focus);
    if (index < 0) return;
    const line = lineOfIndex(layout, index);
    if (line < 0) return;
    virtualizer.scrollToIndex(layout.lines[line], { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const interactions = useItemInteractions(props, {
    order,
    orderItems,
    scrollRef,
    moveTarget: (key, current) => {
      const move = GRID_KEYS[key];
      if (!move) return null;
      const height = scrollRef.current?.clientHeight ?? 0;
      const pageLines = Math.max(1, Math.floor(height / (spec.cellHeight + spec.gap)) - 1);
      return gridMove(layout, current, move, pageLines);
    },
    elementForIndex: (index) => scrollRef.current?.querySelector(`[data-index="${index}"]`) ?? null,
  });

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
      `adp-itemgrid-cell--${spec.layout}`,
      selected ? "adp-itemgrid-cell--selected" : "",
      focused ? "adp-itemgrid-cell--focused" : "",
      item.hidden || item.system ? "adp-itemgrid-cell--hidden" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const name = renaming ? (
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
    );
    const badges = (
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
    );
    let content: ReactNode;
    if (spec.layout === "stacked" || spec.layout === "inline") {
      content = (
        <>
          {name}
          {badges}
        </>
      );
    } else if (spec.layout === "tile") {
      content = (
        <>
          <span className="adp-itemgrid-text">
            {name}
            <span className="adp-itemgrid-detail">{props.typeLabel(item)}</span>
            <span className="adp-itemgrid-detail">{isContainer ? "" : formatSize(item.size, i18n.language)}</span>
          </span>
          {badges}
        </>
      );
    } else {
      content = (
        <>
          <span className="adp-itemgrid-text">
            {name}
            <span className="adp-itemgrid-detail">{props.typeLabel(item)}</span>
          </span>
          <span className="adp-itemgrid-meta">
            <span className="adp-itemgrid-detail">
              {item.modified_unix > 0
                ? t("explorer.contentModified", { date: formatDate(item.modified_unix, i18n.language) })
                : ""}
            </span>
            <span className="adp-itemgrid-detail">
              {isContainer ? "" : t("explorer.contentSize", { size: formatSize(item.size, i18n.language) })}
            </span>
          </span>
          {badges}
        </>
      );
    }
    return (
      <div
        key={item.path}
        id={itemId(index)}
        data-index={index}
        role="option"
        aria-selected={selected}
        className={className}
        style={spec.cellWidth > 0 ? { width: spec.cellWidth } : undefined}
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
          style={{ width: spec.tile, height: spec.tile }}
          aria-hidden="true"
        >
          <Icon size={spec.icon} aria-hidden="true" />
        </span>
        {content}
      </div>
    );
  };

  return (
    <div className={`adp-filelist adp-itemgrid adp-itemgrid--${mode}`}>
      <div
        ref={scrollRef}
        className="adp-filelist-scroll adp-itemgrid-scroll"
        role="listbox"
        aria-multiselectable="true"
        aria-label={props.label}
        aria-activedescendant={focusIndex >= 0 ? itemId(focusIndex) : undefined}
        tabIndex={0}
        onKeyDown={interactions.onListKeyDown}
        onClick={interactions.onListClick}
        onContextMenu={interactions.onListContextMenu}
      >
        <div className="adp-itemgrid-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = layout.rows[virtualRow.index];
            if (!row) return null;
            const style = {
              transform: `translateY(${virtualRow.start}px)`,
              height: row.type === "header" ? GROUP_HEADER_HEIGHT : spec.cellHeight,
            };
            if (row.type === "header") {
              const group = props.groups?.[row.group];
              return (
                <div
                  key={row.key}
                  role="presentation"
                  className="adp-group-header adp-itemgrid-header"
                  style={style}
                >
                  <span>{group?.label ?? t(`explorer.group.${group?.id}`)}</span>
                  <span className="adp-group-count">{group?.items.length ?? 0}</span>
                  <span className="adp-group-rule" aria-hidden="true" />
                </div>
              );
            }
            return (
              <div key={row.key} role="presentation" className="adp-itemgrid-row" style={{ ...style, gap: spec.gap }}>
                {Array.from({ length: row.count }, (_, offset) => renderItem(row.first + offset))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
