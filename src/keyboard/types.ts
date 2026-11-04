import type { Command } from "../commands/registry";

/** Keyboard customization data (Step 10b, keyboard-map-1). Persisted
 * fields are snake_case; no callbacks, paths or code live in these types. */

export type ShortcutScope =
  | "global"
  | "explorer"
  | "search"
  | "text"
  | "image"
  | "pdf"
  | "media"
  | "office"
  | "dialog";

export const SHORTCUT_SCOPES: readonly ShortcutScope[] = [
  "global",
  "explorer",
  "search",
  "text",
  "image",
  "pdf",
  "media",
  "office",
  "dialog",
];

export type StrokeMode = "key" | "code";

export interface ShortcutStroke {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  mode: StrokeMode;
  /** 1-32 chars; a single space is stored as "Space", arrows as ArrowLeft/Right/Up/Down. */
  key: string;
}

export interface ShortcutBinding {
  /** Canonical UUID. */
  id: string;
  command_id: string;
  scope: ShortcutScope;
  /** One or two strokes; two-stroke sequences time out after 500 ms. */
  strokes: ShortcutStroke[];
  enabled: boolean;
}

export type BuiltinKeyboardMapId = "builtin:windows" | "builtin:finder" | "builtin:commander" | "builtin:vim";

export interface KeyboardMap {
  /** Builtin id or a canonical UUID for a custom map. */
  id: string;
  /** 1-60 characters. */
  name: string;
  bindings: ShortcutBinding[];
  version: 1;
}

export interface KeyboardCustomSettings {
  active_map: string;
  custom_maps: KeyboardMap[];
  allow_bare_navigation: boolean;
}

export type ShortcutConflictKind = "exact" | "prefix" | "reserved";

export interface ShortcutConflict {
  existing_binding_id: string;
  command_id: string;
  kind: ShortcutConflictKind;
  scope: ShortcutScope;
}

/** What the single shortcut router needs from its host (Step 10b E3).
 * The coordinator owns the one keydown listener and this host; the host
 * rechecks the current command context at dispatch (contract U1). */
export interface KeyboardHost {
  /** Active scopes, most specific first (for example ["search", "explorer", "global"]). */
  activeScopes(): readonly ShortcutScope[];
  isTypingTarget(target: EventTarget | null): boolean;
  /** Contract U1: a registry command, rechecked at dispatch. */
  command(id: string): Command<unknown> | undefined;
  /** Optional live enablement check for commands whose rules need the
   * current context (the router has none). The host rechecks at dispatch. */
  isEnabled?(id: string): boolean;
  dispatch(id: string): void;
  showDisabled(id: string): void;
  navigate(direction: "left" | "right" | "up" | "down" | "first" | "last"): void;
  focusFilter(): void;
  copyToFolder(): Promise<void>;
  moveToFolder(): Promise<void>;
}

/** Command ids the router serves through the host's navigation and
 * folder-picker methods instead of the registry (Step 10b D8). */
export const NAVIGATION_DIRECTIONS: Readonly<Record<string, "left" | "right" | "up" | "down" | "first" | "last">> = {
  "explorer.navigateLeft": "left",
  "explorer.navigateRight": "right",
  "explorer.navigateUp": "up",
  "explorer.navigateDown": "down",
  "explorer.navigateFirst": "first",
  "explorer.navigateLast": "last",
};

export const FOCUS_FILTER_COMMAND = "explorer.focusFilter";
export const COPY_TO_FOLDER_COMMAND = "explorer.copyToFolder";
export const MOVE_TO_FOLDER_COMMAND = "explorer.moveToFolder";

export const MAX_CUSTOM_MAPS = 20;
export const MAX_BINDINGS_PER_MAP = 500;
export const MAX_MAP_NAME_CHARS = 60;
export const MAX_COMMAND_ID_CHARS = 128;
export const MAX_STROKE_KEY_CHARS = 32;

export const BUILTIN_MAP_IDS: readonly BuiltinKeyboardMapId[] = [
  "builtin:windows",
  "builtin:finder",
  "builtin:commander",
  "builtin:vim",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isBuiltinMapId(value: unknown): value is BuiltinKeyboardMapId {
  return typeof value === "string" && (BUILTIN_MAP_IDS as readonly string[]).includes(value);
}

export function isShortcutScope(value: unknown): value is ShortcutScope {
  return typeof value === "string" && (SHORTCUT_SCOPES as readonly string[]).includes(value);
}

/** A stable UUID-shaped id derived from fixed text (preset bindings must
 * not churn between renders, Step 10b E6). Not cryptographic. */
export function deterministicBindingId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < seed.length; i += 1) {
      h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193);
      h2 = Math.imul(h2 ^ (seed.charCodeAt(i) + round * 31), 0x85ebca6b);
    }
    h1 = Math.imul(h1 ^ h2, 0xc2b2ae35);
    h2 = Math.imul(h2 ^ h1, 0x27d4eb2f);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const raw = `${hex(h1)}${hex(h2)}${hex(h1 ^ 0x9e3779b9)}${hex(h2 ^ 0x85ebca6b)}`.slice(0, 32);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}
