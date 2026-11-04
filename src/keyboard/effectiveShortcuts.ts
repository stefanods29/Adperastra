import {
  isStrokePrefix,
  strokeSequencesEqual,
} from "./shortcutNormalization";
import type {
  KeyboardMap,
  ShortcutBinding,
  ShortcutConflict,
  ShortcutScope,
  ShortcutStroke,
} from "./types";

/** Effective bindings and conflict rules (Step 10b E2, D6-D7). Tooltips,
 * menus, ribbons and the palette all read the binding through here. */

/** Two scopes can be active at once when they are equal or either is global. */
export function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  return a === b || a === "global" || b === "global";
}

/** Ctrl+Z/Y/C/X/V/A keep their text-editing meaning (D7). Shift is part
 * of the chord (redo is Ctrl+Shift+Z), so it does not make the key free. */
export function isTextEditingStroke(stroke: ShortcutStroke): boolean {
  if (!stroke.ctrl || stroke.alt || stroke.meta) return false;
  if (stroke.mode === "key") return ["z", "y", "c", "x", "v", "a"].includes(stroke.key);
  return ["KeyZ", "KeyY", "KeyC", "KeyX", "KeyV", "KeyA"].includes(stroke.key);
}

/** Windows-reserved and protected typing chords (D7). Meta is the Windows
 * key: Win+anything is refused. Ctrl+Z/Y/C/X/V/A stay with text editing, so
 * they cannot be taken by a global binding. */
export function isReservedStroke(stroke: ShortcutStroke, scope: ShortcutScope): boolean {
  if (stroke.meta) return true;
  if (stroke.alt && stroke.key === "Tab") return true;
  if (stroke.alt && stroke.key === "F4") return true;
  if (stroke.ctrl && stroke.alt && stroke.key === "Delete") return true;
  if (scope === "global" && isTextEditingStroke(stroke)) return true;
  return false;
}

/** The binding a scope would run for a command: the scope's own binding
 * first, then the global one. Disabled bindings are not effective. */
export function effectiveShortcut(
  commandId: string,
  scope: ShortcutScope,
  map: KeyboardMap,
): ShortcutBinding | null {
  const own = map.bindings.find(
    (binding) => binding.enabled && binding.command_id === commandId && binding.scope === scope,
  );
  if (own) return own;
  if (scope === "global") return null;
  return (
    map.bindings.find(
      (binding) => binding.enabled && binding.command_id === commandId && binding.scope === "global",
    ) ?? null
  );
}

/** Every conflict a candidate binding would create in a map (D7): the same
 * sequence in an overlapping scope, a one-stroke/two-stroke prefix clash,
 * or a reserved chord. The candidate itself (same id) is skipped; disabled
 * bindings create no exact or prefix conflict but still cannot take a
 * reserved chord (the native mirror rejects that too). */
export function findShortcutConflicts(
  candidate: ShortcutBinding,
  map: KeyboardMap,
): readonly ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];
  if (candidate.strokes.some((stroke) => isReservedStroke(stroke, candidate.scope))) {
    conflicts.push({
      existing_binding_id: candidate.id,
      command_id: candidate.command_id,
      kind: "reserved",
      scope: candidate.scope,
    });
  }
  // A disabled binding still cannot take a reserved chord (the native
  // mirror rejects it too), but it creates no exact or prefix conflict.
  if (!candidate.enabled) return conflicts;
  for (const existing of map.bindings) {
    if (!existing.enabled || existing.id === candidate.id) continue;
    if (!scopesOverlap(existing.scope, candidate.scope)) continue;
    if (strokeSequencesEqual(existing.strokes, candidate.strokes)) {
      conflicts.push({
        existing_binding_id: existing.id,
        command_id: existing.command_id,
        kind: "exact",
        scope: existing.scope,
      });
    } else if (
      isStrokePrefix(existing.strokes, candidate.strokes) ||
      isStrokePrefix(candidate.strokes, existing.strokes)
    ) {
      conflicts.push({
        existing_binding_id: existing.id,
        command_id: existing.command_id,
        kind: "prefix",
        scope: existing.scope,
      });
    }
  }
  return conflicts;
}
