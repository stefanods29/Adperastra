import type { LucideIcon } from "lucide-react";
import type { SortDirection, SortKey } from "../services/explorer";
import type { GroupBy } from "../services/grouping";

/** Command registry v1 (contract 7). Bars, menus, ribbons, shortcuts and
 * the palette are all callers; every action in the app registers here. */

export type CommandRisk = "read-only" | "change" | "recycle" | "irreversible";

export type LocationKind = "home" | "folder" | "drives" | "gallery" | "network";

/** What is selected (Step 03a): paths in display order plus counts. */
export interface SelectionContext {
  paths: string[];
  count: number;
  files: number;
  folders: number;
}

/** The View and Sort menus' current state. */
export interface ViewContext {
  showHidden: boolean;
  showExtensions: boolean;
  itemCheckboxes: boolean;
  detailsPane: boolean;
  groupBy: GroupBy;
  sortKey: SortKey;
  sortDirection: SortDirection;
}

export interface CommandContext {
  location: LocationKind;
  currentPath: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The focused or only selected item (kept from Step 02 for callers). */
  selectedPath: string | null;
  selectedKind: "folder" | "file" | "other" | null;
  currentPinned: boolean;
  selection: SelectionContext;
  view: ViewContext;
  /** Every selected item is already a favorite. */
  allFavorites: boolean;
  /** The selection is in the folder on screen (false for Home lists). */
  selectionInCurrentFolder: boolean;
  /** Undo stack state (Step 03b): Undo/Redo enablement. */
  canUndo: boolean;
  canRedo: boolean;
}

export interface Command {
  id: string;
  /** i18n key, never display text. */
  labelKey: string;
  icon: LucideIcon;
  shortcut?: string;
  risk: CommandRisk;
  /** Help page slug opened with F1 / "?" for this command. */
  helpSlug: string;
  enabledWhen: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext, arg?: string) => void;
  /** Toggle and radio entries in menus show a check mark when true. */
  checkedWhen?: (ctx: CommandContext) => boolean;
  checkKind?: "toggle" | "radio";
  /** Hidden commands are left out of menus and bars. */
  visibleWhen?: (ctx: CommandContext) => boolean;
  /** A label that depends on the context (for example add/remove favorite). */
  labelKeyFor?: (ctx: CommandContext) => string;
  /** Designed but not working yet: always disabled, and the tooltip says
   * it arrives in a later update. */
  pending?: boolean;
}

export function isCommandEnabled(command: Command, ctx: CommandContext): boolean {
  return !command.pending && command.enabledWhen(ctx);
}

export function isCommandVisible(command: Command, ctx: CommandContext): boolean {
  return command.visibleWhen ? command.visibleWhen(ctx) : true;
}

export function commandLabelKey(command: Command, ctx: CommandContext): string {
  return command.labelKeyFor ? command.labelKeyFor(ctx) : command.labelKey;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`duplicate command id: ${command.id}`);
    }
    this.commands.set(command.id, command);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }
}
