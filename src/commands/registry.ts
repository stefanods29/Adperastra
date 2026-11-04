import type { LucideIcon } from "lucide-react";
import type { SortDirection, SortKey } from "../services/explorer";
import type { GroupBy } from "../services/grouping";
import type { ViewModeId } from "../services/settings";

/** Command registry v1 (contract 7). Bars, menus, ribbons, shortcuts and
 * the palette are all callers; every action in the app registers here. */

export type CommandRisk = "read-only" | "change" | "recycle" | "irreversible";

/** Optional tool metadata used by the trusted assistant adapter (Step 17a).
 * It never changes command availability or grants a capability by itself. */
export interface CommandAssistantMetadata {
  tool_id?: string;
  capability?: string;
  automatic_allowed?: boolean;
}

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
  /** The view the folder is shown in (Step 05a). */
  viewMode: ViewModeId;
  /** Views left out of the View menu (Step 05a). */
  hiddenViewModes: readonly ViewModeId[];
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
  /** A Gallery source row is selected, so Remove folder is enabled. */
  gallerySourceSelected?: boolean;
  view: ViewContext;
  /** Every selected item is already a favorite. */
  allFavorites: boolean;
  /** The selection is in the folder on screen (false for Home lists). */
  selectionInCurrentFolder: boolean;
  /** Undo stack state (Step 03b): Undo/Redo enablement. */
  canUndo: boolean;
  canRedo: boolean;
}

/** A command. `C` is the context its rules read: the Explorer's
 * `CommandContext` by default, or a viewer's own context (Step 04b). */
export interface Command<C = CommandContext> {
  id: string;
  /** i18n key, never display text. */
  labelKey: string;
  icon: LucideIcon;
  shortcut?: string;
  risk: CommandRisk;
  /** Help page slug opened with F1 / "?" for this command. */
  helpSlug: string;
  enabledWhen: (ctx: C) => boolean;
  /** Reason shown by the palette for a currently disabled command. */
  disabledReasonKey?: (ctx: C) => string;
  run: (ctx: C, arg?: string) => void;
  /** Hidden only by Simple mode's presentation filter; never disabled. */
  advanced?: boolean;
  /** Trusted static metadata for an explicitly registered assistant tool. */
  assistant?: CommandAssistantMetadata;
  /** Toggle and radio entries in menus show a check mark when true. */
  checkedWhen?: (ctx: C) => boolean;
  checkKind?: "toggle" | "radio";
  /** Hidden commands are left out of menus and bars. */
  visibleWhen?: (ctx: C) => boolean;
  /** A label that depends on the context (for example add/remove favorite). */
  labelKeyFor?: (ctx: C) => string;
  /** Designed but not working yet: always disabled, and the tooltip says
   * it arrives in a later update. */
  pending?: boolean;
}

export function isCommandEnabled<C>(command: Command<C>, ctx: C): boolean {
  return !command.pending && command.enabledWhen(ctx);
}

export function isCommandVisible<C>(command: Command<C>, ctx: C): boolean {
  return command.visibleWhen ? command.visibleWhen(ctx) : true;
}

/** Presentation filter for bars and menus (Step 10f D9). Simple mode hides
 * only commands marked `advanced`; the palette and shortcuts keep every
 * registered command reachable, so availability and safety never change. */
export function isCommandPresented<C>(
  command: Command<C>,
  ctx: C,
  simpleMode: boolean,
): boolean {
  return isCommandVisible(command, ctx) && (!simpleMode || command.advanced !== true);
}

export function commandLabelKey<C>(command: Command<C>, ctx: C): string {
  return command.labelKeyFor ? command.labelKeyFor(ctx) : command.labelKey;
}

export class CommandRegistry<C = CommandContext> {
  private commands = new Map<string, Command<C>>();

  register(command: Command<C>): void {
    if (this.commands.has(command.id)) {
      throw new Error(`duplicate command id: ${command.id}`);
    }
    this.commands.set(command.id, command);
  }

  get(id: string): Command<C> | undefined {
    return this.commands.get(id);
  }

  list(): Command<C>[] {
    return [...this.commands.values()];
  }
}
