import { ArrowDownWideNarrow, Group, List, Plus, type LucideIcon } from "lucide-react";
import { isCommandVisible, type Command, type CommandContext } from "./registry";

/** Menus from commands (contract 9): every menu and bar is data drawn by
 * one renderer, so the menu editor (Step 10b) can change them later
 * without a format change. */

export type MenuEntry =
  | { type: "command"; id: string }
  | { type: "separator" }
  | { type: "submenu"; id: string; labelKey: string; icon?: LucideIcon; entries: MenuEntry[] }
  | { type: "iconRow"; ids: string[] };

const cmd = (id: string): MenuEntry => ({ type: "command", id });
const separator: MenuEntry = { type: "separator" };

export const NEW_MENU: MenuEntry[] = [cmd("explorer.newFolder"), cmd("explorer.newTextFile")];

export const GROUP_MENU: MenuEntry[] = [
  cmd("explorer.groupByNone"),
  cmd("explorer.groupByName"),
  cmd("explorer.groupByModified"),
  cmd("explorer.groupByType"),
  cmd("explorer.groupBySize"),
];

export const SORT_MENU: MenuEntry[] = [
  cmd("explorer.sortByName"),
  cmd("explorer.sortByModified"),
  cmd("explorer.sortByType"),
  cmd("explorer.sortBySize"),
  separator,
  cmd("explorer.sortAscending"),
  cmd("explorer.sortDescending"),
  separator,
  { type: "submenu", id: "groupBy", labelKey: "commands.groupBy", icon: Group, entries: GROUP_MENU },
];

export const VIEW_MENU: MenuEntry[] = [
  cmd("explorer.viewDetails"),
  cmd("explorer.viewList"),
  cmd("explorer.viewSmallIcons"),
  cmd("explorer.viewMediumIcons"),
  cmd("explorer.viewLargeIcons"),
  separator,
  cmd("explorer.toggleDetailsPane"),
  cmd("explorer.toggleHiddenItems"),
  cmd("explorer.toggleExtensions"),
  cmd("explorer.toggleCheckboxes"),
];

export const OVERFLOW_MENU: MenuEntry[] = [
  cmd("explorer.undo"),
  cmd("explorer.redo"),
  separator,
  cmd("explorer.selectAll"),
  cmd("explorer.selectNone"),
  cmd("explorer.invertSelection"),
  separator,
  cmd("explorer.togglePin"),
  cmd("explorer.copyPath"),
  cmd("explorer.openInTerminal"),
  cmd("explorer.properties"),
  separator,
  cmd("explorer.recentActions"),
];

/** Right-click on one or more items. */
export const ITEM_MENU: MenuEntry[] = [
  { type: "iconRow", ids: ["explorer.cut", "explorer.copy", "explorer.rename", "explorer.share", "explorer.delete"] },
  separator,
  cmd("explorer.open"),
  cmd("explorer.openWith"),
  cmd("explorer.toggleFavorite"),
  cmd("explorer.showInFolder"),
  cmd("explorer.copyPath"),
  cmd("explorer.properties"),
  cmd("explorer.deletePermanently"),
  separator,
  cmd("explorer.showMoreOptions"),
];

/** Right-click on empty space in a folder. */
export const BACKGROUND_MENU: MenuEntry[] = [
  { type: "submenu", id: "view", labelKey: "commands.view", icon: List, entries: VIEW_MENU },
  { type: "submenu", id: "sort", labelKey: "commands.sortBy", icon: ArrowDownWideNarrow, entries: SORT_MENU },
  { type: "submenu", id: "new", labelKey: "commands.new", icon: Plus, entries: NEW_MENU },
  separator,
  cmd("explorer.paste"),
  cmd("explorer.pasteAsFile"),
  cmd("explorer.openInTerminal"),
  cmd("explorer.properties"),
  separator,
  cmd("explorer.showMoreOptions"),
];

export type BarEntry =
  | { type: "menu"; id: string; labelKey: string; icon: LucideIcon; entries: MenuEntry[] }
  | { type: "command"; id: string; showLabel?: boolean }
  | { type: "separator" }
  | { type: "overflow"; entries: MenuEntry[] }
  | { type: "spacer" };

/** The Explorer command bar, in the Figma order, with Windows 11's
 * Details toggle at the right. */
export const COMMAND_BAR: BarEntry[] = [
  { type: "menu", id: "new", labelKey: "commands.new", icon: Plus, entries: NEW_MENU },
  { type: "separator" },
  { type: "command", id: "explorer.cut" },
  { type: "command", id: "explorer.copy" },
  { type: "command", id: "explorer.paste" },
  { type: "command", id: "explorer.rename" },
  { type: "command", id: "explorer.share" },
  { type: "command", id: "explorer.delete" },
  { type: "separator" },
  { type: "menu", id: "sort", labelKey: "commands.sort", icon: ArrowDownWideNarrow, entries: SORT_MENU },
  { type: "menu", id: "view", labelKey: "commands.view", icon: List, entries: VIEW_MENU },
  { type: "separator" },
  { type: "overflow", entries: OVERFLOW_MENU },
  { type: "spacer" },
  { type: "command", id: "explorer.toggleDetailsPane", showLabel: true },
];

/** Drop unknown or hidden commands, empty submenus and icon rows, and
 * separators that would sit at an edge or next to another separator. */
export function resolveMenu(
  entries: readonly MenuEntry[],
  ctx: CommandContext,
  lookup: (id: string) => Command | undefined,
): MenuEntry[] {
  const visible = (id: string) => {
    const command = lookup(id);
    return command !== undefined && isCommandVisible(command, ctx);
  };
  const kept: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "command") {
      if (visible(entry.id)) kept.push(entry);
    } else if (entry.type === "iconRow") {
      const ids = entry.ids.filter(visible);
      if (ids.length > 0) kept.push({ ...entry, ids });
    } else if (entry.type === "submenu") {
      const sub = resolveMenu(entry.entries, ctx, lookup);
      if (sub.length > 0) kept.push({ ...entry, entries: sub });
    } else if (kept.length > 0 && kept[kept.length - 1].type !== "separator") {
      kept.push(entry);
    }
  }
  while (kept.length > 0 && kept[kept.length - 1].type === "separator") kept.pop();
  return kept;
}
