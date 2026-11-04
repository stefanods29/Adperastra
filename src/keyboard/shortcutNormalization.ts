import { MAX_STROKE_KEY_CHARS, type ShortcutStroke, type StrokeMode } from "./types";

/** Turning key events and shortcut text into stored strokes (Step 10b D5).
 * Physical mode compares KeyboardEvent.code, logical mode compares the
 * normalized KeyboardEvent.key. AltGraph, composition and dead keys never
 * produce a stroke. */

const KEY_ALIASES: Readonly<Record<string, string>> = {
  " ": "Space",
  Spacebar: "Space",
  Esc: "Escape",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Del: "Delete",
};

/** The stored form of a key name: space and arrows use their long names,
 * single letters are lower case (Shift is a separate boolean). */
export function normalizeKeyName(raw: string): string {
  const aliased = KEY_ALIASES[raw] ?? raw;
  if (/^[a-zA-Z]$/.test(aliased)) return aliased.toLowerCase();
  return aliased;
}

/** A validated, normalized copy of a stroke, or null when it cannot be stored. */
export function normalizeStroke(value: unknown): ShortcutStroke | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.key !== "string") return null;
  const key = normalizeKeyName(input.key);
  if (key.length === 0 || key.length > MAX_STROKE_KEY_CHARS) return null;
  if (input.mode !== "key" && input.mode !== "code") return null;
  const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
  const ctrl = flag(input.ctrl);
  const alt = flag(input.alt);
  const shift = flag(input.shift);
  const meta = flag(input.meta);
  if (ctrl === null || alt === null || shift === null || meta === null) return null;
  return { ctrl, alt, shift, meta, mode: input.mode, key };
}

function isAltGraph(event: KeyboardEvent): boolean {
  const probe = event as KeyboardEvent & { getModifierState?: (key: string) => boolean };
  return typeof probe.getModifierState === "function" && probe.getModifierState("AltGraph");
}

/** The stroke an event represents in one mode, or null when the event must
 * never trigger a custom command (composition, dead key, AltGraph). */
export function strokeFromKeyboardEvent(event: KeyboardEvent, mode: StrokeMode): ShortcutStroke | null {
  if (event.isComposing) return null;
  if (event.key === "Dead" || event.key === "Process") return null;
  if (isAltGraph(event)) return null;
  const raw = mode === "code" ? event.code : event.key;
  if (!raw) return null;
  const key = mode === "code" ? raw : normalizeKeyName(raw);
  if (key.length === 0 || key.length > MAX_STROKE_KEY_CHARS) return null;
  return { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey, mode, key };
}

/** Both readings of an event; a binding compares only its own mode. The
 * physical reading is `null` for a synthetic event without `code`, which
 * only makes code-mode bindings unmatchable, never the logical ones. */
export function eventStrokes(event: KeyboardEvent): { key: ShortcutStroke; code: ShortcutStroke | null } | null {
  const key = strokeFromKeyboardEvent(event, "key");
  if (!key) return null;
  return { key, code: strokeFromKeyboardEvent(event, "code") };
}

export function eventStrokeFor(event: KeyboardEvent, mode: StrokeMode): ShortcutStroke | null {
  return strokeFromKeyboardEvent(event, mode);
}

export function strokesEqual(a: ShortcutStroke, b: ShortcutStroke): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta &&
    a.mode === b.mode &&
    a.key === b.key
  );
}

/** Does an event match a stored stroke (comparing only the stroke's mode)? */
export function eventMatchesStroke(
  strokes: { key: ShortcutStroke; code: ShortcutStroke | null },
  stroke: ShortcutStroke,
): boolean {
  const actual = stroke.mode === "code" ? strokes.code : strokes.key;
  return actual !== null && strokesEqual(actual, stroke);
}

export function strokeSequencesEqual(a: readonly ShortcutStroke[], b: readonly ShortcutStroke[]): boolean {
  return a.length === b.length && a.every((stroke, index) => strokesEqual(stroke, b[index]));
}

/** True when `short` is a strict opening of `long` (a prefix conflict, D7). */
export function isStrokePrefix(short: readonly ShortcutStroke[], long: readonly ShortcutStroke[]): boolean {
  return short.length < long.length && short.every((stroke, index) => strokesEqual(stroke, long[index]));
}

/** Parse shortcut text such as "Ctrl+Shift+N" or "Alt+Left" (the existing
 * Command.shortcut format) into one stored stroke. Null when unreadable. */
export function parseShortcutText(text: string): ShortcutStroke | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const parts = text.split("+");
  let key = parts.pop() ?? "";
  if (key === "" && text.endsWith("+")) key = "+";
  if (key === "") return null;
  return normalizeStroke({
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    meta: parts.includes("Meta"),
    mode: "key",
    key,
  });
}

/** Display text for one stroke, in the "Ctrl+Shift+N" shape the existing
 * formatShortcut() localizes. Code mode drops the Key/Digit prefix. */
export function strokeToText(stroke: ShortcutStroke): string {
  let key = stroke.key;
  if (stroke.mode === "code") {
    if (/^Key[A-Z]$/.test(key)) key = key.slice(3);
    else if (/^Digit[0-9]$/.test(key)) key = key.slice(5);
  }
  if (key === "Space") key = "Space";
  const parts: string[] = [];
  if (stroke.ctrl) parts.push("Ctrl");
  if (stroke.alt) parts.push("Alt");
  if (stroke.shift) parts.push("Shift");
  if (stroke.meta) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

/** Display text for a whole binding; two strokes join with a comma. */
export function bindingToText(strokes: readonly ShortcutStroke[]): string {
  return strokes.map(strokeToText).join(", ");
}
