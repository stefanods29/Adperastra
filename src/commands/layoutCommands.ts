/** Toolbar position, style and layout presets as commands (Step 05c). */
import {
  EyeOff,
  LayoutGrid,
  LayoutTemplate,
  Minimize,
  Minimize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelsTopLeft,
  Rows2,
  type LucideIcon,
} from "lucide-react";
import { BUILT_IN_PRESETS, applyLayoutValues, sameLayout } from "../layout/presets";
import type { LayoutSettings, ToolbarMode, ToolbarPosition } from "../services/settings";
import type { Command } from "./registry";

/** What the layout commands read: the window's current layout. */
export interface LayoutCommandContext {
  layout: LayoutSettings;
}

/** What the layout commands do: save a whole layout. */
export interface LayoutActions {
  setLayout: (layout: LayoutSettings) => void;
}

const TOOLBAR_HELP = "moving-toolbars-and-panels";
const PRESET_HELP = "layout-presets";

/** The eleven toolbar and preset commands, in menu order. */
export function createLayoutCommands(actions: LayoutActions): Command<LayoutCommandContext>[] {
  const radio = (
    id: string,
    labelKey: string,
    icon: LucideIcon,
    helpSlug: string,
    checked: (ctx: LayoutCommandContext) => boolean,
    apply: (layout: LayoutSettings) => LayoutSettings,
  ): Command<LayoutCommandContext> => ({
    id,
    labelKey,
    icon,
    risk: "read-only",
    helpSlug,
    checkKind: "radio",
    enabledWhen: () => true,
    checkedWhen: checked,
    run: (ctx) => actions.setLayout(apply(ctx.layout)),
  });

  const withPosition =
    (position: ToolbarPosition) =>
    (layout: LayoutSettings): LayoutSettings => ({ ...layout, toolbar_position: position });
  const withMode =
    (mode: ToolbarMode) =>
    (layout: LayoutSettings): LayoutSettings => ({ ...layout, toolbar_mode: mode });
  const withPreset =
    (id: "standard" | "minimal" | "classic") =>
    (layout: LayoutSettings): LayoutSettings => applyLayoutValues(layout, BUILT_IN_PRESETS[id]);

  return [
    radio(
      "layout.toolbarTop",
      "commands.toolbarTop",
      PanelTop,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_position === "top",
      withPosition("top"),
    ),
    radio(
      "layout.toolbarBottom",
      "commands.toolbarBottom",
      PanelBottom,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_position === "bottom",
      withPosition("bottom"),
    ),
    radio(
      "layout.toolbarLeft",
      "commands.toolbarLeft",
      PanelLeft,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_position === "left",
      withPosition("left"),
    ),
    radio(
      "layout.toolbarRight",
      "commands.toolbarRight",
      PanelRight,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_position === "right",
      withPosition("right"),
    ),
    radio(
      "layout.toolbarFull",
      "commands.toolbarFull",
      Rows2,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_mode === "full",
      withMode("full"),
    ),
    radio(
      "layout.toolbarCompact",
      "commands.toolbarCompact",
      Minimize2,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_mode === "compact",
      withMode("compact"),
    ),
    radio(
      "layout.toolbarIconsOnly",
      "commands.toolbarIconsOnly",
      LayoutGrid,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_mode === "iconsOnly",
      withMode("iconsOnly"),
    ),
    radio(
      "layout.toolbarAutoHide",
      "commands.toolbarAutoHide",
      EyeOff,
      TOOLBAR_HELP,
      (ctx) => ctx.layout.toolbar_mode === "autoHide",
      withMode("autoHide"),
    ),
    radio(
      "layout.presetStandard",
      "commands.presetStandard",
      LayoutTemplate,
      PRESET_HELP,
      (ctx) => sameLayout(ctx.layout, BUILT_IN_PRESETS.standard),
      withPreset("standard"),
    ),
    radio(
      "layout.presetMinimal",
      "commands.presetMinimal",
      Minimize,
      PRESET_HELP,
      (ctx) => sameLayout(ctx.layout, BUILT_IN_PRESETS.minimal),
      withPreset("minimal"),
    ),
    radio(
      "layout.presetClassic",
      "commands.presetClassic",
      PanelsTopLeft,
      PRESET_HELP,
      (ctx) => sameLayout(ctx.layout, BUILT_IN_PRESETS.classic),
      withPreset("classic"),
    ),
  ];
}
