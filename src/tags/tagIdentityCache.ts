import type { FileIdentityKey } from "../services/fileIdentity";
import type { IdentityEffect, IdentityEvent, TagAssignment } from "../services/tags";

/** Keeps the tag rows on screen consistent with the receipts Step 09f emits
 * for completed copies, moves and renames (Step 11b U2).
 *
 * Only a guarded, complete receipt whose two identities are stable may
 * change a row. A path is not an object: a receipt is never applied to a
 * record that only has a path fallback key, and a receipt whose identities
 * are not both stable is ignored. An overflow asks for a rescan and changes
 * nothing, because guessing which moves were lost would re-attach tags to
 * files that never carried them. */

export interface IdentityCacheResult {
  assignments: TagAssignment[];
  /** The visible rows must be reloaded from the native store. */
  rescan: boolean;
}

function stableLookup(key: FileIdentityKey | undefined | null): string | null {
  if (!key || !key.stable) return null;
  if (!/^[0-9a-f]{8}$/.test(key.volume_id) || !/^[0-9a-f]{16}$/.test(key.file_id)) {
    return null;
  }
  return `i:${key.volume_id}:${key.file_id}`;
}

function cloneKey(key: FileIdentityKey): FileIdentityKey {
  return {
    volume_id: key.volume_id,
    file_id: key.file_id,
    path_key: key.path_key,
    stable: key.stable,
  };
}

function cloneAssignment(assignment: TagAssignment): TagAssignment {
  return {
    key: cloneKey(assignment.key),
    display_path: assignment.display_path,
    tag_ids: [...assignment.tag_ids],
    revision: assignment.revision,
  };
}

function isComplete(effect: IdentityEffect | undefined | null): effect is IdentityEffect {
  return Boolean(effect && effect.complete === true);
}

/** Apply one complete receipt to a mutable list. Returns true when a row
 * changed. */
function applyEffect(rows: TagAssignment[], effect: IdentityEffect): boolean {
  if (!isComplete(effect)) return false;
  const from = stableLookup(effect.from_key);
  const to = stableLookup(effect.to_key);
  if (!from || !to) return false;
  if (!effect.from_path || !effect.to_path) return false;

  const sourceIndex = rows.findIndex((row) => stableLookup(row.key) === from);
  if (sourceIndex < 0) return false;
  const destinationIndex = rows.findIndex((row) => stableLookup(row.key) === to);

  if (effect.kind === "copy") {
    if (destinationIndex >= 0) return false;
    const source = rows[sourceIndex];
    rows.push({
      key: cloneKey(effect.to_key),
      display_path: effect.to_path,
      tag_ids: [...source.tag_ids],
      revision: source.revision,
    });
    return true;
  }

  if (effect.kind === "move" || effect.kind === "rename") {
    // A hard link keeps one stable identity; the row follows the path of
    // the link that was renamed, and no second row appears.
    if (from === to) {
      if (destinationIndex >= 0 && destinationIndex !== sourceIndex) return false;
      const row = rows[sourceIndex];
      row.key = cloneKey(effect.to_key);
      row.display_path = effect.to_path;
      return true;
    }
    // A move onto a record that already has tags is never merged: the
    // native store leaves both records alone and so does the list.
    if (destinationIndex >= 0) return false;
    const row = rows[sourceIndex];
    row.key = cloneKey(effect.to_key);
    row.display_path = effect.to_path;
    return true;
  }

  return false;
}

/** Fold an 09f batch into the visible rows. Never mutates the input. */
export function applyIdentityEvents(
  assignments: readonly TagAssignment[],
  events: readonly IdentityEvent[],
): IdentityCacheResult {
  const rows = assignments.map(cloneAssignment);
  let rescan = false;
  for (const event of events) {
    if (event.kind === "overflow") {
      // Missing moves are reconciled from the native store, never inferred
      // from paths: an overflow leaves every visible row as it is.
      rescan = true;
      continue;
    }
    if (event.kind === "effect") {
      applyEffect(rows, event.effect);
    }
  }
  return { assignments: rows, rescan };
}

/** The tag ids one receipt would carry to a copy, without changing a row. */
export function tagsInheritedByCopy(
  assignments: readonly TagAssignment[],
  effect: IdentityEffect,
): string[] {
  if (!isComplete(effect) || effect.kind !== "copy") return [];
  const from = stableLookup(effect.from_key);
  if (!from) return [];
  const source = assignments.find((row) => stableLookup(row.key) === from);
  return source ? [...source.tag_ids] : [];
}
