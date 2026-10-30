/** How a toolbar is drawn where it is docked (Step 05c). Without a
 * provider, toolbars draw as at the top, in the Full look. */
import { createContext } from "react";
import type { ToolbarMode, ToolbarPosition } from "../services/settings";

/** A bar across the window, or a column down one side. */
export type ToolbarOrientation = "horizontal" | "vertical";

/** Where a toolbar sits and how it looks. */
export interface ToolbarLayout {
  side: ToolbarPosition;
  orientation: ToolbarOrientation;
  mode: "full" | "compact" | "iconsOnly";
}

/** Today's look: across the top, with icons and labels. */
export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = {
  side: "top",
  orientation: "horizontal",
  mode: "full",
};

/** Read by every toolbar; without a provider it is `DEFAULT_TOOLBAR_LAYOUT`. */
export const ToolbarLayoutContext = createContext<ToolbarLayout>(DEFAULT_TOOLBAR_LAYOUT);

/** A bar on the left or right side runs vertically. */
export function toolbarOrientation(side: ToolbarPosition): ToolbarOrientation {
  return side === "left" || side === "right" ? "vertical" : "horizontal";
}

/** The layout to give a toolbar on `side`; the auto-hide line shows the
 * toolbar in the Full look. */
export function toolbarLayoutFor(side: ToolbarPosition, mode: ToolbarMode): ToolbarLayout {
  return {
    side,
    orientation: toolbarOrientation(side),
    mode: mode === "autoHide" ? "full" : mode,
  };
}

/** Where a button's tooltip opens: away from the window edge. */
export function tooltipPlacement(layout: ToolbarLayout): "above" | "below" | "right" | "left" {
  if (layout.orientation === "vertical") return layout.side === "left" ? "right" : "left";
  return layout.side === "top" ? "below" : "above";
}

/** What a command bar entry is, for the label rules. */
export type BarItemKind = "menu" | "command" | "labeledCommand" | "overflow";

/** Whether a command bar entry shows its name in this look. */
export function barLabelVisible(layout: ToolbarLayout, kind: BarItemKind): boolean {
  if (layout.mode === "iconsOnly") return false;
  if (layout.orientation === "vertical") return true;
  return kind === "menu" || kind === "labeledCommand";
}

/** Whether a ribbon button shows its name in this look. */
export function ribbonLabelVisible(layout: ToolbarLayout, showLabel: boolean | undefined): boolean {
  if (layout.mode === "iconsOnly") return false;
  if (layout.orientation === "vertical") return true;
  return showLabel !== false;
}
