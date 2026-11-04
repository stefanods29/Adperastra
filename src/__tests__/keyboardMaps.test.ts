import { describe, expect, it } from "vitest";
import {
  CommandLayoutRegistry,
  entryExecutable,
  validateCommandLayoutEntry,
  validateToolbarCustomSettings,
  type ToolbarDescriptor,
} from "../services/commandLayout";
import {
  defaultKeyboardCustomSettings,
  saveKeyboardMap,
  validateKeyboardCustomSettings,
  validateKeyboardMap,
} from "../services/keyboardMaps";
import { deterministicBindingId, type KeyboardMap, type ShortcutBinding } from "../keyboard/types";

function binding(commandId: string, key: string, scope: ShortcutBinding["scope"] = "explorer"): ShortcutBinding {
  return {
    id: deterministicBindingId(`fixture:${commandId}:${scope}:${key}`),
    command_id: commandId,
    scope,
    strokes: [{ ctrl: false, alt: false, shift: false, meta: false, mode: "key", key }],
    enabled: true,
  };
}

function map(bindings: ShortcutBinding[]): KeyboardMap {
  return { id: "builtin:windows", name: "Windows", bindings, version: 1 };
}

describe("keyboard map validation (step-10b/T1)", () => {
  it("unknown_command_retained_disabled", () => {
    const validated = validateKeyboardMap(map([binding("future.command", "F9")]));
    expect(validated.bindings[0].command_id).toBe("future.command");
    const entry = { kind: "command" as const, id: "future.command", visible: true };
    expect(entryExecutable(entry, new Set(), new Set())).toBe(false);
    expect(entryExecutable(entry, new Set(["future.command"]), new Set())).toBe(true);
    const registry = new CommandLayoutRegistry();
    const descriptor: ToolbarDescriptor = {
      id: "explorer.command",
      default_entries: [entry],
      compatible_groups: [],
      mandatory_ids: [],
    };
    registry.register(descriptor);
    expect(registry.resolve("explorer.command", { classic_menu: false, bars: [], quick_access: [] })).toEqual([entry]);
  });

  it("custom_renderer_not_deserialized", () => {
    expect(
      validateCommandLayoutEntry({ kind: "custom", id: "zoom", visible: true, render: "evil" }),
    ).toBeNull();
    expect(
      validateCommandLayoutEntry({ kind: "command", id: "explorer.open", visible: true, args: "C:\\x" }),
    ).toBeNull();
    expect(validateCommandLayoutEntry({ kind: "custom", id: "zoom", visible: true })).toEqual({
      kind: "custom",
      id: "zoom",
      visible: true,
    });
    expect(() =>
      validateToolbarCustomSettings({
        classic_menu: false,
        bars: [{ bar_id: "b", entries: [{ kind: "custom", id: "z", visible: true, url: "https://x" }] }],
        quick_access: [],
      }),
    ).toThrow("toolbar.invalid");
  });

  it("twenty_first_map_refused", () => {
    const custom = map([]);
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      ...custom,
      id: deterministicBindingId(`map:${i}`),
      name: `Map ${i}`,
    }));
    expect(validateKeyboardCustomSettings({ active_map: "builtin:windows", custom_maps: twenty, allow_bare_navigation: false }).custom_maps).toHaveLength(20);
    expect(() =>
      validateKeyboardCustomSettings({
        active_map: "builtin:windows",
        custom_maps: [...twenty, { ...custom, id: deterministicBindingId("map:20"), name: "Map 20" }],
        allow_bare_navigation: false,
      }),
    ).toThrow("keyboard.limit");
  });

  it("schema28settingspreserved", () => {
    // A schema-28 settings file has no toolbar_custom / keyboard_custom yet:
    // both sections fall back to their defaults and nothing else is lost.
    expect(validateKeyboardCustomSettings(undefined)).toEqual(defaultKeyboardCustomSettings());
    expect(validateKeyboardCustomSettings({})).toEqual(defaultKeyboardCustomSettings());
    expect(
      validateToolbarCustomSettings({ classic_menu: false, bars: [], quick_access: ["explorer.undo"] }),
    ).toEqual({ classic_menu: false, bars: [], quick_access: ["explorer.undo"] });
  });

  it("refuses exact conflicts and over-limit maps before saving", async () => {
    const conflicting = map([binding("a.one", "g"), binding("a.two", "g")]);
    expect(() => validateKeyboardMap(conflicting)).toThrow("keyboard.conflict");
    await expect(saveKeyboardMap(conflicting)).rejects.toThrow("keyboard.conflict");
    const many = map(Array.from({ length: 501 }, (_, i) => binding(`a.${i}`, "F9")));
    expect(() => validateKeyboardMap(many)).toThrow("keyboard.limit");
  });
});
