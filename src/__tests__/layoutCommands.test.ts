import { describe, expect, it, vi } from "vitest";
import { createLayoutCommands, type LayoutCommandContext } from "../commands/layoutCommands";
import { TOOLBAR_MENU, resolveMenu, type MenuEntry } from "../commands/menus";
import type { Command } from "../commands/registry";
import { BUILT_IN_PRESETS, applyLayoutValues, layoutValues } from "../layout/presets";
import { defaultSettings, type LayoutSettings } from "../services/settings";

const defaults = () => defaultSettings().layout;
const layoutWith = (patch: Partial<LayoutSettings>): LayoutSettings => ({ ...defaults(), ...patch });

function setup(layout: LayoutSettings = defaults()) {
  const setLayout = vi.fn();
  const commands = createLayoutCommands({ setLayout });
  const byId: Record<string, Command<LayoutCommandContext>> = Object.fromEntries(
    commands.map((command) => [command.id, command]),
  );
  const context: LayoutCommandContext = { layout };
  const lookup = (id: string) => byId[id];
  return { setLayout, commands, byId, context, lookup };
}

describe("layout commands", () => {
  it("toolbar positions and styles are radio commands", () => {
    const { setLayout, commands, byId, context } = setup(layoutWith({ toolbar_position: "left" }));
    expect(commands).toHaveLength(11);
    for (const command of commands) expect(command.checkKind).toBe("radio");
    expect(byId["layout.toolbarLeft"].checkedWhen?.(context)).toBe(true);
    expect(byId["layout.toolbarTop"].checkedWhen?.(context)).toBe(false);
    byId["layout.toolbarRight"].run(context);
    expect(setLayout).toHaveBeenLastCalledWith({ ...context.layout, toolbar_position: "right" });
    byId["layout.toolbarAutoHide"].run(context);
    expect(setLayout).toHaveBeenLastCalledWith({ ...context.layout, toolbar_mode: "autoHide" });
  });

  it("presets apply their values and show as checked", () => {
    const saved = { name: "Work", ...layoutValues(defaults()) };
    const layout = { ...applyLayoutValues(defaults(), BUILT_IN_PRESETS.minimal), saved_presets: [saved] };
    const { setLayout, byId, context } = setup(layout);
    expect(byId["layout.presetMinimal"].checkedWhen?.(context)).toBe(true);
    expect(byId["layout.presetStandard"].checkedWhen?.(context)).toBe(false);
    byId["layout.presetClassic"].run(context);
    expect(setLayout).toHaveBeenCalledWith({
      ...applyLayoutValues(layout, BUILT_IN_PRESETS.classic),
      saved_presets: [saved],
    });
  });

  it("every layout command has a help page", () => {
    const pages = new Set(
      Object.keys(import.meta.glob("../../help/*/*.md")).map((path) => path.replace("../../help/", "")),
    );
    for (const command of createLayoutCommands({ setLayout: vi.fn() })) {
      for (const lang of ["en", "es"]) {
        expect(pages.has(`${lang}/${command.helpSlug}.md`), `${lang}/${command.helpSlug}`).toBe(true);
      }
    }
  });

  it("the toolbar menu has three groups", () => {
    const { context, lookup } = setup();
    const resolved = resolveMenu(TOOLBAR_MENU, context, lookup);
    expect(resolved).toHaveLength(4);
    const submenuEntries = (entry: MenuEntry | undefined) =>
      entry !== undefined && entry.type === "submenu" ? entry.entries : null;
    expect(submenuEntries(resolved[0])).toHaveLength(4);
    expect(submenuEntries(resolved[1])).toHaveLength(4);
    expect(resolved[2]).toEqual({ type: "separator" });
    expect(submenuEntries(resolved[3])).toHaveLength(3);
  });
});
