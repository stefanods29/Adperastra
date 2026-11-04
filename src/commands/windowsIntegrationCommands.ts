import { Moon, PanelsTopLeft } from "lucide-react";
import type { Command, CommandContext } from "./registry";

export interface WindowsIntegrationActions {
  /** Open Settings > Windows integration. */
  openWindowsIntegration: () => void;
  /** Open Settings > Startup at the background section. */
  openStayBackground: () => void;
}

/**
 * Two navigation commands (guide T1 text table): no shortcut and no state of
 * their own. They never change integration or residence by themselves.
 */
export function createWindowsIntegrationCommands(
  actions: WindowsIntegrationActions,
): Command[] {
  return [
    {
      id: "app.windowsIntegration",
      labelKey: "windowsIntegration.title",
      icon: PanelsTopLeft,
      risk: "read-only",
      helpSlug: "windows-integration",
      enabledWhen: (_ctx: CommandContext) => true,
      run: () => actions.openWindowsIntegration(),
    },
    {
      id: "app.stayBackground",
      labelKey: "resident.enable",
      icon: Moon,
      risk: "read-only",
      helpSlug: "stay-in-background",
      enabledWhen: (_ctx: CommandContext) => true,
      run: () => actions.openStayBackground(),
    },
  ];
}
