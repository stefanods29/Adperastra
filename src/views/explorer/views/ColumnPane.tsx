import { useVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../../components/Skeleton";
import type { ExplorerItem } from "../../../services/explorer";
import { samePath } from "../../../services/explorer";
import type { GroupBy } from "../../../services/grouping";
import { linearMoveTarget, type FocusMove } from "../../../services/selection";
import RenameInput from "../RenameInput";
import { ColumnRowContent } from "./ColumnRow";
import {
  COLUMN_ROW_HEIGHT,
  COLUMN_SKELETON_ROWS,
  LISTING_TIMEOUT_MS,
  SKELETON_DELAY_MS,
  SLOW_NOTE_DELAY_MS,
  columnItems,
  displayItems,
  isFolderLike,
  type ColumnNote,
} from "./columnTrail";
import { useDelayedFlag, type ColumnListing } from "./useColumnListings";
import { useItemInteractions, type ItemViewProps } from "./useItemInteractions";

export type ColumnRole = "parent" | "active" | "child";

const KEY_MOVES: Record<string, FocusMove> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
  PageDown: "pageDown",
  PageUp: "pageUp",
};

const EMPTY_ITEMS: ExplorerItem[] = [];

export interface ColumnPaneProps {
  role: ColumnRole;
  /** The column's folder (display path). */
  folder: string;
  /** The column's title. */
  name: string;
  width: number;
  /** The cached listing of the column's folder. */
  listing: ColumnListing | null;
  /** The next column's folder (the "on the way" item). */
  pathItem: string | null;
  view: ItemViewProps;
  note: ColumnNote;
  loading: boolean;
  showHidden: boolean;
  groupBy: GroupBy;
  onNavigateKey: (direction: "left" | "right") => void;
  onSelectItem: (item: ExplorerItem, menuPoint: { x: number; y: number } | null) => void;
  onOpenColumn: () => void;
  onDragItem: (event: ReactMouseEvent, item: ExplorerItem) => void;
}

/** One column of Column view (Step 05b D8, D9, D15). Every column is its
 * own virtualized list; only the open folder's column selects. */
export default function ColumnPane(props: ColumnPaneProps) {
  const { t } = useTranslation();
  const { role, folder, name, width, listing, pathItem, view, note, loading, showHidden, groupBy } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const isActive = role === "active";

  const cached = useMemo(
    () => columnItems(listing?.items ?? EMPTY_ITEMS, showHidden, groupBy, view.typeLabel, new Date()),
    [listing?.items, showHidden, groupBy, view.typeLabel],
  );

  const activeItems = useMemo(() => displayItems(view.items, view.groups), [view.items, view.groups]);
  let rows: readonly ExplorerItem[];
  if (isActive) {
    rows = activeItems;
    // While the open folder loads, its column keeps the cached rows (D8).
    if (rows.length === 0 && loading && listing?.status === "ready") rows = cached;
  } else {
    rows = cached;
  }
  const order = useMemo(() => rows.map((item) => item.path), [rows]);

  const status = listing?.status ?? "loading";
  const sideLoading = !isActive && status === "loading";
  const skeleton = useDelayedFlag(sideLoading && cached.length === 0, SKELETON_DELAY_MS);
  const slow = useDelayedFlag(sideLoading, SLOW_NOTE_DELAY_MS);
  const timedOut = useDelayedFlag(sideLoading, LISTING_TIMEOUT_MS);

  const pathIndex = useMemo(() => {
    if (role !== "parent" || pathItem === null) return -1;
    return rows.findIndex((item) => samePath(item.path, pathItem));
  }, [role, pathItem, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => COLUMN_ROW_HEIGHT,
    overscan: 8,
  });

  const paintedRef = useRef(false);
  useEffect(() => {
    paintedRef.current = false;
  }, [view.items]);

  useEffect(() => {
    if (!isActive || paintedRef.current || view.items.length === 0) return;
    paintedRef.current = true;
    const handle = requestAnimationFrame(() => view.onFirstPaint?.());
    return () => cancelAnimationFrame(handle);
  }, [view.items, view, isActive]);

  // Keep the caret's row on screen when it moves.
  const caret = view.selection.focus;
  useEffect(() => {
    if (!isActive || caret === null) return;
    const index = order.indexOf(caret);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caret]);

  // The item that leads to the next column stays in view.
  useEffect(() => {
    if (role !== "parent" || pathIndex < 0) return;
    virtualizer.scrollToIndex(pathIndex, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathIndex, role]);

  const interactions = useItemInteractions(view, {
    order,
    orderItems: rows,
    scrollRef: listRef,
    moveTarget: (key, current) => {
      const move = KEY_MOVES[key];
      if (!move) return null;
      const height = listRef.current?.clientHeight ?? 280;
      const pageSize = Math.max(1, Math.floor(height / COLUMN_ROW_HEIGHT) - 1);
      return linearMoveTarget(move, current, rows.length, pageSize);
    },
    elementForIndex: (index) => listRef.current?.querySelector(`[data-index="${index}"]`) ?? null,
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const sideKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (event.target === listRef.current && sideKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      props.onNavigateKey(event.key === "ArrowLeft" ? "left" : "right");
      return;
    }
    interactions.onListKeyDown(event);
  };

  const focusIndex = view.selection.focus !== null ? order.indexOf(view.selection.focus) : -1;
  const rowId = (index: number) => `${listId}-item-${index}`;

  const openColumn = () => props.onOpenColumn();

  const rowNotes: ReactNode[] = [];
  if (isActive) {
    if (note === "empty") {
      rowNotes.push(
        <p key="note" className="adp-empty-note adp-colview-note">
          {t("explorer.emptyFolder")}
        </p>,
      );
    } else if (note === "noResults") {
      rowNotes.push(
        <p key="note" className="adp-empty-note adp-colview-note">
          {t("explorer.noSearchResults")}
        </p>,
      );
    } else if (note === "loading" && rows.length === 0) {
      rowNotes.push(<Skeleton key="note" variant="rows" count={COLUMN_SKELETON_ROWS} />);
    }
  } else {
    if (listing?.partial) {
      rowNotes.push(
        <p key="partial" className="adp-note adp-colview-note" role="status">
          {t("explorer.someItemsUnreadable")}
        </p>,
      );
    }
    if (status === "error") {
      rowNotes.push(
        <p key="error" className="adp-empty-note adp-colview-note">
          {t("explorer.loadError")}
        </p>,
      );
    } else if (status === "ready" && rows.length === 0) {
      rowNotes.push(
        <p key="empty" className="adp-empty-note adp-colview-note">
          {t("explorer.emptyFolder")}
        </p>,
      );
    }
    if (timedOut) {
      rowNotes.push(
        <p key="timeout" className="adp-empty-note adp-colview-note">
          {t("explorer.notAvailable")}
        </p>,
      );
    }
    if (skeleton && !timedOut) {
      rowNotes.push(<Skeleton key="skeleton" variant="rows" count={COLUMN_SKELETON_ROWS} />);
    }
    if (slow && !timedOut) {
      rowNotes.push(
        <p key="slow" className="adp-note adp-colview-note">
          {t("explorer.stillLoading")}
        </p>,
      );
    }
  }

  return (
    <div className={`adp-colview-column adp-colview-column--${role}`} style={{ width }} data-drop-folder={folder} data-drop-name={name}>
      {rowNotes}
      <div
        ref={listRef}
        role="listbox"
        className={isActive ? "adp-filelist-scroll adp-colview-list" : "adp-colview-list"}
        aria-multiselectable={isActive ? true : undefined}
        aria-label={isActive ? view.label : name}
        aria-activedescendant={isActive && focusIndex >= 0 ? rowId(focusIndex) : undefined}
        tabIndex={isActive ? 0 : -1}
        onKeyDown={isActive ? onKeyDown : undefined}
        onClick={isActive ? interactions.onListClick : openColumn}
        onContextMenu={
          isActive
            ? interactions.onListContextMenu
            : (event) => {
                event.preventDefault();
                event.stopPropagation();
                openColumn();
              }
        }
      >
        <div className="adp-colview-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = rows[virtualRow.index];
            if (!item) return null;
            const selected = isActive && view.selection.selected.has(item.path);
            const focused = isActive && view.selection.focus === item.path;
            const renaming = isActive && view.renamingPath === item.path;
            const atPath = role === "parent" && virtualRow.index === pathIndex;
            const className = [
              "adp-colview-row",
              item.hidden || item.system ? "adp-colview-row--hidden" : "",
              selected ? "adp-colview-row--selected" : "",
              focused ? "adp-colview-row--focused" : "",
              atPath ? "adp-colview-row--path" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const container = isFolderLike(item);
            return (
              <div
                key={item.path}
                id={isActive ? rowId(virtualRow.index) : undefined}
                data-index={virtualRow.index}
                role="option"
                aria-selected={isActive ? selected : role === "parent" ? atPath : false}
                className={className}
                style={{ transform: `translateY(${virtualRow.start}px)`, height: COLUMN_ROW_HEIGHT }}
                data-drop-folder={container ? item.path : undefined}
                data-drop-name={container ? item.name : undefined}
                onMouseDown={
                  isActive ? (event) => view.onItemMouseDown?.(event, item) : (event) => props.onDragItem(event, item)
                }
                onClick={
                  isActive
                    ? (event) => interactions.onItemClick(event, item)
                    : (event) => {
                        event.stopPropagation();
                        props.onSelectItem(item, null);
                      }
                }
                onDoubleClick={
                  isActive
                    ? (event) => interactions.onItemDoubleClick(event, item)
                    : (event) => {
                        event.stopPropagation();
                        view.onOpen(item);
                      }
                }
                onContextMenu={
                  isActive
                    ? (event) => interactions.onItemContextMenu(event, item)
                    : (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onSelectItem(item, { x: event.clientX, y: event.clientY });
                      }
                }
                onAuxClick={isActive ? (event) => interactions.onItemAuxClick(event, item) : undefined}
              >
                <ColumnRowContent
                  item={item}
                  showExtensions={view.showExtensions}
                  check={
                    isActive && view.checkboxes ? (
                      <span
                        className={`adp-row-check${selected ? " adp-row-check--on" : ""}`}
                        aria-hidden="true"
                        onClick={(event) => interactions.onCheckClick(event, item)}
                      >
                        {selected ? <Check size={12} /> : null}
                      </span>
                    ) : undefined
                  }
                  renaming={
                    renaming ? (
                      <RenameInput
                        item={item}
                        showExtensions={view.showExtensions}
                        onCommit={(newName) => view.onRenameCommit(item, newName)}
                        onCancel={view.onRenameCancel}
                      />
                    ) : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
