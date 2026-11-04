import { parseShortcutText } from "./shortcutNormalization";
import {
  deterministicBindingId,
  type BuiltinKeyboardMapId,
  type KeyboardMap,
  type ShortcutBinding,
  type ShortcutScope,
  type ShortcutStroke,
} from "./types";

/** Editable keyboard presets (Step 10b E6, D8-D9). Builtin maps are
 * immutable defaults; editing one makes a custom copy (the editor does
 * that). Binding ids are derived from fixed text so they never churn. */

export type KeyboardPresetId = "windows" | "finder" | "commander" | "vim";

export const KEYBOARD_PRESET_IDS: readonly KeyboardPresetId[] = ["windows", "finder", "commander", "vim"];

const PRESET_NAMES: Readonly<Record<KeyboardPresetId, string>> = {
  windows: "Windows",
  finder: "Finder",
  commander: "Commander",
  vim: "Vim",
};

function binding(idSeed: string, commandId: string, scope: ShortcutScope, strokes: ShortcutStroke[]): ShortcutBinding {
  return {
    id: deterministicBindingId(`${idSeed}:${commandId}:${scope}:${strokes.map((s) => `${s.mode}:${s.key}:${s.ctrl}${s.alt}${s.shift}${s.meta}`).join("/")}`),
    command_id: commandId,
    scope,
    strokes,
    enabled: true,
  };
}

function keyStroke(key: string, mods: Partial<Pick<ShortcutStroke, "ctrl" | "alt" | "shift" | "meta">> = {}): ShortcutStroke {
  return { ctrl: false, alt: false, shift: false, meta: false, mode: "key", key, ...mods };
}

function sameStrokes(a: readonly ShortcutStroke[], b: readonly ShortcutStroke[]): boolean {
  return a.length === b.length && a.every((s, i) => {
    const o = b[i];
    return s.ctrl === o.ctrl && s.alt === o.alt && s.shift === o.shift && s.meta === o.meta && s.mode === o.mode && s.key === o.key;
  });
}

const ENTER: ShortcutStroke[] = [keyStroke("Enter")];
const CTRL_O: ShortcutStroke[] = [keyStroke("o", { ctrl: true })];

/** Build a builtin map from the registered commands' default shortcuts.
 * `defaults` already carries each command's scope and strokes; every
 * existing shortcut is kept except the ones the preset names explicitly. */
export function keyboardPreset(id: KeyboardPresetId, defaults: readonly ShortcutBinding[]): KeyboardMap {
  const base: ShortcutBinding[] = defaults.map((entry) => ({
    ...entry,
    strokes: entry.strokes.map((stroke) => ({ ...stroke })),
  }));
  let bindings = base;
  const isExplorerBinding = (entry: ShortcutBinding, commandId: string) =>
    entry.scope === "explorer" && entry.command_id === commandId;

  if (id === "finder") {
    // Explorer Enter renames, Ctrl+O opens; editors keep their Enter (D8).
    bindings = base.filter((entry) => !(isExplorerBinding(entry, "explorer.open") && sameStrokes(entry.strokes, ENTER)));
    if (!bindings.some((entry) => isExplorerBinding(entry, "explorer.rename") && sameStrokes(entry.strokes, ENTER))) {
      bindings = [...bindings, binding("finder", "explorer.rename", "explorer", ENTER.map((s) => ({ ...s })))];
    }
    if (!bindings.some((entry) => isExplorerBinding(entry, "explorer.open") && sameStrokes(entry.strokes, CTRL_O))) {
      bindings = [...bindings, binding("finder", "explorer.open", "explorer", CTRL_O.map((s) => ({ ...s })))];
    }
  }
  if (id === "commander") {
    // F5/F6 ask a destination, F7 makes a folder, F8 recycles (never a
    // permanent delete). Only the bare Explorer F5-F8 shortcuts are
    // replaced; modified variants of those keys stay untouched.
    const isBareExplorerFunctionKey = (entry: ShortcutBinding) => {
      if (entry.scope !== "explorer" || entry.strokes.length !== 1) return false;
      const stroke = entry.strokes[0];
      if (stroke.ctrl || stroke.alt || stroke.shift || stroke.meta) return false;
      return ["F5", "F6", "F7", "F8"].includes(stroke.key);
    };
    bindings = base.filter((entry) => !isBareExplorerFunctionKey(entry));
    const commanderBindings = [
      binding("commander", "explorer.copyToFolder", "explorer", [keyStroke("F5")]),
      binding("commander", "explorer.moveToFolder", "explorer", [keyStroke("F6")]),
      binding("commander", "explorer.newFolder", "explorer", [keyStroke("F7")]),
      binding("commander", "explorer.delete", "explorer", [keyStroke("F8")]),
    ];
    for (const entry of commanderBindings) bindings = [...bindings, entry];
  }
  if (id === "vim") {
    // Only while the Explorer item surface is focused (the host reports
    // the explorer scope only then); Windows modified shortcuts stay (D8).
    const vimBindings = [
      binding("vim", "explorer.navigateLeft", "explorer", [keyStroke("h")]),
      binding("vim", "explorer.navigateDown", "explorer", [keyStroke("j")]),
      binding("vim", "explorer.navigateUp", "explorer", [keyStroke("k")]),
      binding("vim", "explorer.navigateRight", "explorer", [keyStroke("l")]),
      binding("vim", "explorer.navigateFirst", "explorer", [keyStroke("g"), keyStroke("g")]),
      binding("vim", "explorer.navigateLast", "explorer", [keyStroke("g", { shift: true })]),
      binding("vim", "explorer.focusFilter", "explorer", [keyStroke("/")]),
    ];
    for (const entry of vimBindings) {
      const exists = bindings.some(
        (existing) =>
          existing.scope === entry.scope &&
          existing.command_id === entry.command_id &&
          sameStrokes(existing.strokes, entry.strokes),
      );
      if (!exists) bindings = [...bindings, entry];
    }
  }
  const mapId: BuiltinKeyboardMapId = `builtin:${id}`;
  return { id: mapId, name: PRESET_NAMES[id], bindings, version: 1 };
}

/** Default bindings from the actual command registry: each registered
 * Command.shortcut becomes one key-mode stroke. Pending commands are not
 * supported yet, so they never enter a preset; commands without a shortcut
 * or with unreadable text get no binding. The Command.shortcut values are
 * preserved, never rewritten. */
export function defaultShortcutBindings(
  commands: readonly { id: string; shortcut?: string; pending?: boolean }[],
  scopeFor: (commandId: string) => ShortcutScope,
): ShortcutBinding[] {
  const bindings = new Map<string, ShortcutBinding>();
  for (const command of commands) {
    if (!command.shortcut || command.pending === true) continue;
    const stroke = parseShortcutText(command.shortcut);
    if (!stroke) continue;
    const scope = scopeFor(command.id);
    const key = `${scope}:${command.id}`;
    if (bindings.has(key)) continue;
    bindings.set(key, binding("default", command.id, scope, [stroke]));
  }
  return [...bindings.values()];
}
