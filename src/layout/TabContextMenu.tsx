import { ArrowLeftRight, Columns2, Copy, FolderPlus, Link2, Pin, PinOff, Rows2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import Menu, { type MenuAnchor } from "../components/Menu";
import type { MenuEntry } from "../commands/menus";
import type { Command } from "../commands/registry";
import type { TabState } from "../services/tabs";

/** The tab right-click menu (Step 09a T6, extended by Step 09i): Pin/Unpin,
 * Duplicate, Open in split view, the split controls, Reopen closed tab and
 * New folder tab, as command data (contract 9). The commands themselves are
 * registered by the coordinator; this component only builds the entries for
 * one tab and renders the shared menu. */

/** The split commands in one typed place (Step 09i). The host registers
 * these ids with the exact labels/icons of the guide; the menu never spells
 * the ids out again. */
export const SPLIT_TAB_COMMANDS = {
  open: "tab.openSplit",
  swap: "tab.splitSwap",
  vertical: "tab.splitVertical",
  horizontal: "tab.splitHorizontal",
  sync: "tab.splitSync",
} as const;

export type SplitTabAction = keyof typeof SPLIT_TAB_COMMANDS;
export type SplitTabCommandId = (typeof SPLIT_TAB_COMMANDS)[SplitTabAction];

/** Every split command shares the one help page (Step 09i T6). */
export const SPLIT_TAB_HELP_SLUG = "split-view" as const;

/** The action a split command id selects, or null for every other tab
 * command. Lets a host route the five split actions without a registry. */
export function splitTabActionOf(commandId: string): SplitTabAction | null {
  for (const [action, id] of Object.entries(SPLIT_TAB_COMMANDS)) {
    if (id === commandId) return action as SplitTabAction;
  }
  return null;
}

export function tabMenuEntries(tab: TabState, hasClosedTabs: boolean, canSplit = false): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (tab.kind === "split") {
    // A split's controls act on the outer tab and its active leaf (D4/D5).
    // Pin and Duplicate stay off: a split is never pinned or consumed twice.
    entries.push({ type: "command", id: SPLIT_TAB_COMMANDS.swap });
    entries.push({ type: "command", id: SPLIT_TAB_COMMANDS.vertical });
    entries.push({ type: "command", id: SPLIT_TAB_COMMANDS.horizontal });
    entries.push({ type: "command", id: SPLIT_TAB_COMMANDS.sync });
  } else if (tab.kind !== "explorer") {
    entries.push({ type: "command", id: tab.pinned ? "tab.unpin" : "tab.pin" });
    entries.push({ type: "command", id: "tab.duplicate" });
    if (canSplit) entries.push({ type: "command", id: SPLIT_TAB_COMMANDS.open });
  }
  if (hasClosedTabs) entries.push({ type: "command", id: "tab.reopenClosed" });
  entries.push({ type: "separator" });
  entries.push({ type: "command", id: "explorer.openInNewTab" });
  return entries;
}

export const TAB_MENU_ICONS = {
  "tab.pin": Pin,
  "tab.unpin": PinOff,
  "tab.duplicate": Copy,
  "tab.reopenClosed": Undo2,
  "explorer.openInNewTab": FolderPlus,
  "tab.openSplit": Columns2,
  "tab.splitSwap": ArrowLeftRight,
  "tab.splitVertical": Columns2,
  "tab.splitHorizontal": Rows2,
  "tab.splitSync": Link2,
} as const;

export interface TabContextMenuProps {
  tab: TabState;
  hasClosedTabs: boolean;
  /** Another eligible tab can join this one in a split right now. */
  canSplit?: boolean;
  anchor: MenuAnchor;
  lookup: (id: string) => Command | undefined;
  onRun: (command: Command) => void;
  /** Optional direct split routing (open/swap/vertical/horizontal/sync).
   * When given, the five split entries call this instead of `onRun`, so a
   * host can apply the actual split services without registering command
   * entries. Every other command still goes through `onRun`. */
  onSplitAction?: (action: SplitTabAction, tab: TabState) => void;
  onClose: () => void;
}

export default function TabContextMenu({ tab, hasClosedTabs, canSplit = false, anchor, lookup, onRun, onSplitAction, onClose }: TabContextMenuProps) {
  const { t } = useTranslation();
  const run = (command: Command) => {
    const action = splitTabActionOf(command.id);
    if (action && onSplitAction) onSplitAction(action, tab);
    else onRun(command);
  };
  return (
    <Menu
      entries={tabMenuEntries(tab, hasClosedTabs, canSplit)}
      ctx={undefined as never}
      lookup={lookup}
      anchor={anchor}
      onRun={run}
      onClose={onClose}
      ariaLabel={t("tabs.pin")}
    />
  );
}
