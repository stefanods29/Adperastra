import type { ReactNode } from "react";

/** Ribbon framework (contract 16, Step 04b). A ribbon is data: tabs of
 * groups of controls, each control bound to a command id. The `Ribbon`
 * component draws it; layouts can place it on any side (Step 05c). */

export type RibbonControl =
  /** Runs a command. `showLabel` false shows only the icon. */
  | { type: "button"; command: string; showLabel?: boolean; keyTip?: string }
  /** Like a button, drawn pressed while the command's `checkedWhen` is true. */
  | { type: "toggle"; command: string; showLabel?: boolean; keyTip?: string }
  /** Anything else (a zoom box, an encoding list). */
  | { type: "custom"; id: string; render: () => ReactNode };

export interface RibbonGroup {
  id: string;
  /** Translation key of the group name (tooltip and screen readers). */
  labelKey: string;
  controls: RibbonControl[];
}

export interface RibbonTab {
  id: string;
  labelKey: string;
  /** Letter shown while Alt is held; Alt+letter selects the tab. */
  keyTip: string;
  groups: RibbonGroup[];
}

export interface RibbonDef {
  tabs: RibbonTab[];
}
