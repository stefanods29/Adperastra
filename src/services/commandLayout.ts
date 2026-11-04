/** Command layouts for toolbars, Quick Access, the classic menu bar and
 * ribbon groups (Step 10b, command-layout-1). A layout names registered
 * command ids and trusted custom-control ids only: no callbacks, path
 * arguments, shell strings or URLs are ever persisted (D1). */

export type CommandLayoutEntryKind = "command" | "custom" | "separator";

export interface CommandLayoutEntry {
  kind: CommandLayoutEntryKind;
  /** Command id, custom-control id, or a separator id. At most 128 chars. */
  id: string;
  visible: boolean;
}

export interface CommandBarLayout {
  /** At most 192 chars: explorer.command, app.quickAccess, app.classicMenu
   * or ribbon.<handlerId>.<tabId>.<groupId>. */
  bar_id: string;
  entries: CommandLayoutEntry[];
}

export interface ToolbarCustomSettings {
  classic_menu: boolean;
  bars: CommandBarLayout[];
  /** Registered command ids only, at most 20. */
  quick_access: string[];
}

/** A bar the app registered. Runtime-only: trusted, never serialized. */
export interface ToolbarDescriptor {
  id: string;
  default_entries: readonly CommandLayoutEntry[];
  /** Groups a custom control may also live in; empty means its own group only. */
  compatible_groups: readonly string[];
  /** Entries the editor cannot remove (Help stays reachable, D2). */
  mandatory_ids: readonly string[];
}

export const EXPLORER_COMMAND_BAR_ID = "explorer.command";
export const QUICK_ACCESS_BAR_ID = "app.quickAccess";
export const CLASSIC_MENU_BAR_ID = "app.classicMenu";

export const MAX_BAR_ENTRIES = 100;
export const MAX_BARS = 100;
export const MAX_TOTAL_ENTRIES = 1000;
export const MAX_QUICK_ACCESS = 20;
export const MAX_ENTRY_ID_CHARS = 128;
export const MAX_BAR_ID_CHARS = 192;

export const DEFAULT_QUICK_ACCESS: readonly string[] = [
  "explorer.undo",
  "explorer.redo",
  "explorer.copyPath",
];

export function ribbonBarId(handlerId: string, tabId: string, groupId: string): string {
  return `ribbon.${handlerId}.${tabId}.${groupId}`;
}

export function defaultToolbarCustomSettings(): ToolbarCustomSettings {
  return { classic_menu: false, bars: [], quick_access: [...DEFAULT_QUICK_ACCESS] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function charCount(text: string): number {
  return Array.from(text).length;
}

const ENTRY_KEYS = new Set(["kind", "id", "visible"]);
const BAR_KEYS = new Set(["bar_id", "entries"]);
const SETTINGS_KEYS = new Set(["classic_menu", "bars", "quick_access"]);

/** One validated entry, or null. Any extra field (a render callback, an
 * argument, a URL) makes the entry invalid: persisted layouts are data. */
export function validateCommandLayoutEntry(value: unknown): CommandLayoutEntry | null {
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.has(key)) return null;
  }
  if (value.kind !== "command" && value.kind !== "custom" && value.kind !== "separator") return null;
  if (typeof value.id !== "string" || value.id.length === 0 || charCount(value.id) > MAX_ENTRY_ID_CHARS) return null;
  if (value.visible !== undefined && typeof value.visible !== "boolean") return null;
  return { kind: value.kind, id: value.id, visible: value.visible ?? true };
}

function validateBar(value: unknown): CommandBarLayout | null {
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if (!BAR_KEYS.has(key)) return null;
  }
  if (typeof value.bar_id !== "string" || value.bar_id.length === 0 || charCount(value.bar_id) > MAX_BAR_ID_CHARS) return null;
  if (!Array.isArray(value.entries) || value.entries.length > MAX_BAR_ENTRIES) return null;
  const entries: CommandLayoutEntry[] = [];
  for (const entry of value.entries) {
    const validated = validateCommandLayoutEntry(entry);
    if (!validated) return null;
    entries.push(validated);
  }
  return { bar_id: value.bar_id, entries };
}

/** The whole toolbar section, or a thrown "toolbar.invalid". Unknown
 * command and custom ids are kept: they show as unavailable and are
 * never executed (D1). */
export function validateToolbarCustomSettings(value: unknown): ToolbarCustomSettings {
  if (!isRecord(value)) throw new Error("toolbar.invalid");
  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.has(key)) throw new Error("toolbar.invalid");
  }
  if (value.classic_menu !== undefined && typeof value.classic_menu !== "boolean") throw new Error("toolbar.invalid");
  if (!Array.isArray(value.bars) || value.bars.length > MAX_BARS) throw new Error("toolbar.invalid");
  const bars: CommandBarLayout[] = [];
  const seenBars = new Set<string>();
  let total = 0;
  for (const bar of value.bars) {
    const validated = validateBar(bar);
    if (!validated || seenBars.has(validated.bar_id)) throw new Error("toolbar.invalid");
    seenBars.add(validated.bar_id);
    total += validated.entries.length;
    if (total > MAX_TOTAL_ENTRIES) throw new Error("toolbar.invalid");
    bars.push(validated);
  }
  if (!Array.isArray(value.quick_access) || value.quick_access.length > MAX_QUICK_ACCESS) {
    throw new Error("toolbar.invalid");
  }
  for (const id of value.quick_access) {
    if (typeof id !== "string" || id.length === 0 || charCount(id) > MAX_ENTRY_ID_CHARS) throw new Error("toolbar.invalid");
  }
  total += value.quick_access.length;
  if (total > MAX_TOTAL_ENTRIES) throw new Error("toolbar.invalid");
  return {
    classic_menu: value.classic_menu ?? false,
    bars,
    quick_access: [...value.quick_access],
  };
}

/** Can this entry run or render? Unknown ids cannot; separators draw. */
export function entryExecutable(
  entry: CommandLayoutEntry,
  commandIds: ReadonlySet<string>,
  customIds: ReadonlySet<string>,
): boolean {
  if (entry.kind === "command") return commandIds.has(entry.id);
  if (entry.kind === "custom") return customIds.has(entry.id);
  return false;
}

/** Registered bars and their effective entries (E1). Descriptors are
 * trusted app code; resolve() applies the saved layout before the caller
 * measures docking and overflow (U3), and never calls a render callback. */
export class CommandLayoutRegistry {
  private descriptors = new Map<string, ToolbarDescriptor>();

  register(descriptor: ToolbarDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`duplicate bar id: ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);
  }

  get(barId: string): ToolbarDescriptor | undefined {
    return this.descriptors.get(barId);
  }

  list(): ToolbarDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** The entries to draw for a bar: the saved visible entries, or the
   * descriptor defaults when the user has not customized the bar. Quick
   * Access is always its ordered command-id list (D2), so an older saved
   * bar with that id can never shadow the list the editor writes. */
  resolve(barId: string, settings: ToolbarCustomSettings): readonly CommandLayoutEntry[] {
    if (barId === QUICK_ACCESS_BAR_ID) {
      return settings.quick_access
        .map((id): CommandLayoutEntry => ({ kind: "command", id, visible: true }))
        .slice(0, MAX_BAR_ENTRIES);
    }
    const saved = settings.bars.find((bar) => bar.bar_id === barId);
    const entries = saved ? saved.entries : (this.descriptors.get(barId)?.default_entries ?? []);
    return entries.filter((entry) => entry.visible).slice(0, MAX_BAR_ENTRIES);
  }
}
