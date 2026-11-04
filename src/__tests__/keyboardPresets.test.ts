import { describe, expect, it } from "vitest";
import { findShortcutConflicts } from "../keyboard/effectiveShortcuts";
import { defaultShortcutBindings, keyboardPreset } from "../keyboard/presets";
import { normalizeStroke, strokeFromKeyboardEvent } from "../keyboard/shortcutNormalization";
import { validateKeyboardMap } from "../services/keyboardMaps";
import {
  deterministicBindingId,
  type ShortcutBinding,
  type ShortcutScope,
} from "../keyboard/types";

function binding(commandId: string, scope: ShortcutScope, key: string, ctrl = false): ShortcutBinding {
  return {
    id: deterministicBindingId(`preset:${commandId}:${scope}:${key}:${ctrl}`),
    command_id: commandId,
    scope,
    strokes: [{ ctrl, alt: false, shift: false, meta: false, mode: "key", key }],
    enabled: true,
  };
}

const defaults: ShortcutBinding[] = [
  binding("explorer.open", "explorer", "Enter"),
  binding("text.save", "text", "Enter"),
  binding("explorer.refresh", "explorer", "F5"),
  binding("explorer.rename", "explorer", "F2"),
];

const find = (bindings: readonly ShortcutBinding[], commandId: string, scope: ShortcutScope, key: string) =>
  bindings.find((b) => b.command_id === commandId && b.scope === scope && b.strokes[0]?.key === key);

describe("keyboard presets (step-10b/T4)", () => {
  it("FinderExplorerEnterrename/textEnterkept", () => {
    const map = keyboardPreset("finder", defaults);
    expect(find(map.bindings, "explorer.rename", "explorer", "Enter")).toBeDefined();
    expect(find(map.bindings, "explorer.open", "explorer", "Enter")).toBeUndefined();
    expect(find(map.bindings, "explorer.open", "explorer", "o")).toBeDefined();
    expect(find(map.bindings, "text.save", "text", "Enter")).toBeDefined();
    expect(validateKeyboardMap(map).id).toBe("builtin:finder");
  });

  it("FinderEnforcesRenameAndOpenWithoutDefaults", () => {
    const map = keyboardPreset("finder", []);
    expect(find(map.bindings, "explorer.rename", "explorer", "Enter")).toBeDefined();
    expect(find(map.bindings, "explorer.open", "explorer", "o")).toBeDefined();
  });

  it("CommanderF8recycleonly", () => {
    const map = keyboardPreset("commander", defaults);
    expect(find(map.bindings, "explorer.copyToFolder", "explorer", "F5")).toBeDefined();
    expect(find(map.bindings, "explorer.moveToFolder", "explorer", "F6")).toBeDefined();
    expect(find(map.bindings, "explorer.newFolder", "explorer", "F7")).toBeDefined();
    const f8 = find(map.bindings, "explorer.delete", "explorer", "F8");
    expect(f8).toBeDefined();
    expect(map.bindings.some((b) => b.command_id === "explorer.deletePermanently")).toBe(false);
    expect(find(map.bindings, "explorer.refresh", "explorer", "F5")).toBeUndefined();
  });

  it("CommanderKeepsModifiedFunctionKeys", () => {
    const withModified = [...defaults, binding("explorer.toggleDetailsPane", "explorer", "F5", true)];
    const map = keyboardPreset("commander", withModified);
    expect(find(map.bindings, "explorer.toggleDetailsPane", "explorer", "F5")).toBeDefined();
  });

  it("pendingCommandsStayOutOfPresets", () => {
    const mapped = defaultShortcutBindings(
      [
        { id: "explorer.copy", shortcut: "Ctrl+C" },
        { id: "future.command", shortcut: "Ctrl+9", pending: true },
        { id: "explorer.paste", shortcut: "Ctrl+V" },
      ],
      () => "explorer",
    );
    expect(mapped.map((entry) => entry.command_id)).toEqual(["explorer.copy", "explorer.paste"]);
    expect(mapped[0].strokes[0].key).toBe("c");
    expect(mapped[0].strokes[0].ctrl).toBe(true);
  });

  it("Vimggfirst", () => {
    const map = keyboardPreset("vim", defaults);
    const gg = map.bindings.find((b) => b.command_id === "explorer.navigateFirst");
    expect(gg?.scope).toBe("explorer");
    expect(gg?.strokes.map((s) => s.key)).toEqual(["g", "g"]);
    expect(find(map.bindings, "explorer.rename", "explorer", "F2")).toBeDefined();
    expect(find(map.bindings, "explorer.navigateLast", "explorer", "g")?.strokes[0].shift).toBe(true);
    expect(validateKeyboardMap(map).bindings.length).toBeGreaterThan(defaults.length);
  });

  it("prefixconflictrefused", () => {
    const map = keyboardPreset("vim", defaults);
    const candidate = binding("explorer.other", "explorer", "g");
    const conflicts = findShortcutConflicts(candidate, map);
    expect(conflicts.some((c) => c.kind === "prefix")).toBe(true);
    expect(() => validateKeyboardMap({ ...map, bindings: [...map.bindings, candidate] })).toThrow("keyboard.conflict");
  });

  it("OSreservedreject", () => {
    const candidate: ShortcutBinding = {
      id: deterministicBindingId("reserved:alt-tab"),
      command_id: "app.switch",
      scope: "global",
      strokes: [{ ctrl: false, alt: true, shift: false, meta: false, mode: "key", key: "Tab" }],
      enabled: true,
    };
    expect(findShortcutConflicts(candidate, keyboardPreset("windows", defaults))[0]?.kind).toBe("reserved");
    expect(() =>
      validateKeyboardMap({ id: "builtin:windows", name: "Windows", version: 1, bindings: [candidate] }),
    ).toThrow("keyboard.conflict");
  });

  it("nonUSphysicalcodekept", () => {
    const physical: ShortcutBinding = {
      id: deterministicBindingId("physical:keyg"),
      command_id: "explorer.navigateDown",
      scope: "explorer",
      strokes: [{ ctrl: false, alt: false, shift: false, meta: false, mode: "code", key: "KeyG" }],
      enabled: true,
    };
    const validated = validateKeyboardMap({ id: "builtin:vim", name: "Vim", version: 1, bindings: [physical] });
    expect(validated.bindings[0].strokes[0]).toEqual({ ctrl: false, alt: false, shift: false, meta: false, mode: "code", key: "KeyG" });
    expect(normalizeStroke({ ctrl: false, alt: false, shift: false, meta: false, mode: "code", key: "KeyG" })?.key).toBe("KeyG");
    const event = new KeyboardEvent("keydown", { key: "g", code: "KeyG" });
    expect(strokeFromKeyboardEvent(event, "code")?.key).toBe("KeyG");
  });
});
