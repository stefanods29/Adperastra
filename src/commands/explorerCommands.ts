import {
  AppWindow,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpNarrowWide,
  CalendarDays,
  ClipboardPaste,
  Copy,
  EllipsisVertical,
  Eye,
  FilePlus,
  FileType,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Grid2x2,
  Grid3x3,
  Group,
  Info,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  PanelRight,
  Pin,
  RefreshCw,
  Rows3,
  Ruler,
  Scissors,
  Shapes,
  Share,
  Square,
  SquareCheck,
  SquareTerminal,
  Star,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import type { SortDirection, SortKey } from "../services/explorer";
import type { GroupBy } from "../services/grouping";
import type { Command, CommandContext } from "./registry";

export type ViewToggle = "detailsPane" | "showHidden" | "showExtensions" | "itemCheckboxes";

/** Actions the Explorer view injects; commands never touch state directly. */
export interface ExplorerActions {
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  openSelected: () => void;
  goToPath: (path: string) => void;
  togglePin: () => void;
  rename: () => void;
  share: () => void;
  openWith: () => void;
  copyPath: () => void;
  toggleFavorite: () => void;
  showInFolder: () => void;
  properties: () => void;
  openInTerminal: () => void;
  selectAll: () => void;
  selectNone: () => void;
  invertSelection: () => void;
  setSortKey: (key: SortKey) => void;
  setSortDirection: (direction: SortDirection) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  toggleView: (option: ViewToggle) => void;
  showMoreOptions: () => void;
}

const inList = (ctx: CommandContext) => ctx.location === "folder" || ctx.location === "home";
const hasSelection = (ctx: CommandContext) => ctx.selection.count > 0;

export function createExplorerCommands(actions: ExplorerActions): Command[] {
  const sortBy = (id: string, key: SortKey, labelKey: string, icon: Command["icon"]): Command => ({
    id,
    labelKey,
    icon,
    risk: "read-only",
    helpSlug: "command-bar",
    checkKind: "radio",
    checkedWhen: (ctx) => ctx.view.sortKey === key,
    enabledWhen: (ctx) => ctx.location === "folder",
    run: () => actions.setSortKey(key),
  });
  const groupBy = (id: string, value: GroupBy, labelKey: string): Command => ({
    id,
    labelKey,
    icon: Group,
    risk: "read-only",
    helpSlug: "command-bar",
    checkKind: "radio",
    checkedWhen: (ctx) => ctx.view.groupBy === value,
    enabledWhen: (ctx) => ctx.location === "folder",
    run: () => actions.setGroupBy(value),
  });
  const viewMode = (id: string, labelKey: string, icon: Command["icon"], current: boolean): Command => ({
    id,
    labelKey,
    icon,
    risk: "read-only",
    helpSlug: "command-bar",
    checkKind: "radio",
    checkedWhen: () => current,
    enabledWhen: () => true,
    // List and icon views arrive with the view modes in Step 05.
    pending: !current,
    run: () => undefined,
  });
  const viewToggle = (id: string, option: ViewToggle, labelKey: string, icon: Command["icon"], shortcut?: string): Command => ({
    id,
    labelKey,
    icon,
    shortcut,
    risk: "read-only",
    helpSlug: option === "detailsPane" ? "details-pane" : "command-bar",
    checkKind: "toggle",
    checkedWhen: (ctx) => ctx.view[option],
    enabledWhen: () => true,
    run: () => actions.toggleView(option),
  });
  // File operations arrive with the job runner and undo stack in Step 03b.
  const fileOperation = (id: string, labelKey: string, icon: Command["icon"], shortcut: string, risk: Command["risk"], needsSelection: boolean): Command => ({
    id,
    labelKey,
    icon,
    shortcut,
    risk,
    helpSlug: "command-bar",
    pending: true,
    enabledWhen: (ctx) => (needsSelection ? hasSelection(ctx) : ctx.location === "folder"),
    run: () => undefined,
  });

  return [
    {
      id: "explorer.back",
      labelKey: "commands.back",
      icon: ArrowLeft,
      shortcut: "Alt+Left",
      risk: "read-only",
      helpSlug: "browsing-folders",
      enabledWhen: (ctx) => ctx.canGoBack,
      run: () => actions.back(),
    },
    {
      id: "explorer.forward",
      labelKey: "commands.forward",
      icon: ArrowRight,
      shortcut: "Alt+Right",
      risk: "read-only",
      helpSlug: "browsing-folders",
      enabledWhen: (ctx) => ctx.canGoForward,
      run: () => actions.forward(),
    },
    {
      id: "explorer.up",
      labelKey: "commands.up",
      icon: ArrowUp,
      shortcut: "Alt+Up",
      risk: "read-only",
      helpSlug: "browsing-folders",
      enabledWhen: (ctx) => ctx.location === "folder" && ctx.currentPath !== null,
      run: () => actions.up(),
    },
    {
      id: "explorer.refresh",
      labelKey: "commands.refresh",
      icon: RefreshCw,
      shortcut: "F5",
      risk: "read-only",
      helpSlug: "browsing-folders",
      enabledWhen: (ctx) => ctx.location === "folder" || ctx.location === "home" || ctx.location === "drives",
      run: () => actions.refresh(),
    },
    {
      id: "explorer.open",
      labelKey: "commands.open",
      icon: FolderOpen,
      shortcut: "Enter",
      risk: "read-only",
      helpSlug: "browsing-folders",
      enabledWhen: (ctx) => hasSelection(ctx) || ctx.selectedPath !== null,
      run: () => actions.openSelected(),
    },
    {
      id: "explorer.goToPath",
      labelKey: "commands.goToPath",
      icon: TextCursorInput,
      shortcut: "Ctrl+L",
      risk: "read-only",
      helpSlug: "address-bar",
      enabledWhen: () => true,
      run: (_ctx, arg) => {
        if (arg) actions.goToPath(arg);
      },
    },
    {
      id: "explorer.togglePin",
      labelKey: "commands.pinUnpin",
      icon: Pin,
      risk: "change",
      helpSlug: "pinning-folders",
      labelKeyFor: (ctx) => (ctx.currentPinned ? "commands.unpinFolder" : "commands.pinFolder"),
      enabledWhen: (ctx) => ctx.location === "folder" && ctx.currentPath !== null,
      run: () => actions.togglePin(),
    },
    fileOperation("explorer.newFolder", "commands.newFolder", FolderPlus, "Ctrl+Shift+N", "change", false),
    fileOperation("explorer.newTextFile", "commands.newTextFile", FilePlus, "", "change", false),
    fileOperation("explorer.cut", "commands.cut", Scissors, "Ctrl+X", "change", true),
    fileOperation("explorer.copy", "commands.copy", Copy, "Ctrl+C", "read-only", true),
    fileOperation("explorer.paste", "commands.paste", ClipboardPaste, "Ctrl+V", "change", false),
    fileOperation("explorer.delete", "commands.delete", Trash2, "Delete", "recycle", true),
    {
      id: "explorer.rename",
      labelKey: "commands.rename",
      icon: TextCursorInput,
      shortcut: "F2",
      risk: "change",
      helpSlug: "selecting-files",
      enabledWhen: (ctx) => ctx.selection.count === 1 && inList(ctx),
      run: () => actions.rename(),
    },
    {
      id: "explorer.share",
      labelKey: "commands.share",
      icon: Share,
      risk: "read-only",
      helpSlug: "right-click-menu",
      // The Windows share sheet shares files, not folders.
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.share(),
    },
    {
      id: "explorer.openWith",
      labelKey: "commands.openWith",
      icon: AppWindow,
      risk: "read-only",
      helpSlug: "right-click-menu",
      visibleWhen: (ctx) => ctx.selection.count === 1 && ctx.selection.files === 1,
      enabledWhen: (ctx) => ctx.selection.count === 1 && ctx.selection.files === 1,
      run: () => actions.openWith(),
    },
    {
      id: "explorer.copyPath",
      labelKey: "commands.copyPath",
      icon: Link,
      shortcut: "Ctrl+Shift+C",
      risk: "read-only",
      helpSlug: "right-click-menu",
      enabledWhen: (ctx) => hasSelection(ctx) || ctx.location === "folder",
      run: () => actions.copyPath(),
    },
    {
      id: "explorer.toggleFavorite",
      labelKey: "commands.addFavorite",
      icon: Star,
      risk: "change",
      helpSlug: "home-page",
      labelKeyFor: (ctx) => (ctx.allFavorites ? "commands.removeFavorite" : "commands.addFavorite"),
      enabledWhen: (ctx) => hasSelection(ctx),
      run: () => actions.toggleFavorite(),
    },
    {
      id: "explorer.showInFolder",
      labelKey: "commands.showInFolder",
      icon: FolderSearch,
      risk: "read-only",
      helpSlug: "right-click-menu",
      visibleWhen: (ctx) => ctx.selection.count === 1 && !ctx.selectionInCurrentFolder,
      enabledWhen: (ctx) => ctx.selection.count === 1 && !ctx.selectionInCurrentFolder,
      run: () => actions.showInFolder(),
    },
    {
      id: "explorer.properties",
      labelKey: "commands.properties",
      icon: Info,
      shortcut: "Alt+Enter",
      risk: "read-only",
      helpSlug: "right-click-menu",
      enabledWhen: (ctx) => hasSelection(ctx) || ctx.location === "folder",
      run: () => actions.properties(),
    },
    {
      id: "explorer.openInTerminal",
      labelKey: "commands.openInTerminal",
      icon: SquareTerminal,
      risk: "read-only",
      helpSlug: "right-click-menu",
      visibleWhen: (ctx) => ctx.location === "folder",
      enabledWhen: (ctx) => ctx.location === "folder" && ctx.currentPath !== null,
      run: () => actions.openInTerminal(),
    },
    {
      id: "explorer.selectAll",
      labelKey: "commands.selectAll",
      icon: ListChecks,
      shortcut: "Ctrl+A",
      risk: "read-only",
      helpSlug: "selecting-files",
      enabledWhen: inList,
      run: () => actions.selectAll(),
    },
    {
      id: "explorer.selectNone",
      labelKey: "commands.selectNone",
      icon: Square,
      risk: "read-only",
      helpSlug: "selecting-files",
      enabledWhen: hasSelection,
      run: () => actions.selectNone(),
    },
    {
      id: "explorer.invertSelection",
      labelKey: "commands.invertSelection",
      icon: ArrowLeftRight,
      risk: "read-only",
      helpSlug: "selecting-files",
      enabledWhen: inList,
      run: () => actions.invertSelection(),
    },
    sortBy("explorer.sortByName", "name", "commands.sortName", ArrowDownAZ),
    sortBy("explorer.sortByModified", "modified", "commands.sortModified", CalendarDays),
    sortBy("explorer.sortByType", "kind", "commands.sortType", Shapes),
    sortBy("explorer.sortBySize", "size", "commands.sortSize", Ruler),
    {
      id: "explorer.sortAscending",
      labelKey: "commands.sortAscending",
      icon: ArrowUpNarrowWide,
      risk: "read-only",
      helpSlug: "command-bar",
      checkKind: "radio",
      checkedWhen: (ctx) => ctx.view.sortDirection === "ascending",
      enabledWhen: (ctx) => ctx.location === "folder",
      run: () => actions.setSortDirection("ascending"),
    },
    {
      id: "explorer.sortDescending",
      labelKey: "commands.sortDescending",
      icon: ArrowDownWideNarrow,
      risk: "read-only",
      helpSlug: "command-bar",
      checkKind: "radio",
      checkedWhen: (ctx) => ctx.view.sortDirection === "descending",
      enabledWhen: (ctx) => ctx.location === "folder",
      run: () => actions.setSortDirection("descending"),
    },
    groupBy("explorer.groupByNone", "none", "commands.groupNone"),
    groupBy("explorer.groupByName", "name", "commands.sortName"),
    groupBy("explorer.groupByModified", "modified", "commands.sortModified"),
    groupBy("explorer.groupByType", "type", "commands.sortType"),
    groupBy("explorer.groupBySize", "size", "commands.sortSize"),
    viewMode("explorer.viewDetails", "commands.viewDetails", List, true),
    viewMode("explorer.viewList", "commands.viewList", Rows3, false),
    viewMode("explorer.viewSmallIcons", "commands.viewSmallIcons", Grid3x3, false),
    viewMode("explorer.viewMediumIcons", "commands.viewMediumIcons", Grid2x2, false),
    viewMode("explorer.viewLargeIcons", "commands.viewLargeIcons", LayoutGrid, false),
    viewToggle("explorer.toggleDetailsPane", "detailsPane", "commands.detailsPane", PanelRight, "Alt+Shift+P"),
    viewToggle("explorer.toggleHiddenItems", "showHidden", "commands.hiddenItems", Eye),
    viewToggle("explorer.toggleExtensions", "showExtensions", "commands.fileExtensions", FileType),
    viewToggle("explorer.toggleCheckboxes", "itemCheckboxes", "commands.itemCheckboxes", SquareCheck),
    {
      id: "explorer.showMoreOptions",
      labelKey: "commands.showMoreOptions",
      icon: EllipsisVertical,
      shortcut: "Shift+F10",
      risk: "read-only",
      helpSlug: "right-click-menu",
      enabledWhen: (ctx) => hasSelection(ctx) || ctx.location === "folder",
      run: () => actions.showMoreOptions(),
    },
  ];
}
