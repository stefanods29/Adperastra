import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { ExplorerItem, SortDirection, SortKey } from "../../../services/explorer";
import type { ItemGroup } from "../../../services/grouping";
import { displayName } from "../../../services/names";
import {
  moveFocusTo,
  selectAll,
  selectOnly,
  selectRange,
  toggleFocused,
  toggleItem,
  typeAheadIndex,
  type SelectionState,
} from "../../../services/selection";

export const TYPE_AHEAD_RESET_MS = 1000;
export const RENAME_CLICK_DELAY_MS = 500;

/** What every item view draws and reports (Step 05a D13). */
export interface ItemViewProps {
  /** Hidden tabs release background previews; omitted by standalone views. */
  active?: boolean;
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
  /** Middle-click on a file: open it in a background tab (Step 04a). */
  onOpenInBackground?: (item: ExplorerItem) => void;
  /** Right-click or the Menu key; `item` is null for empty space. */
  onContextMenu: (point: { x: number; y: number }, item: ExplorerItem | null) => void;
  /** Keys that run registry commands (Enter, F2, Alt+Enter, ...); the
   * point says where a keyboard-opened menu should appear. */
  onCommandKey: (commandId: string, point?: { x: number; y: number }) => void;
  /** Space on a focused file: open the read-only quick preview (Step 07b).
   * The view never calls Rust itself and never changes selection here. */
  onPreview?: (item: ExplorerItem) => void;
  /** Mouse-down on a row, for starting a drag (Step 03b). */
  onItemMouseDown?: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onFirstPaint?: () => void;
  /** Short Home lists render every row; folders virtualize. */
  virtual?: boolean;
  label: string;
}

/** What a view must tell the hook about its own layout. */
export interface InteractionOptions {
  /** The items' paths in display order. */
  order: readonly string[];
  /** The same items, same order. */
  orderItems: readonly ExplorerItem[];
  /** The element with `role="listbox"`. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The index a navigation key moves to, or null when it is not one. */
  moveTarget: (key: string, current: number) => number | null;
  /** The element that shows that item, or null when it is not drawn. */
  elementForIndex: (index: number) => Element | null;
}

export interface ItemInteractions {
  cancelRenameTimer: () => void;
  onItemClick: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onItemDoubleClick: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onItemContextMenu: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onItemAuxClick: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onCheckClick: (event: ReactMouseEvent, item: ExplorerItem) => void;
  onListKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onListClick: () => void;
  onListContextMenu: (event: ReactMouseEvent) => void;
}

/** Click, right-click, keyboard and type-ahead behavior shared by every
 * item view (Step 05a D13): Details, the icon grids and List. */
export function useItemInteractions(props: ItemViewProps, options: InteractionOptions): ItemInteractions {
  const typeAhead = useRef({ buffer: "", at: 0 });
  const renameTimer = useRef<number | null>(null);

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

  const onItemClick = (event: ReactMouseEvent, item: ExplorerItem) => {
    event.stopPropagation();
    const selection = props.selection;
    const wasOnlySelection = selection.selected.size === 1 && selection.selected.has(item.path);
    cancelRenameTimer();
    if (event.shiftKey) {
      props.onSelectionChange(selectRange(selection, options.order, item.path, event.ctrlKey || event.metaKey));
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

  const onItemDoubleClick = (event: ReactMouseEvent, item: ExplorerItem) => {
    event.stopPropagation();
    cancelRenameTimer();
    if (props.renamingPath !== item.path) props.onOpen(item);
  };

  const onItemContextMenu = (event: ReactMouseEvent, item: ExplorerItem) => {
    event.preventDefault();
    event.stopPropagation();
    cancelRenameTimer();
    if (!props.selection.selected.has(item.path)) props.onSelectionChange(selectOnly(item.path));
    props.onContextMenu({ x: event.clientX, y: event.clientY }, item);
  };

  const onItemAuxClick = (event: ReactMouseEvent, item: ExplorerItem) => {
    if (event.button === 1 && item.kind === "file") props.onOpenInBackground?.(item);
  };

  const onCheckClick = (event: ReactMouseEvent, item: ExplorerItem) => {
    event.stopPropagation();
    cancelRenameTimer();
    props.onSelectionChange(toggleItem(props.selection, item.path));
  };

  const menuPointForFocus = (): { point: { x: number; y: number }; item: ExplorerItem | null } => {
    const focusPath = props.selection.focus;
    const index = focusPath !== null ? options.order.indexOf(focusPath) : -1;
    const element = index >= 0 ? options.elementForIndex(index) : null;
    const box = (element ?? options.scrollRef.current)?.getBoundingClientRect();
    const point = box ? { x: box.left + 24, y: box.top + (element ? box.height : 8) } : { x: 0, y: 0 };
    const keyed = index >= 0 ? options.orderItems[index] : undefined;
    const item = keyed && props.selection.selected.has(keyed.path) ? keyed : null;
    return { point, item };
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== options.scrollRef.current) return;
    const selection = props.selection;
    const ctrl = event.ctrlKey || event.metaKey;
    const current = selection.focus !== null ? options.order.indexOf(selection.focus) : -1;
    if (!event.altKey) {
      const target = options.moveTarget(event.key, current);
      if (target !== null) {
        event.preventDefault();
        props.onSelectionChange(moveFocusTo(selection, options.order, target, { shift: event.shiftKey, ctrl }));
        return;
      }
    }
    if (ctrl && !event.shiftKey && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      props.onSelectionChange(selectAll(selection, options.order));
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
        const focusedIndex =
          selection.focus !== null ? options.order.indexOf(selection.focus) : -1;
        const focusedItem =
          focusedIndex >= 0 ? options.orderItems[focusedIndex] : undefined;
        if (props.onPreview && focusedItem && focusedItem.kind === "file") {
          // Space opens the preview; the row stays selected and focused.
          props.onPreview(focusedItem);
          return;
        }
        if (selection.focus !== null && !selection.selected.has(selection.focus)) {
          props.onSelectionChange(toggleFocused(selection));
        }
        return;
      }
      state.buffer = now - state.at > TYPE_AHEAD_RESET_MS ? event.key : state.buffer + event.key;
      state.at = now;
      const names = options.orderItems.map((item) => displayName(item.name, item.kind, props.showExtensions));
      const index = typeAheadIndex(names, current, state.buffer);
      if (index >= 0) {
        event.preventDefault();
        props.onSelectionChange(selectOnly(options.order[index]));
      }
    }
  };

  const onListClick = () => {
    cancelRenameTimer();
    if (props.selection.selected.size > 0) props.onSelectionChange({ ...props.selection, selected: new Set() });
  };

  const onListContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    cancelRenameTimer();
    if (props.selection.selected.size > 0) props.onSelectionChange({ ...props.selection, selected: new Set() });
    props.onContextMenu({ x: event.clientX, y: event.clientY }, null);
  };

  return {
    cancelRenameTimer,
    onItemClick,
    onItemDoubleClick,
    onItemContextMenu,
    onItemAuxClick,
    onCheckClick,
    onListKeyDown,
    onListClick,
    onListContextMenu,
  };
}
