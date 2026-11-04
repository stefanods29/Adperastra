import { invoke } from "@tauri-apps/api/core";
import { findShortcutConflicts } from "../keyboard/effectiveShortcuts";
import { normalizeStroke } from "../keyboard/shortcutNormalization";
import {
  MAX_BINDINGS_PER_MAP,
  MAX_COMMAND_ID_CHARS,
  MAX_CUSTOM_MAPS,
  MAX_MAP_NAME_CHARS,
  isBuiltinMapId,
  isShortcutScope,
  isUuid,
  type KeyboardCustomSettings,
  type KeyboardMap,
  type ShortcutBinding,
} from "../keyboard/types";
import { isTauriRuntime } from "./settings";

/** Validating and saving keyboard maps (Step 10b E4). Every map lives in
 * settings (schema 29); the native keyboard_map_save command validates
 * again through the ordinary settings save. Errors are the stable codes
 * keyboard.invalid / keyboard.conflict / keyboard.limit. */

function fail(code: "keyboard.invalid" | "keyboard.conflict" | "keyboard.limit"): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function validateBinding(value: unknown): ShortcutBinding {
  if (!isRecord(value)) fail("keyboard.invalid");
  if (!isUuid(value.id)) fail("keyboard.invalid");
  if (typeof value.command_id !== "string" || value.command_id.length === 0 || charCount(value.command_id) > MAX_COMMAND_ID_CHARS) {
    fail("keyboard.invalid");
  }
  if (!isShortcutScope(value.scope)) fail("keyboard.invalid");
  if (!Array.isArray(value.strokes) || (value.strokes.length !== 1 && value.strokes.length !== 2)) fail("keyboard.invalid");
  const strokes = value.strokes.map((stroke) => {
    const normalized = normalizeStroke(stroke);
    if (!normalized) fail("keyboard.invalid");
    return normalized;
  });
  if (typeof value.enabled !== "boolean") fail("keyboard.invalid");
  // Unknown command ids are accepted here: they stay as disabled,
  // never-executed entries (D1). Only the shape is validated.
  return { id: value.id, command_id: value.command_id, scope: value.scope, strokes, enabled: value.enabled };
}

/** A validated map, or a thrown stable error code. */
export function validateKeyboardMap(value: unknown): KeyboardMap {
  if (!isRecord(value)) fail("keyboard.invalid");
  if (!isBuiltinMapId(value.id) && !isUuid(value.id)) fail("keyboard.invalid");
  if (typeof value.name !== "string" || charCount(value.name) === 0 || charCount(value.name) > MAX_MAP_NAME_CHARS) {
    fail("keyboard.invalid");
  }
  if (value.version !== 1) fail("keyboard.invalid");
  if (!Array.isArray(value.bindings)) fail("keyboard.invalid");
  if (value.bindings.length > MAX_BINDINGS_PER_MAP) fail("keyboard.limit");
  const bindings = value.bindings.map(validateBinding);
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (seen.has(binding.id)) fail("keyboard.invalid");
    seen.add(binding.id);
  }
  const map: KeyboardMap = { id: value.id, name: value.name, bindings, version: 1 };
  for (const binding of bindings) {
    const others: KeyboardMap = { ...map, bindings: bindings.filter((entry) => entry.id !== binding.id) };
    if (findShortcutConflicts(binding, others).length > 0) fail("keyboard.conflict");
  }
  return map;
}

export function defaultKeyboardCustomSettings(): KeyboardCustomSettings {
  return { active_map: "builtin:windows", custom_maps: [], allow_bare_navigation: false };
}

/** The whole keyboard section, repaired field by field like the other
 * settings normalizers. A 21st custom map is refused, not trimmed. */
export function validateKeyboardCustomSettings(value: unknown): KeyboardCustomSettings {
  if (!isRecord(value)) return defaultKeyboardCustomSettings();
  if (Array.isArray(value.custom_maps) && value.custom_maps.length > MAX_CUSTOM_MAPS) fail("keyboard.limit");
  const customMaps = Array.isArray(value.custom_maps) ? value.custom_maps.map(validateKeyboardMap) : [];
  const active =
    typeof value.active_map === "string" &&
    (isBuiltinMapId(value.active_map) || customMaps.some((map) => map.id === value.active_map))
      ? value.active_map
      : "builtin:windows";
  return {
    active_map: active,
    custom_maps: customMaps,
    allow_bare_navigation: typeof value.allow_bare_navigation === "boolean" ? value.allow_bare_navigation : false,
  };
}

/** Save one map through the native command (main window only). Validation
 * happens before any invoke, so an invalid, conflicting or over-limit map
 * never reaches Rust. Custom maps and builtin preset activation both live
 * in settings (schema 29); there is no second JSON store. */
export async function saveKeyboardMap(map: KeyboardMap): Promise<KeyboardMap> {
  const validated = validateKeyboardMap(map);
  if (!isTauriRuntime()) throw new Error("keyboard.invalid");
  await invoke("keyboard_map_save", { map: validated });
  return validated;
}
