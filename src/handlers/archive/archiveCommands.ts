import {
  ExternalLink,
  FolderOutput,
  FolderSearch,
  FolderUp,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import type { Command } from "../../commands/registry";
import type { MenuEntry } from "../../commands/menus";
import type { RibbonDef } from "../../ribbon/types";
import type { ArchiveItem } from "../../services/archive";

/** The archive tab's commands and menus (Step 06d). Everything is data:
 * the ribbon, the item menu and the background menu are built from ids. */

const HELP = "archives";

/** What the commands read; the view keeps it up to date. */
export interface ArchiveCtx {
  /** The listing is loaded and usable. */
  ready: boolean;
  /** Extraction is possible (the Explorer is there to run the job). */
  canExtract: boolean;
  /** Files inside the archive, for "Extract all". */
  files: number;
  selectedCount: number;
  single: ArchiveItem | null;
  folder: string;
  /** The list shows search results, not one folder. */
  searching: boolean;
  /** A file is being copied out right now. */
  busy: boolean;
  loading: boolean;
}

export interface ArchiveActions {
  extractAll: () => void;
  extractSelected: () => void;
  openEntry: () => void;
  openLocation: () => void;
  up: () => void;
  refresh: () => void;
}

/** A link can never be copied out, and a protected file cannot be opened. */
function canOpen(single: ArchiveItem | null): boolean {
  if (!single) return false;
  if (single.kind === "folder") return true;
  return single.kind === "file" && !single.encrypted;
}

export function createArchiveCommands(actions: ArchiveActions): Command<ArchiveCtx>[] {
  return [
    {
      id: "archive.extractAll",
      labelKey: "archive.extractAll",
      icon: PackageOpen,
      risk: "change",
      helpSlug: HELP,
      enabledWhen: (ctx) => ctx.ready && ctx.canExtract && ctx.files > 0,
      run: () => actions.extractAll(),
    },
    {
      id: "archive.extractSelected",
      labelKey: "archive.extractSelected",
      icon: FolderOutput,
      risk: "change",
      helpSlug: HELP,
      enabledWhen: (ctx) => ctx.ready && ctx.canExtract && ctx.selectedCount > 0,
      run: () => actions.extractSelected(),
    },
    {
      id: "archive.openEntry",
      labelKey: "archive.openEntry",
      icon: ExternalLink,
      risk: "read-only",
      helpSlug: HELP,
      enabledWhen: (ctx) => ctx.ready && !ctx.busy && canOpen(ctx.single),
      run: () => actions.openEntry(),
    },
    {
      id: "archive.openLocation",
      labelKey: "archive.openLocation",
      icon: FolderSearch,
      risk: "read-only",
      helpSlug: HELP,
      visibleWhen: (ctx) => ctx.searching,
      enabledWhen: (ctx) => ctx.single !== null,
      run: () => actions.openLocation(),
    },
    {
      id: "archive.up",
      labelKey: "archive.up",
      icon: FolderUp,
      shortcut: "Backspace",
      risk: "read-only",
      helpSlug: HELP,
      enabledWhen: (ctx) => ctx.ready && ctx.folder !== "" && !ctx.searching,
      run: () => actions.up(),
    },
    {
      id: "archive.refresh",
      labelKey: "archive.refresh",
      icon: RefreshCw,
      shortcut: "F5",
      risk: "read-only",
      helpSlug: HELP,
      enabledWhen: (ctx) => !ctx.loading,
      run: () => actions.refresh(),
    },
  ];
}

/** One tab with the extraction and navigation groups. */
export const ARCHIVE_RIBBON: RibbonDef = {
  tabs: [
    {
      id: "archive",
      labelKey: "archive.ribbonTab",
      keyTip: "A",
      groups: [
        {
          id: "extract",
          labelKey: "archive.groupExtract",
          controls: [
            { type: "button", command: "archive.extractAll", showLabel: true, keyTip: "E" },
            { type: "button", command: "archive.extractSelected", showLabel: true, keyTip: "S" },
          ],
        },
        {
          id: "navigate",
          labelKey: "archive.groupNavigate",
          controls: [
            { type: "button", command: "archive.up", keyTip: "U" },
            { type: "button", command: "archive.openEntry", keyTip: "O" },
            { type: "button", command: "archive.openLocation", keyTip: "L" },
            { type: "button", command: "archive.refresh", keyTip: "R" },
          ],
        },
      ],
    },
  ],
};

/** Right-click on one item inside the archive. */
export const ARCHIVE_ITEM_MENU: MenuEntry[] = [
  { type: "command", id: "archive.openEntry" },
  { type: "command", id: "archive.openLocation" },
  { type: "separator" },
  { type: "command", id: "archive.extractSelected" },
];

/** Right-click on the empty space below the items. */
export const ARCHIVE_BACKGROUND_MENU: MenuEntry[] = [
  { type: "command", id: "archive.extractAll" },
  { type: "command", id: "archive.refresh" },
];
