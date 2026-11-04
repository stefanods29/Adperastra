/** Theme commands and their static palette provider (Step 10a).
 *
 * Commands are plain registry entries. The palette provider returns inert
 * data and dispatches only through this factory's actions; no executable
 * callback is ever persisted in settings.
 */
import { Palette, SunMoon } from "lucide-react";
import type { PaletteEntry, PaletteHost } from "../palette/types";
import type { Command, CommandContext } from "./registry";

export interface ThemeActions {
  editTheme: () => void;
  toggleDayNight: () => void;
}

export const THEME_COMMAND_IDS = {
  editTheme: "appearance.editTheme",
  toggleDayNight: "appearance.toggleDayNight",
} as const;

export function createThemeCommands(actions: ThemeActions): Command<CommandContext>[] {
  return [
    {
      id: THEME_COMMAND_IDS.editTheme,
      labelKey: "themeEditor.title",
      icon: Palette,
      risk: "change",
      helpSlug: "theme-editor",
      enabledWhen: () => true,
      run: () => actions.editTheme(),
    },
    {
      id: THEME_COMMAND_IDS.toggleDayNight,
      labelKey: "themeSchedule.override",
      icon: SunMoon,
      risk: "change",
      helpSlug: "day-and-night-themes",
      enabledWhen: () => true,
      run: () => actions.toggleDayNight(),
    },
  ];
}

/** The same two actions as static palette entries. */
export function themePaletteEntries(): PaletteEntry[] {
  return [
    {
      id: `command:${THEME_COMMAND_IDS.editTheme}`,
      kind: "command",
      label_key: "themeEditor.title",
      english_label: "Theme editor",
      keywords: ["theme", "colours", "colors", "appearance", "custom"],
      enabled: true,
      target_id: THEME_COMMAND_IDS.editTheme,
    },
    {
      id: `command:${THEME_COMMAND_IDS.toggleDayNight}`,
      kind: "command",
      label_key: "themeSchedule.override",
      english_label: "Override until the next switch",
      keywords: ["day", "night", "dark", "light", "schedule", "override"],
      enabled: true,
      target_id: THEME_COMMAND_IDS.toggleDayNight,
    },
  ];
}

export interface ThemePaletteProvider {
  snapshot: () => Promise<readonly PaletteEntry[]>;
  dispatch: (entry: PaletteEntry, host: PaletteHost) => Promise<void>;
}

/** Registered statically by the coordinator; `host` is unused because the
 * two theme actions are local UI actions, not file or tab dispatches. */
export function createThemePaletteProvider(actions: ThemeActions): ThemePaletteProvider {
  return {
    snapshot: async () => themePaletteEntries(),
    dispatch: async (entry) => {
      if (entry.target_id === THEME_COMMAND_IDS.editTheme) actions.editTheme();
      else if (entry.target_id === THEME_COMMAND_IDS.toggleDayNight) actions.toggleDayNight();
    },
  };
}
