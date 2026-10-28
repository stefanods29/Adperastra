import { ArrowLeft, ArrowRight, ArrowUp, FolderOpen, Pin, RefreshCw, TextCursorInput } from "lucide-react";
import type { Command } from "./registry";

/** Actions the Explorer view injects; commands never touch state directly. */
export interface ExplorerActions {
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  openSelected: () => void;
  goToPath: (path: string) => void;
  togglePin: () => void;
}

export function createExplorerCommands(actions: ExplorerActions): Command[] {
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
      enabledWhen: (ctx) => ctx.selectedPath !== null,
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
      enabledWhen: (ctx) => ctx.location === "folder" && ctx.currentPath !== null,
      run: () => actions.togglePin(),
    },
  ];
}