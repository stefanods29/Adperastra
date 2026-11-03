import {
  AlignJustify,
  AppWindow,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpNarrowWide,
  Binary,
  CalendarDays,
  ClipboardPaste,
  Columns3,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Eye,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderInput,
  FolderOpen,
  FolderOutput,
  FolderPlus,
  FolderSearch,
  Grid2x2,
  History,
  Grid3x3,
  Group,
  Info,
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  Link,
  List,
  ListChecks,
  NotebookPen,
  PackageOpen,
  PanelRight,
  Pin,
  Presentation,
  Redo2,
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
  Table,
  TextCursorInput,
  Trash2,
  Undo2,
} from "lucide-react";
import { isArchivePath, type ExtractMode } from "../archive/archiveFiles";
import type { SortDirection, SortKey } from "../services/explorer";
import type { GroupBy } from "../services/grouping";
import { VIEW_MODE_IDS, type ViewModeId } from "../services/settings";
import type { BlankKind } from "../templates/catalog";
import type { Command, CommandContext } from "./registry";

export type ViewToggle = "detailsPane" | "showHidden" | "showExtensions" | "itemCheckboxes";

/** Command id, label key and icon per view mode (Step 05a). */
export const VIEW_MODE_COMMANDS: Record<ViewModeId, string> = {
  extraLargeIcons: "explorer.viewExtraLargeIcons",
  largeIcons: "explorer.viewLargeIcons",
  mediumIcons: "explorer.viewMediumIcons",
  smallIcons: "explorer.viewSmallIcons",
  list: "explorer.viewList",
  details: "explorer.viewDetails",
  tiles: "explorer.viewTiles",
  content: "explorer.viewContent",
  columns: "explorer.viewColumns",
};

export const VIEW_MODE_LABEL_KEYS: Record<ViewModeId, string> = {
  extraLargeIcons: "commands.viewExtraLargeIcons",
  largeIcons: "commands.viewLargeIcons",
  mediumIcons: "commands.viewMediumIcons",
  smallIcons: "commands.viewSmallIcons",
  list: "commands.viewList",
  details: "commands.viewDetails",
  tiles: "commands.viewTiles",
  content: "commands.viewContent",
  columns: "commands.viewColumns",
};

export const VIEW_MODE_ICONS: Record<ViewModeId, Command["icon"]> = {
  extraLargeIcons: Square,
  largeIcons: LayoutGrid,
  mediumIcons: Grid2x2,
  smallIcons: Grid3x3,
  list: Rows3,
  details: List,
  tiles: LayoutList,
  content: AlignJustify,
  columns: Columns3,
};

/** Ctrl+Shift+1 to Ctrl+Shift+8, by the mode's position in `VIEW_MODE_IDS`.
 * Column view has no shortcut (Step 05b D1). */
export function viewModeShortcut(mode: ViewModeId): string | undefined {
  if (mode === "columns") return undefined;
  return `Ctrl+Shift+${VIEW_MODE_IDS.indexOf(mode) + 1}`;
}

/** Actions the Explorer view injects; commands never touch state directly. */
export interface ExplorerActions {
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  openSelected: () => void;
  /** Step 07b: Space on the focused file. */
  quickPreview: () => void;
  goToPath: (path: string) => void;
  togglePin: () => void;
  rename: () => void;
  share: () => void;
  openWith: () => void;
  /** Open the selected files in their Windows default apps (Step 04a). */
  openInWindowsApp: () => void;
  /** Open the selected files in the text or hex viewer (Step 04c). */
  openAsText: () => void;
  openAsHex: () => void;
  /** Extract the selected archives (Step 06d). */
  extractArchives: (mode: ExtractMode) => void;
  /** Open the Compress to… window for the live selection (Step 06e). */
  compressTo: () => void;
  copyPath: () => void;
  toggleFavorite: () => void;
  showInFolder: () => void;
  properties: () => void;
  /** Open the Version history window (Step 06b). */
  versionHistory: () => void;
  openInTerminal: () => void;
  selectAll: () => void;
  selectNone: () => void;
  invertSelection: () => void;
  setSortKey: (key: SortKey) => void;
  setSortDirection: (direction: SortDirection) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  toggleView: (option: ViewToggle) => void;
  /** Step 05a: remember the folder's view or change the default one. */
  setViewMode: (mode: ViewModeId) => void;
  showMoreOptions: () => void;
  newFolder: () => void;
  newTextFile: () => void;
  /** Step 06c: a blank Markdown, CSV or Office file. */
  newBlank: (kind: BlankKind) => void;
  /** Step 06c: the template window. */
  newFromTemplate: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  pasteAsFile: () => void;
  deleteItems: () => void;
  deletePermanently: () => void;
  undo: () => void;
  redo: () => void;
  recentActions: () => void;
}

const inList = (ctx: CommandContext) => ctx.location === "folder" || ctx.location === "home";
const hasSelection = (ctx: CommandContext) => ctx.selection.count > 0;
/** Only archives can be extracted, and only when no folder is selected. */
const archivesOnly = (ctx: CommandContext) =>
  ctx.selection.count > 0 &&
  ctx.selection.folders === 0 &&
  ctx.selection.paths.every((path) => isArchivePath(path));

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
  const viewMode = (mode: ViewModeId): Command => ({
    id: VIEW_MODE_COMMANDS[mode],
    labelKey: VIEW_MODE_LABEL_KEYS[mode],
    icon: VIEW_MODE_ICONS[mode],
    shortcut: viewModeShortcut(mode),
    risk: "read-only",
    helpSlug: "view-modes",
    checkKind: "radio",
    checkedWhen: (ctx) => ctx.view.viewMode === mode,
    enabledWhen: (ctx) => ctx.location === "folder",
    visibleWhen: (ctx) => !ctx.view.hiddenViewModes.includes(mode),
    run: () => actions.setViewMode(mode),
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
  const inFolder = (ctx: CommandContext) => ctx.location === "folder";

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
      id: "explorer.quickPreview",
      labelKey: "commands.quickPreview",
      icon: Eye,
      shortcut: "Space",
      risk: "read-only",
      helpSlug: "quick-preview",
      enabledWhen: (ctx) =>
        ctx.selection.count === 1 &&
        ctx.selection.folders === 0 &&
        (ctx.location === "folder" || ctx.location === "home"),
      run: () => {
        // The shortcut exists for menus and tooltips; it must never take
        // Space away from a focused button, link or text field.
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active.closest("button, a, input, textarea, select, [contenteditable='true']")
        ) {
          return;
        }
        actions.quickPreview();
      },
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
    {
      id: "explorer.newFolder",
      labelKey: "commands.newFolder",
      icon: FolderPlus,
      shortcut: "Ctrl+Shift+N",
      risk: "change",
      helpSlug: "copying-and-moving",
      enabledWhen: inFolder,
      run: () => actions.newFolder(),
    },
    {
      id: "explorer.newTextFile",
      labelKey: "commands.newTextFile",
      icon: FilePlus,
      risk: "change",
      helpSlug: "copying-and-moving",
      enabledWhen: inFolder,
      run: () => actions.newTextFile(),
    },
    {
      id: "explorer.newMarkdown",
      labelKey: "commands.newMarkdown",
      icon: NotebookPen,
      risk: "change",
      helpSlug: "templates",
      enabledWhen: inFolder,
      run: () => actions.newBlank("markdown"),
    },
    {
      id: "explorer.newCsv",
      labelKey: "commands.newCsv",
      icon: Table,
      risk: "change",
      helpSlug: "templates",
      enabledWhen: inFolder,
      run: () => actions.newBlank("csv"),
    },
    {
      id: "explorer.newDocument",
      labelKey: "commands.newDocument",
      icon: FileText,
      risk: "change",
      helpSlug: "templates",
      enabledWhen: inFolder,
      run: () => actions.newBlank("document"),
    },
    {
      id: "explorer.newSpreadsheet",
      labelKey: "commands.newSpreadsheet",
      icon: FileSpreadsheet,
      risk: "change",
      helpSlug: "templates",
      enabledWhen: inFolder,
      run: () => actions.newBlank("spreadsheet"),
    },
    {
      id: "explorer.newPresentation",
      labelKey: "commands.newPresentation",
      icon: Presentation,
      risk: "change",
      helpSlug: "templates",
      enabledWhen: inFolder,
      run: () => actions.newBlank("presentation"),
    },
    {
      id: "explorer.newFromTemplate",
      labelKey: "commands.newFromTemplate",
      icon: LayoutTemplate,
      risk: "change",
      helpSlug: "templates",
      enabledWhen: inFolder,
      run: () => actions.newFromTemplate(),
    },
    {
      id: "explorer.cut",
      labelKey: "commands.cut",
      icon: Scissors,
      shortcut: "Ctrl+X",
      risk: "change",
      helpSlug: "copying-and-moving",
      enabledWhen: (ctx) => hasSelection(ctx) && inList(ctx),
      run: () => actions.cut(),
    },
    {
      id: "explorer.copy",
      labelKey: "commands.copy",
      icon: Copy,
      shortcut: "Ctrl+C",
      risk: "read-only",
      helpSlug: "copying-and-moving",
      enabledWhen: (ctx) => hasSelection(ctx) && inList(ctx),
      run: () => actions.copy(),
    },
    {
      id: "explorer.paste",
      labelKey: "commands.paste",
      icon: ClipboardPaste,
      shortcut: "Ctrl+V",
      risk: "change",
      helpSlug: "copying-and-moving",
      enabledWhen: inFolder,
      run: () => actions.paste(),
    },
    {
      id: "explorer.pasteAsFile",
      labelKey: "commands.pasteAsFile",
      icon: ClipboardPaste,
      risk: "change",
      helpSlug: "paste-as-file",
      enabledWhen: inFolder,
      run: () => actions.pasteAsFile(),
    },
    {
      id: "explorer.delete",
      labelKey: "commands.delete",
      icon: Trash2,
      shortcut: "Delete",
      risk: "recycle",
      helpSlug: "deleting-and-the-recycle-bin",
      enabledWhen: (ctx) => hasSelection(ctx) && inList(ctx),
      run: () => actions.deleteItems(),
    },
    {
      id: "explorer.deletePermanently",
      labelKey: "commands.deletePermanently",
      icon: Trash2,
      shortcut: "Shift+Delete",
      risk: "irreversible",
      helpSlug: "deleting-and-the-recycle-bin",
      enabledWhen: (ctx) => hasSelection(ctx) && inList(ctx),
      run: () => actions.deletePermanently(),
    },
    {
      id: "explorer.undo",
      labelKey: "commands.undo",
      icon: Undo2,
      shortcut: "Ctrl+Z",
      risk: "change",
      helpSlug: "undo",
      enabledWhen: (ctx) => ctx.canUndo,
      run: () => actions.undo(),
    },
    {
      id: "explorer.redo",
      labelKey: "commands.redo",
      icon: Redo2,
      shortcut: "Ctrl+Y",
      risk: "change",
      helpSlug: "undo",
      enabledWhen: (ctx) => ctx.canRedo,
      run: () => actions.redo(),
    },
    {
      id: "explorer.recentActions",
      labelKey: "commands.recentActions",
      icon: History,
      risk: "read-only",
      helpSlug: "undo",
      enabledWhen: () => true,
      run: () => actions.recentActions(),
    },
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
      id: "explorer.openInWindowsApp",
      labelKey: "commands.openInWindowsApp",
      icon: ExternalLink,
      risk: "read-only",
      helpSlug: "opening-files",
      visibleWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.openInWindowsApp(),
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
      id: "explorer.openAsText",
      labelKey: "commands.openAsText",
      icon: FileText,
      risk: "read-only",
      helpSlug: "open-as-text-or-hex",
      visibleWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.openAsText(),
    },
    {
      id: "explorer.openAsHex",
      labelKey: "commands.openAsHex",
      icon: Binary,
      risk: "read-only",
      helpSlug: "open-as-text-or-hex",
      visibleWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.openAsHex(),
    },
    {
      id: "explorer.extractToFolder",
      labelKey: "commands.extractAll",
      icon: PackageOpen,
      risk: "change",
      helpSlug: "archives",
      visibleWhen: archivesOnly,
      enabledWhen: archivesOnly,
      run: () => actions.extractArchives("newFolder"),
    },
    {
      id: "explorer.extractHere",
      labelKey: "commands.extractHere",
      icon: FolderInput,
      risk: "change",
      helpSlug: "archives",
      visibleWhen: archivesOnly,
      enabledWhen: archivesOnly,
      run: () => actions.extractArchives("here"),
    },
    {
      id: "explorer.extractTo",
      labelKey: "commands.extractTo",
      icon: FolderOutput,
      risk: "change",
      helpSlug: "archives",
      visibleWhen: archivesOnly,
      enabledWhen: archivesOnly,
      run: () => actions.extractArchives("to"),
    },
    {
      id: "explorer.compressTo",
      labelKey: "commands.compressTo",
      icon: PackageOpen,
      risk: "change",
      helpSlug: "creating-archives",
      visibleWhen: (ctx) => ctx.location === "folder" && ctx.currentPath !== null,
      enabledWhen: (ctx) => ctx.location === "folder" && ctx.selection.count > 0,
      run: () => actions.compressTo(),
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
      id: "explorer.versionHistory",
      labelKey: "commands.versionHistory",
      icon: History,
      risk: "read-only",
      helpSlug: "version-history",
      visibleWhen: (ctx) => ctx.selection.count === 1 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.count === 1 && ctx.selection.folders === 0,
      run: () => actions.versionHistory(),
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
    ...VIEW_MODE_IDS.map((mode) => viewMode(mode)),
    viewToggle("explorer.toggleDetailsPane", "detailsPane", "commands.detailsPane", PanelRight, "Alt+Shift+P"),
    viewToggle("explorer.toggleHiddenItems", "showHidden", "commands.hiddenItems", Eye),
    viewToggle("explorer.toggleExtensions", "showExtensions", "commands.fileExtensions", FileType),
    viewToggle("explorer.toggleCheckboxes", "itemCheckboxes", "commands.itemCheckboxes", SquareCheck),
    {
      id: "explorer.showMoreOptions",
      labelKey: "commands.showMoreOptions",
      icon: EllipsisVertical,
      shortcut: "Shift+F10",
      // The classic menu can delete or move items through Windows.
      risk: "change",
      helpSlug: "right-click-menu",
      enabledWhen: (ctx) => hasSelection(ctx) || ctx.location === "folder",
      run: () => actions.showMoreOptions(),
    },
  ];
}
