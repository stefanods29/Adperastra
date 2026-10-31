import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Cloud, Link2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRowSizes } from "../../appearance/density";
import type { ExplorerItem, SortKey } from "../../services/explorer";
import { formatDate, formatSize } from "../../services/format";
import { displayName } from "../../services/names";
import { linearMoveTarget, selectAll, type FocusMove } from "../../services/selection";
import { fileTile } from "./fileTile";
import RenameInput from "./RenameInput";
import {
  useItemInteractions,
  type ItemViewProps,
} from "./views/useItemInteractions";

/** Details view: the rows with columns. Props live in `ItemViewProps`
 * (Step 05a moved them to the shared interactions hook). */
export type FileListProps = ItemViewProps;

type Row =
  | { type: "header"; key: string; label: string; count: number }
  | { type: "item"; key: string; item: ExplorerItem; order: number };

const HEADER_HEIGHT = 32;

const KEY_MOVES: Record<string, FocusMove> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
  PageDown: "pageDown",
  PageUp: "pageUp",
};

export default function FileList(props: FileListProps) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const paintedRef = useRef(false);
  const virtual = props.virtual !== false;
  const { row: rowHeight } = useRowSizes();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let order = 0;
    const push = (item: ExplorerItem) => {
      out.push({ type: "item", key: item.path, item, order });
      order += 1;
    };
    if (props.groups) {
      for (const group of props.groups) {
        out.push({ type: "header", key: `group-${group.id}`, label: group.label ?? t(`explorer.group.${group.id}`), count: group.items.length });
        group.items.forEach(push);
      }
    } else {
      props.items.forEach(push);
    }
    return out;
  }, [props.groups, props.items, t]);

  const itemRows = useMemo(() => rows.filter((row): row is Extract<Row, { type: "item" }> => row.type === "item"), [rows]);
  const orderItems = useMemo(() => itemRows.map((row) => row.item), [itemRows]);
  const order = useMemo(() => itemRows.map((row) => row.item.path), [itemRows]);
  const rowIndexOfPath = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.type === "item") map.set(row.item.path, index);
    });
    return map;
  }, [rows]);

  const interactions = useItemInteractions(props, {
    order,
    orderItems,
    scrollRef,
    moveTarget: (key, current) => {
      const move = KEY_MOVES[key];
      if (!move) return null;
      const height = scrollRef.current?.clientHeight ?? 280;
      const pageSize = Math.max(1, Math.floor(height / rowHeight) - 1);
      return linearMoveTarget(move, current, order.length, pageSize);
    },
    elementForIndex: (index) => {
      const rowIndex = rowIndexOfPath.get(order[index]);
      if (rowIndex === undefined) return null;
      return scrollRef.current?.querySelector(`[data-row="${rowIndex}"]`) ?? null;
    },
  });

  // A new function each time the density changes makes the virtualizer
  // measure its rows again.
  const getItemKey = useCallback((index: number) => index, [rowHeight]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === "header" ? HEADER_HEIGHT : rowHeight),
    getItemKey,
    overscan: 12,
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
    const index = rowIndexOfPath.get(focus);
    if (index === undefined) return;
    if (virtual) virtualizer.scrollToIndex(index, { align: "auto" });
    else scrollRef.current?.querySelector(`[data-row="${index}"]`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const rowId = (index: number) => `${listId}-row-${index}`;

  const typeLabelFor = props.typeLabel;
  const renderRow = (row: Row, index: number, style: React.CSSProperties | undefined) => {
    if (row.type === "header") {
      return (
        <div key={row.key} data-row={index} role="presentation" className="adp-group-header" style={style}>
          <span>{row.label}</span>
          <span className="adp-group-count">{row.count}</span>
          <span className="adp-group-rule" aria-hidden="true" />
        </div>
      );
    }
    const item = row.item;
    const selected = props.selection.selected.has(item.path);
    const focused = props.selection.focus === item.path;
    const renaming = props.renamingPath === item.path;
    const tile = fileTile(item.name, item.kind);
    const Icon = tile.icon;
    const shownName = displayName(item.name, item.kind, props.showExtensions);
    const className = [
      "adp-file-row",
      virtual ? "" : "adp-file-row--static",
      selected ? "adp-file-row--selected" : "",
      focused ? "adp-file-row--focused" : "",
      item.hidden || item.system ? "adp-file-row--hidden" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={row.key}
        id={rowId(index)}
        data-row={index}
        role="option"
        aria-selected={selected}
        className={className}
        style={style}
        data-drop-folder={item.kind === "folder" || item.kind === "drive" ? item.path : undefined}
        data-drop-name={item.kind === "folder" || item.kind === "drive" ? item.name : undefined}
        onMouseDown={(event) => props.onItemMouseDown?.(event, item)}
        onClick={(event) => interactions.onItemClick(event, item)}
        onDoubleClick={(event) => interactions.onItemDoubleClick(event, item)}
        onContextMenu={(event) => interactions.onItemContextMenu(event, item)}
        onAuxClick={(event) => interactions.onItemAuxClick(event, item)}
      >
        <span className="adp-col-name adp-file-name-cell">
          {props.checkboxes ? (
            <span
              className={`adp-row-check${selected ? " adp-row-check--on" : ""}`}
              aria-hidden="true"
              onClick={(event) => interactions.onCheckClick(event, item)}
            >
              {selected ? <Check size={12} /> : null}
            </span>
          ) : null}
          <span className={`adp-file-tile adp-file-tile--${tile.tone}`}>
            <Icon size={13} aria-hidden="true" />
          </span>
          {renaming ? (
            <RenameInput
              item={item}
              showExtensions={props.showExtensions}
              onCommit={(newName) => props.onRenameCommit(item, newName)}
              onCancel={props.onRenameCancel}
            />
          ) : (
            <span className="adp-file-name">{shownName}</span>
          )}
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
        <span className="adp-col-date">{item.modified_unix > 0 ? formatDate(item.modified_unix, i18n.language) : ""}</span>
        <span className="adp-col-type">{typeLabelFor(item)}</span>
        <span className="adp-col-size">{item.kind === "folder" || item.kind === "drive" ? "" : formatSize(item.size, i18n.language)}</span>
      </div>
    );
  };

  const header = (key: SortKey, labelKey: string, className: string) => {
    if (!props.onSort) {
      return (
        <span className={`adp-filelist-header-cell adp-filelist-header-cell--static ${className}`}>
          {t(labelKey)}
        </span>
      );
    }
    return (
      <button
        type="button"
        className={`adp-filelist-header-cell ${className}`}
        aria-label={
          props.sortKey === key
            ? t(props.sortDirection === "ascending" ? "explorer.sortedAscending" : "explorer.sortedDescending", { name: t(labelKey) })
            : t("explorer.sortBy", { name: t(labelKey) })
        }
        onClick={() => props.onSort?.(key)}
      >
        <span>{t(labelKey)}</span>
        {props.sortKey === key ? <span aria-hidden="true">{props.sortDirection === "ascending" ? "↑" : "↓"}</span> : null}
      </button>
    );
  };

  const focusIndex = props.selection.focus !== null ? rowIndexOfPath.get(props.selection.focus) : undefined;
  const allSelected = order.length > 0 && props.selection.selected.size === order.length;

  return (
    <div className={virtual ? "adp-filelist" : "adp-filelist adp-filelist--static"}>
      <div className="adp-filelist-header" role="group" aria-label={t("explorer.columnsLabel")}>
        {props.checkboxes ? (
          <span
            className={`adp-row-check adp-row-check--header${allSelected ? " adp-row-check--on" : ""}`}
            role="checkbox"
            aria-checked={allSelected}
            aria-label={t("commands.selectAll")}
            tabIndex={-1}
            onClick={() => {
              props.onSelectionChange(allSelected ? { ...props.selection, selected: new Set() } : selectAll(props.selection, order));
            }}
          >
            {allSelected ? <Check size={12} aria-hidden="true" /> : null}
          </span>
        ) : null}
        {header("name", "explorer.columnName", "adp-col-name")}
        {header("modified", "explorer.columnModified", "adp-col-date")}
        {header("kind", "explorer.columnType", "adp-col-type")}
        {header("size", "explorer.columnSize", "adp-col-size")}
      </div>
      <div
        ref={scrollRef}
        className="adp-filelist-scroll"
        role="listbox"
        aria-multiselectable="true"
        aria-label={props.label}
        aria-activedescendant={focusIndex !== undefined ? rowId(focusIndex) : undefined}
        tabIndex={0}
        onKeyDown={interactions.onListKeyDown}
        onClick={interactions.onListClick}
        onContextMenu={interactions.onListContextMenu}
      >
        {virtual ? (
          <div className="adp-filelist-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return renderRow(row, virtualRow.index, {
                transform: `translateY(${virtualRow.start}px)`,
                height: row.type === "header" ? HEADER_HEIGHT : rowHeight,
              });
            })}
          </div>
        ) : (
          rows.map((row, index) => renderRow(row, index, undefined))
        )}
      </div>
    </div>
  );
}
