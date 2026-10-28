import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Cloud, Link2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ExplorerItem, SortDirection, SortKey } from "../../services/explorer";
import { formatDate, formatSize } from "../../services/format";
import type { ItemGroup } from "../../services/grouping";
import { displayName } from "../../services/names";
import {
  moveFocus,
  selectAll,
  selectOnly,
  selectRange,
  toggleFocused,
  toggleItem,
  typeAheadIndex,
  type FocusMove,
  type SelectionState,
} from "../../services/selection";
import { fileTile } from "./fileTile";
import RenameInput from "./RenameInput";

export interface FileListProps {
  items: ExplorerItem[];
  /** Grouped view; `null` shows the items as one list. */
  groups: ItemGroup<ExplorerItem>[] | null;
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  /** Column headers sort when set (folders); Home lists keep their order. */
  onSort?: (key: SortKey) => void;
  showExtensions: boolean;
  checkboxes: boolean;
  typeLabel: (item: ExplorerItem) => string;
  renamingPath: string | null;
  onStartRename: (item: ExplorerItem) => void;
  /** Resolves to a translated error message, or null when renamed. */
  onRenameCommit: (item: ExplorerItem, newName: string) => Promise<string | null>;
  onRenameCancel: () => void;
  onOpen: (item: ExplorerItem) => void;
  /** Right-click or the Menu key; `item` is null for empty space. */
  onContextMenu: (point: { x: number; y: number }, item: ExplorerItem | null) => void;
  /** Keys that run registry commands (Enter, F2, Alt+Enter, ...); the
   * point says where a keyboard-opened menu should appear. */
  onCommandKey: (commandId: string, point?: { x: number; y: number }) => void;
  /** Mouse-down on a row, for starting a drag (Step 03b). */
  onItemMouseDown?: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onFirstPaint?: () => void;
  /** Short Home lists render every row; folders virtualize. */
  virtual?: boolean;
  label: string;
}

type Row =
  | { type: "header"; key: string; label: string; count: number }
  | { type: "item"; key: string; item: ExplorerItem; order: number };

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
const TYPE_AHEAD_RESET_MS = 1000;
const RENAME_CLICK_DELAY_MS = 500;

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
  const typeAhead = useRef({ buffer: "", at: 0 });
  const renameTimer = useRef<number | null>(null);
  const virtual = props.virtual !== false;

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
  const order = useMemo(() => itemRows.map((row) => row.item.path), [itemRows]);
  const rowIndexOfPath = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.type === "item") map.set(row.item.path, index);
    });
    return map;
  }, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
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

  useEffect(
    () => () => {
      if (renameTimer.current !== null) window.clearTimeout(renameTimer.current);
    },
    [],
  );

  const cancelRenameTimer = () => {
    if (renameTimer.current !== null) window.clearTimeout(renameTimer.current);
    renameTimer.current = null;
  };

  const rowId = (index: number) => `${listId}-row-${index}`;

  const onRowClick = (event: ReactMouseEvent, item: ExplorerItem) => {
    event.stopPropagation();
    const selection = props.selection;
    const wasOnlySelection = selection.selected.size === 1 && selection.selected.has(item.path);
    cancelRenameTimer();
    if (event.shiftKey) {
      props.onSelectionChange(selectRange(selection, order, item.path, event.ctrlKey || event.metaKey));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      props.onSelectionChange(toggleItem(selection, item.path));
      return;
    }
    if (!wasOnlySelection) {
      props.onSelectionChange(selectOnly(item.path));
      return;
    }
    // One-step rename: a second, slow click on the name of the only
    // selected item starts renaming (a double-click opens instead).
    const onName = (event.target as Element).closest(".adp-file-name");
    if (onName && event.detail === 1) {
      renameTimer.current = window.setTimeout(() => {
        renameTimer.current = null;
        props.onStartRename(item);
      }, RENAME_CLICK_DELAY_MS);
    }
  };

  const onRowContextMenu = (event: ReactMouseEvent, item: ExplorerItem) => {
    event.preventDefault();
    event.stopPropagation();
    cancelRenameTimer();
    if (!props.selection.selected.has(item.path)) props.onSelectionChange(selectOnly(item.path));
    props.onContextMenu({ x: event.clientX, y: event.clientY }, item);
  };

  const menuPointForFocus = (): { point: { x: number; y: number }; item: ExplorerItem | null } => {
    const focusPath = props.selection.focus;
    const index = focusPath !== null ? rowIndexOfPath.get(focusPath) : undefined;
    const element = index !== undefined ? scrollRef.current?.querySelector(`[data-row="${index}"]`) : null;
    const box = (element ?? scrollRef.current)?.getBoundingClientRect();
    const point = box ? { x: box.left + 24, y: box.top + (element ? box.height : 8) } : { x: 0, y: 0 };
    const row = index !== undefined ? rows[index] : undefined;
    const item = row && row.type === "item" && props.selection.selected.has(row.item.path) ? row.item : null;
    return { point, item };
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== scrollRef.current) return;
    const selection = props.selection;
    const ctrl = event.ctrlKey || event.metaKey;
    const move = KEY_MOVES[event.key];
    if (move && !event.altKey) {
      event.preventDefault();
      const pageSize = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 280) / ROW_HEIGHT) - 1);
      props.onSelectionChange(moveFocus(selection, order, move, { shift: event.shiftKey, ctrl, pageSize }));
      return;
    }
    if (ctrl && !event.shiftKey && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      props.onSelectionChange(selectAll(selection, order));
      return;
    }
    if (ctrl && event.key === " ") {
      event.preventDefault();
      props.onSelectionChange(toggleFocused(selection));
      return;
    }
    if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      props.onCommandKey("explorer.properties");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      props.onCommandKey("explorer.open");
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      props.onCommandKey("explorer.rename");
      return;
    }
    if (ctrl && event.shiftKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      props.onCommandKey("explorer.copyPath");
      return;
    }
    if (event.key === "F10" && event.shiftKey) {
      event.preventDefault();
      props.onCommandKey("explorer.showMoreOptions", menuPointForFocus().point);
      return;
    }
    if (event.key === "ContextMenu") {
      event.preventDefault();
      const { point, item } = menuPointForFocus();
      props.onContextMenu(point, item);
      return;
    }
    if (event.key.length === 1 && !ctrl && !event.altKey) {
      const now = Date.now();
      const state = typeAhead.current;
      if (event.key === " " && (state.buffer === "" || now - state.at > TYPE_AHEAD_RESET_MS)) {
        event.preventDefault();
        if (selection.focus !== null && !selection.selected.has(selection.focus)) {
          props.onSelectionChange(toggleFocused(selection));
        }
        return;
      }
      state.buffer = now - state.at > TYPE_AHEAD_RESET_MS ? event.key : state.buffer + event.key;
      state.at = now;
      const names = itemRows.map((row) => displayName(row.item.name, row.item.kind, props.showExtensions));
      const current = selection.focus !== null ? order.indexOf(selection.focus) : -1;
      const index = typeAheadIndex(names, current, state.buffer);
      if (index >= 0) {
        event.preventDefault();
        props.onSelectionChange(selectOnly(order[index]));
      }
    }
  };

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
        onClick={(event) => onRowClick(event, item)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          cancelRenameTimer();
          if (!renaming) props.onOpen(item);
        }}
        onContextMenu={(event) => onRowContextMenu(event, item)}
      >
        <span className="adp-col-name adp-file-name-cell">
          {props.checkboxes ? (
            <span
              className={`adp-row-check${selected ? " adp-row-check--on" : ""}`}
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation();
                cancelRenameTimer();
                props.onSelectionChange(toggleItem(props.selection, item.path));
              }}
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
        <span role="columnheader" className={`adp-filelist-header-cell adp-filelist-header-cell--static ${className}`}>
          {t(labelKey)}
        </span>
      );
    }
    return (
      <button
        type="button"
        role="columnheader"
        className={`adp-filelist-header-cell ${className}`}
        aria-label={t("explorer.sortBy", { name: t(labelKey) })}
        aria-sort={props.sortKey === key ? (props.sortDirection === "ascending" ? "ascending" : "descending") : undefined}
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
      <div className="adp-filelist-header" role="row">
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
        onKeyDown={onKeyDown}
        onClick={() => {
          cancelRenameTimer();
          if (props.selection.selected.size > 0) props.onSelectionChange({ ...props.selection, selected: new Set() });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          cancelRenameTimer();
          if (props.selection.selected.size > 0) props.onSelectionChange({ ...props.selection, selected: new Set() });
          props.onContextMenu({ x: event.clientX, y: event.clientY }, null);
        }}
      >
        {virtual ? (
          <div className="adp-filelist-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return renderRow(row, virtualRow.index, {
                transform: `translateY(${virtualRow.start}px)`,
                height: row.type === "header" ? HEADER_HEIGHT : ROW_HEIGHT,
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
