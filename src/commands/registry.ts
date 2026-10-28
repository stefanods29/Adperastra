import type { LucideIcon } from "lucide-react";

/** Command registry v1 (contract 7). Bars, menus, ribbons, shortcuts and
 * the palette are all callers; every action in the app registers here. */

export type CommandRisk = "read-only" | "change" | "recycle" | "irreversible";

export type LocationKind = "home" | "folder" | "drives" | "gallery" | "network";

export interface CommandContext {
  location: LocationKind;
  currentPath: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  selectedPath: string | null;
  selectedKind: "folder" | "file" | "other" | null;
  currentPinned: boolean;
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