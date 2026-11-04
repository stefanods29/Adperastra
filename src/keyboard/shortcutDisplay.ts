import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { effectiveShortcut } from "./effectiveShortcuts";
import { bindingToText } from "./shortcutNormalization";
import type { KeyboardMap, ShortcutScope } from "./types";

/** What the display surfaces need to show the shortcut the active map
 * actually runs (Step 10b D9/P6): command labels, tooltips, menus, ribbons
 * and the palette all resolve through here instead of reading
 * Command.shortcut directly. The coordinator owns the value: the map the
 * keyboard router runs and each command's canonical scope. */
export interface ShortcutResolutionHost {
  /** The active map, or null while no map is loaded: the command's
   * documented Command.shortcut stays visible. */
  readonly map: KeyboardMap | null;
  /** The scope a command's default shortcut belongs to (the same scope the
   * router map used when it built the binding). */
  readonly scopeFor: (commandId: string) => ShortcutScope;
}

export const ShortcutResolutionContext = createContext<ShortcutResolutionHost | null>(null);

export interface ShortcutResolutionProviderProps {
  map: KeyboardMap | null;
  scopeFor: (commandId: string) => ShortcutScope;
  children: ReactNode;
}

/** Wraps the window once with the map the router runs; every bar, menu,
 * ribbon and palette row below it then shows the effective binding. */
export function ShortcutResolutionProvider({ map, scopeFor, children }: ShortcutResolutionProviderProps) {
  const value = useMemo(() => ({ map, scopeFor }), [map, scopeFor]);
  return createElement(ShortcutResolutionContext.Provider, { value }, children);
}

/** The display text of the binding the active map runs for a command, in
 * the "Ctrl+Shift+N" shape formatShortcut localizes. An active map is
 * authoritative: a command it does not bind shows no shortcut. Without an
 * active map the command's documented default is preserved. */
export function resolveShortcutText(
  host: ShortcutResolutionHost | null | undefined,
  commandId: string,
  fallback?: string,
): string | undefined {
  if (!host?.map) return fallback;
  const binding = effectiveShortcut(commandId, host.scopeFor(commandId), host.map);
  return binding ? bindingToText(binding.strokes) : undefined;
}

/** One context read for components that render many commands (bars,
 * ribbons, menus, palette rows). */
export function useShortcutResolutionHost(): ShortcutResolutionHost | null {
  return useContext(ShortcutResolutionContext);
}

/** Resolve a single command at the top level of a component. */
export function useShortcutText(commandId: string, fallback?: string): string | undefined {
  return resolveShortcutText(useContext(ShortcutResolutionContext), commandId, fallback);
}
