import { useEffect, useRef } from "react";
import { isCommandEnabled, type Command } from "../commands/registry";

/** Does a key press match a shortcut text like "Ctrl+Shift+N", "F3",
 * "Ctrl+=" or "Shift+Enter"? Ctrl also matches the Mac Command key. "="
 * also matches "+" so Ctrl+= works with and without Shift and on the
 * number pad. Letters ignore case. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  let key = parts.pop() ?? "";
  if (key === "" && shortcut.endsWith("+")) key = "+";
  const wantCtrl = parts.includes("Ctrl");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl !== wantCtrl || event.altKey !== wantAlt) return false;
  const pressed = event.key;
  if (key === "=") return pressed === "=" || pressed === "+";
  if (event.shiftKey !== wantShift) return false;
  if (key === "Space") return pressed === " ";
  return pressed.toLowerCase() === key.toLowerCase();
}

/** Run commands from their `shortcut` while `active` is true. Keys without
 * Ctrl or Alt are ignored while typing in a text field or an editable area,
 * so typing is never taken over. A key a focused control already handled is
 * never acted on twice. */
export function useCommandShortcuts<C>(commands: readonly Command<C>[], ctx: C, active: boolean): void {
  const live = useRef({ commands, ctx });
  live.current = { commands, ctx };
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      for (const command of live.current.commands) {
        if (!command.shortcut || !matchesShortcut(event, command.shortcut)) continue;
        const withModifier = event.ctrlKey || event.metaKey || event.altKey;
        // The command palette is the one shortcut that also works while
        // typing, and it consumes the key only when it can actually run.
        const isPalette = command.id === "app.commandPalette";
        if (!isPalette && typing && (!withModifier || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA")) return;
        if (isPalette && !isCommandEnabled(command, live.current.ctx)) return;
        event.preventDefault();
        if (isCommandEnabled(command, live.current.ctx)) command.run(live.current.ctx);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
