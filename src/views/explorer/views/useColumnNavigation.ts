/** Opening a folder from Column view (Step 05b): select an item in it,
 * then open its menu once it is selected. */

import { useCallback, useEffect, useRef } from "react";
import type { ExplorerItem } from "../../../services/explorer";
import { samePath } from "../../../services/explorer";
import { folderViewKey } from "../../../services/folderViews";
import type { ExplorerLocation } from "../../../services/navigation";
import { selectOnly, type SelectionState } from "../../../services/selection";
import { PENDING_MENU_MS } from "./columnTrail";

export interface ColumnNavigationInput {
  location: ExplorerLocation;
  orderPaths: readonly string[];
  selection: SelectionState;
  itemByPath: ReadonlyMap<string, ExplorerItem>;
  goToFolder: (path: string) => void;
  setSelection: (next: SelectionState) => void;
  pendingSelectRef: { current: string | null };
  openContextMenu: (point: { x: number; y: number }, item: ExplorerItem | null) => void;
}

interface PendingMenu {
  path: string;
  point: { x: number; y: number };
  at: number;
}

export type ColumnNavigate = (
  folder: string,
  select: string | null,
  menuPoint: { x: number; y: number } | null,
) => void;

/** Open a folder from any column, select the item or file asked for, and
 * open that item's menu when the user right-clicked it (Step 05b D3, D11). */
export function useColumnNavigation(input: ColumnNavigationInput): ColumnNavigate {
  const inputRef = useRef(input);
  inputRef.current = input;
  const pendingMenu = useRef<PendingMenu | null>(null);

  const navigate = useCallback<ColumnNavigate>((folder, select, menuPoint) => {
    const current = inputRef.current;
    const now = performance.now();
    const isOpenFolder =
      current.location.type === "folder" && folderViewKey(current.location.path) === folderViewKey(folder);
    if (isOpenFolder) {
      if (select !== null) {
        const match = current.orderPaths.find((path) => samePath(path, select));
        if (match) {
          current.setSelection(selectOnly(match));
          pendingMenu.current = menuPoint !== null ? { path: match, point: menuPoint, at: now } : null;
        }
      }
      return;
    }
    current.goToFolder(folder);
    current.pendingSelectRef.current = select;
    pendingMenu.current = select !== null && menuPoint !== null ? { path: select, point: menuPoint, at: now } : null;
  }, []);

  useEffect(() => {
    const pending = pendingMenu.current;
    if (!pending) return;
    if (performance.now() - pending.at > PENDING_MENU_MS) {
      pendingMenu.current = null;
      return;
    }
    if (input.selection.selected.size !== 1) return;
    const [path] = input.selection.selected;
    if (!samePath(path, pending.path)) return;
    const item = input.itemByPath.get(path);
    if (!item) return;
    pendingMenu.current = null;
    input.openContextMenu(pending.point, item);
  }, [input.selection, input.itemByPath, input.openContextMenu]);

  return navigate;
}
