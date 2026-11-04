/** Accessibility commands (Step 10f T5). Every command is a plain registry
 * entry whose host is supplied by the App; a missing host leaves the command
 * out of the registry instead of registering an empty stub. Pick-up itself
 * changes nothing on disk, but its accepted drop mutates through the normal
 * transfer pipeline, so `app.pickSelection` keeps that pipeline's `change`
 * risk (guide P5). */
import { Accessibility, Focus, Hand, Volume2, X } from "lucide-react";
import type { Command, CommandContext } from "./registry";

export interface AccessibilityCommandActions {
  /** Opens Settings > Accessibility. */
  openAccessibility: () => void;
  /** Reads the selected display names, never file contents implicitly. */
  readAloud?: (paths: readonly string[]) => void;
  pickSelection?: (paths: readonly string[]) => void;
  cancelPick?: () => void;
  focusLayout?: () => void;
  /** Live pick state for enablement; the command registry has no state. */
  pickActive?: () => boolean;
  focusLayoutActive?: () => boolean;
}

export const ACCESSIBILITY_COMMAND_IDS = {
  open: "app.accessibility",
  readAloud: "app.readAloud",
  pickSelection: "app.pickSelection",
  cancelPick: "app.cancelPick",
  focusLayout: "app.focusLayout",
} as const;

export function createAccessibilityCommands(
  actions: AccessibilityCommandActions,
): Command<CommandContext>[] {
  const hasSelection = (ctx: CommandContext) => ctx.selection.count > 0;
  return [
    {
      id: ACCESSIBILITY_COMMAND_IDS.open,
      labelKey: "accessibility.title",
      icon: Accessibility,
      risk: "read-only",
      helpSlug: "accessibility-overview",
      enabledWhen: () => true,
      run: () => actions.openAccessibility(),
    },
    {
      id: ACCESSIBILITY_COMMAND_IDS.readAloud,
      labelKey: "accessibility.read",
      icon: Volume2,
      risk: "read-only",
      helpSlug: "accessibility-vision",
      enabledWhen: (ctx) => actions.readAloud !== undefined && hasSelection(ctx),
      run: (ctx) => actions.readAloud?.([...ctx.selection.paths]),
    },
    {
      id: ACCESSIBILITY_COMMAND_IDS.pickSelection,
      labelKey: "accessibility.pick",
      icon: Hand,
      risk: "change",
      helpSlug: "accessibility-motor",
      enabledWhen: (ctx) =>
        actions.pickSelection !== undefined &&
        hasSelection(ctx) &&
        actions.pickActive?.() !== true,
      run: (ctx) => actions.pickSelection?.([...ctx.selection.paths]),
    },
    {
      id: ACCESSIBILITY_COMMAND_IDS.cancelPick,
      labelKey: "accessibility.cancelPick",
      icon: X,
      risk: "read-only",
      helpSlug: "accessibility-motor",
      enabledWhen: () => actions.cancelPick !== undefined && actions.pickActive?.() === true,
      run: () => actions.cancelPick?.(),
    },
    {
      id: ACCESSIBILITY_COMMAND_IDS.focusLayout,
      labelKey: "accessibility.focusLayout",
      icon: Focus,
      risk: "read-only",
      helpSlug: "accessibility-motion",
      enabledWhen: () => actions.focusLayout !== undefined,
      run: () => actions.focusLayout?.(),
      checkedWhen: () => actions.focusLayoutActive?.() === true,
      checkKind: "toggle",
    },
  ];
}
