/** Canonical shell customization data (Step 10e, shell-sections-1).
 *
 * Menus, Home sections, navigation and status fields are data, never
 * executable code. The native mirror is `src-tauri/src/shell_custom_types.rs`
 * plus `shell_custom_validation.rs`; every persisted field is snake_case and
 * every unknown extra field is refused (D1-D6).
 *
 * Validators live in `validation.ts` so this canonical type file stays within
 * the repository's 400-line limit; import them from there.
 */

export type MenuTarget = "file" | "folder" | "background" | "tab" | "group";
export const MENU_TARGETS: readonly MenuTarget[] = ["file", "folder", "background", "tab", "group"];

export type MenuPlacement = "direct" | "more";

export type MenuNode =
  | { kind: "command"; id: string; command_id: string; visible: boolean; placement: MenuPlacement }
  | { kind: "separator"; id: string }
  | {
      kind: "submenu";
      id: string;
      label: string;
      children: MenuNode[];
      visible: boolean;
      placement: MenuPlacement;
    };

export interface MenuCustomization {
  target: MenuTarget;
  nodes: MenuNode[];
}

export const MAX_MENU_NODES = 100;
export const MAX_TOTAL_MENU_NODES = 500;
/** Root nodes are depth 1: a node at depth 4 is refused. */
export const MAX_MENU_DEPTH = 3;
export const MAX_SUBMENU_CHILDREN = 50;
export const MAX_COMMAND_ID_CHARS = 128;
export const MAX_SUBMENU_LABEL_CHARS = 60;
export const MAX_MENU_COUNT = MENU_TARGETS.length;

export type HomeSectionSize = "small" | "medium" | "large";
export const HOME_SECTION_SIZES: readonly HomeSectionSize[] = ["small", "medium", "large"];

export interface HomeSectionLayout {
  id: string;
  visible: boolean;
  collapsed: boolean;
  size: HomeSectionSize;
  limit: number;
}

export interface HomeCustomization {
  sections: HomeSectionLayout[];
}

export const MAX_HOME_SECTIONS = 32;
export const MAX_HOME_LIMIT = 100;
export const DEFAULT_HOME_LIMIT = 12;
export const MAX_HOME_SECTION_ID_CHARS = 64;

export type ShellItemKind = "file" | "folder" | "action" | "summary";

/** One runtime row a Home section provider returns. Never persisted. */
export interface ShellItem {
  id: string;
  kind: ShellItemKind;
  label: string;
  detail?: string;
  target_id: string;
  icon_id: string;
  disabled_reason_key?: string;
}

/** A trusted, statically registered Home section provider. */
export interface HomeSectionProvider {
  id: string;
  label_key: string;
  load(limit: number, signal: AbortSignal): Promise<readonly ShellItem[]>;
  activate(item: ShellItem): Promise<void>;
}

export const MAX_SHELL_ITEM_ID_CHARS = 128;
export const MAX_SHELL_ITEM_LABEL_CHARS = 512;
export const MAX_SHELL_ITEM_TARGET_CHARS = 32768;
export const MAX_SHELL_ITEM_ICON_CHARS = 64;

export type NavigationItemKind = "builtin" | "folder";

export interface NavigationItem {
  id: string;
  kind: NavigationItemKind;
  target_id: string;
  display_label?: string;
  visible: boolean;
  section_id: string;
}

export interface NavigationSectionLayout {
  id: string;
  label?: string;
  visible: boolean;
  items: NavigationItem[];
}

export interface NavigationCustomization {
  sections: NavigationSectionLayout[];
  row_height_px: number;
  icon_size_px: number;
  width_px: number;
  auto_collapse: boolean;
}

export const NAV_SECTION_IDS: readonly string[] = [
  "home",
  "gallery",
  "pinned",
  "this_pc",
  "network",
  "saved_groups",
];
export const MAX_NAV_SECTIONS = 32;
export const MAX_CUSTOM_NAV_SECTIONS = 20;
export const MAX_CUSTOM_NAV_ITEMS = 200;
export const MAX_NAV_LABEL_CHARS = 60;
export const MIN_NAV_ROW_HEIGHT = 28;
export const MAX_NAV_ROW_HEIGHT = 48;
export const NAV_ICON_SIZES: readonly number[] = [16, 20, 24];
export const MIN_NAV_WIDTH = 160;
export const MAX_NAV_WIDTH = 480;
export const NAV_DEFAULTS = { row_height_px: 32, icon_size_px: 20, width_px: 240, auto_collapse: false } as const;

export type StatusKind = "explorer" | "text" | "pdf" | "image" | "media" | "office";
export const STATUS_KINDS: readonly StatusKind[] = ["explorer", "text", "pdf", "image", "media", "office"];

export type StatusValue =
  | { kind: "text"; text: string }
  | { kind: "number"; value: number }
  | { kind: "size"; bytes: number }
  | { kind: "position"; line: number; column: number }
  | { kind: "zoom"; percent: number; min: number; max: number };

export interface StatusFieldProvider {
  id: string;
  label_key: string;
  /** Trusted live getter owned by one view; null means "nothing to show". */
  read(): StatusValue | null;
  activate?(): void;
}

export interface StatusFieldOrderEntry {
  id: string;
  visible: boolean;
}

export interface StatusCustomization {
  visible: boolean;
  orders: Record<StatusKind, StatusFieldOrderEntry[]>;
}

export const MAX_STATUS_FIELDS_PER_KIND = 64;
export const MAX_STATUS_ID_CHARS = 128;
export const MAX_STATUS_TEXT_CHARS = 512;

/** One shell record and the whole section stay small (D1). */
export const MAX_SHELL_RECORD_BYTES = 1024 * 1024;
export const MAX_SHELL_TOTAL_BYTES = 4 * 1024 * 1024;

/** The whole `shell_custom` settings section (schema 32). */
export interface ShellCustomization {
  menus: MenuCustomization[];
  home: HomeCustomization;
  navigation: NavigationCustomization;
  status: StatusCustomization;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SECTION_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function charCount(text: string): number {
  return Array.from(text).length;
}

/** Canonical lowercase UUID text, as `crypto.randomUUID()` writes it. */
export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isRegisteredSectionId(value: unknown): value is string {
  return typeof value === "string" && SECTION_ID_RE.test(value);
}

/** A new node id. IDs are identity only, never authorization. */
export function createMenuNodeId(): string {
  const fromCrypto = globalThis.crypto?.randomUUID?.();
  if (fromCrypto) return fromCrypto;
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}
