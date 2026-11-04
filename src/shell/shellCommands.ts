/** The Step 10e shell-customization commands (registered with the Explorer's
 * own command list, so the palette, menus and shortcuts share one registry).
 * Each command only opens its Settings section or setup action; it never
 * edits a menu or setting directly. */
import { Download, LayoutDashboard, Menu, PanelBottom, PanelLeft, Share2 } from "lucide-react";
import type { Command, CommandContext } from "../commands/registry";

export interface ShellCommandActions {
  editMenus(): void;
  editHome(): void;
  editNavigation(): void;
  editStatus(): void;
  importSetup(): void;
  shareSetup(): void;
}

export function createShellCommands(actions: ShellCommandActions): Command<CommandContext>[] {
  const command = (
    id: string,
    labelKey: string,
    icon: Command<CommandContext>["icon"],
    helpSlug: string,
    run: () => void,
  ): Command<CommandContext> => ({
    id,
    labelKey,
    icon,
    risk: "change",
    helpSlug,
    enabledWhen: () => true,
    run,
  });
  return [
    command("app.editMenus", "shellCustom.menus", Menu, "editing-menus", actions.editMenus),
    command("app.editHome", "shellCustom.home", LayoutDashboard, "customizing-home-navigation-status", actions.editHome),
    command(
      "app.editNavigation",
      "shellCustom.navigation",
      PanelLeft,
      "customizing-home-navigation-status",
      actions.editNavigation,
    ),
    command("app.editStatus", "shellCustom.status", PanelBottom, "customizing-home-navigation-status", actions.editStatus),
    command("app.importSetup", "setups.import", Download, "shareable-setups", actions.importSetup),
    command("app.shareSetup", "setups.export", Share2, "shareable-setups", actions.shareSetup),
  ];
}
