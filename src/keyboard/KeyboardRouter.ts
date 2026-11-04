import { isCommandEnabled } from "../commands/registry";
import { isTextEditingStroke } from "./effectiveShortcuts";
import { eventMatchesStroke, eventStrokes } from "./shortcutNormalization";
import {
  COPY_TO_FOLDER_COMMAND,
  FOCUS_FILTER_COMMAND,
  MOVE_TO_FOLDER_COMMAND,
  NAVIGATION_DIRECTIONS,
  type KeyboardHost,
  type KeyboardMap,
  type ShortcutBinding,
  type ShortcutScope,
} from "./types";

/** One scoped shortcut router (Step 10b E3, D5-D6). The coordinator owns
 * the single window keydown listener and calls handle(); it calls
 * preventDefault() only when handle() returns true. */

export const SEQUENCE_TIMEOUT_MS = 500;

/** While typing, a printable bare key and the standard editing chords stay
 * with the field (D6). The focused editor's text scope is explicit and wins;
 * dialog bindings supersede everything; search and global keep their
 * modified chords (Ctrl+Tab, Ctrl+K, Ctrl+1..9) but no bare letters. */
function typingAllows(binding: ShortcutBinding, scope: ShortcutScope): boolean {
  if (scope === "text" || scope === "dialog") return true;
  if (scope !== "search" && scope !== "global") return false;
  const first = binding.strokes[0];
  if (!first.ctrl && !first.alt && !first.meta) return false;
  return !isTextEditingStroke(first);
}

/** Bindings follow the host's scope order (most specific first); bindings
 * outside the active scopes never match. */
function candidatesFor(map: KeyboardMap, scopes: readonly ShortcutScope[], typing: boolean): ShortcutBinding[] {
  const ordered: ShortcutBinding[] = [];
  for (const scope of scopes) {
    for (const binding of map.bindings) {
      if (binding.enabled && binding.scope === scope && (!typing || typingAllows(binding, scope))) {
        ordered.push(binding);
      }
    }
  }
  return ordered;
}

export class KeyboardRouter {
  private host: KeyboardHost;
  private map: KeyboardMap | null = null;
  private pending: { bindings: ShortcutBinding[]; timer: ReturnType<typeof setTimeout> } | null = null;
  private disposed = false;

  constructor(host: KeyboardHost) {
    this.host = host;
  }

  setMap(map: KeyboardMap): void {
    this.clearPending();
    this.map = map;
  }

  dispose(): void {
    this.disposed = true;
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /** True when this event was consumed (the caller then preventDefaults). */
  handle(event: KeyboardEvent): boolean {
    if (this.disposed || !this.map) return false;
    if (event.defaultPrevented) return false;
    const strokes = eventStrokes(event);
    if (!strokes) return false;

    // Escape cancels a pending two-stroke sequence (D5).
    if (strokes.key.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (this.pending) {
        this.clearPending();
        return true;
      }
      return false;
    }

    if (this.pending) {
      // A repeated stroke (holding the first key down) never advances or
      // triggers a sequence (D5); the pending sequence times out instead.
      if (event.repeat) return false;
      const pending = this.pending.bindings;
      this.clearPending();
      const match = pending.find((binding) => eventMatchesStroke(strokes, binding.strokes[1]));
      if (match) return this.execute(match);
      // Fall through and read the key as a fresh first stroke.
    }

    const typing = this.host.isTypingTarget(event.target);
    const candidates = candidatesFor(this.map, this.host.activeScopes(), typing);

    const complete = candidates.find(
      (binding) => binding.strokes.length === 1 && eventMatchesStroke(strokes, binding.strokes[0]),
    );
    if (complete) return this.execute(complete);

    const starters = candidates.filter(
      (binding) => binding.strokes.length === 2 && eventMatchesStroke(strokes, binding.strokes[0]),
    );
    if (starters.length > 0) {
      // A repeated first stroke never starts or triggers a sequence (D5).
      if (event.repeat) return false;
      const timer = setTimeout(() => {
        this.pending = null;
      }, SEQUENCE_TIMEOUT_MS);
      this.pending = { bindings: starters, timer };
      return true;
    }
    return false;
  }

  /** Run one matched binding through the host. An unknown command id owns
   * its chord but is never executed (D1); a disabled command shows its
   * reason and does not fall through to a global action (D6). */
  private execute(binding: ShortcutBinding): boolean {
    const id = binding.command_id;
    const direction = NAVIGATION_DIRECTIONS[id];
    const hostRouted =
      direction !== undefined || id === FOCUS_FILTER_COMMAND || id === COPY_TO_FOLDER_COMMAND || id === MOVE_TO_FOLDER_COMMAND;
    const command = this.host.command(id);
    if (!command && !hostRouted) return true;
    let enabled = true;
    if (this.host.isEnabled) {
      enabled = this.host.isEnabled(id);
    } else if (command) {
      try {
        // The command may need its live context; the host rechecks it at
        // dispatch (contract U1), so a failed probe falls through to it.
        enabled = isCommandEnabled(command, undefined);
      } catch {
        enabled = true;
      }
    }
    if (!enabled) {
      this.host.showDisabled(id);
      return true;
    }
    if (direction) {
      this.host.navigate(direction);
      return true;
    }
    if (id === FOCUS_FILTER_COMMAND) {
      this.host.focusFilter();
      return true;
    }
    if (id === COPY_TO_FOLDER_COMMAND) {
      void this.host.copyToFolder();
      return true;
    }
    if (id === MOVE_TO_FOLDER_COMMAND) {
      void this.host.moveToFolder();
      return true;
    }
    if (!command) return true;
    this.host.dispatch(id);
    return true;
  }
}
