import {
  MAX_BAR_ENTRIES,
  QUICK_ACCESS_BAR_ID,
  type CommandBarLayout,
  type CommandLayoutEntry,
  type ToolbarCustomSettings,
  type ToolbarDescriptor,
} from "../services/commandLayout";

/** Pure draft operations for the toolbar editor (Step 10b D2-D4). Every
 * operation returns new objects; the saved settings are never mutated, so
 * Cancel preserves them exactly. */

export function cloneEntry(entry: CommandLayoutEntry): CommandLayoutEntry {
  return { ...entry };
}

export function entriesForBar(settings: ToolbarCustomSettings, descriptor: ToolbarDescriptor): CommandLayoutEntry[] {
  const saved = settings.bars.find((bar) => bar.bar_id === descriptor.id);
  const source = saved ? saved.entries : descriptor.default_entries;
  return source.map(cloneEntry);
}

export function withBarEntries(
  settings: ToolbarCustomSettings,
  barId: string,
  entries: readonly CommandLayoutEntry[],
): ToolbarCustomSettings {
  const kept = settings.bars.filter((bar) => bar.bar_id !== barId);
  const bar: CommandBarLayout = { bar_id: barId, entries: entries.map(cloneEntry) };
  return { ...settings, bars: [...kept, bar], quick_access: [...settings.quick_access] };
}

export function addEntry(
  entries: readonly CommandLayoutEntry[],
  entry: CommandLayoutEntry,
): CommandLayoutEntry[] | null {
  if (entries.length >= MAX_BAR_ENTRIES) return null;
  if (entry.kind !== "separator" && entries.some((existing) => existing.kind === entry.kind && existing.id === entry.id)) {
    return [...entries.map(cloneEntry)];
  }
  return [...entries.map(cloneEntry), cloneEntry(entry)];
}

export function removeEntry(
  entries: readonly CommandLayoutEntry[],
  descriptor: ToolbarDescriptor,
  kind: CommandLayoutEntry["kind"],
  id: string,
): CommandLayoutEntry[] {
  if (descriptor.mandatory_ids.includes(id)) return entries.map(cloneEntry);
  return entries.filter((entry) => !(entry.kind === kind && entry.id === id)).map(cloneEntry);
}

export function moveEntry(
  entries: readonly CommandLayoutEntry[],
  kind: CommandLayoutEntry["kind"],
  id: string,
  delta: -1 | 1,
): CommandLayoutEntry[] {
  const result = entries.map(cloneEntry);
  const index = result.findIndex((entry) => entry.kind === kind && entry.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= result.length) return result;
  const [moved] = result.splice(index, 1);
  result.splice(target, 0, moved);
  return result;
}

export function setEntryVisible(
  entries: readonly CommandLayoutEntry[],
  kind: CommandLayoutEntry["kind"],
  id: string,
  visible: boolean,
): CommandLayoutEntry[] {
  return entries.map((entry) => (entry.kind === kind && entry.id === id ? { ...entry, visible } : cloneEntry(entry)));
}

export function resetBar(descriptor: ToolbarDescriptor): CommandLayoutEntry[] {
  return descriptor.default_entries.map(cloneEntry);
}

/** The group segment of a ribbon bar id ("" for non-ribbon bars). */
export function barGroupId(barId: string): string {
  const parts = barId.split(".");
  return barId.startsWith("ribbon.") && parts.length >= 4 ? parts[parts.length - 1] : "";
}

/** May an entry move from one bar to another? Same bar always. Across
 * ribbon groups only trusted custom controls, and only when the source
 * descriptor lists both groups as compatible (D3). */
export function canMoveEntryToBar(
  entry: CommandLayoutEntry,
  from: ToolbarDescriptor,
  to: ToolbarDescriptor,
): boolean {
  if (from.id === to.id) return true;
  if (entry.kind !== "custom") return false;
  const fromGroup = barGroupId(from.id);
  const toGroup = barGroupId(to.id);
  if (!fromGroup || !toGroup) return false;
  return from.compatible_groups.includes(fromGroup) && from.compatible_groups.includes(toGroup);
}

/** Add a command id to Quick Access (at most 20, no duplicates, D2). */
export function addQuickAccess(settings: ToolbarCustomSettings, commandId: string): ToolbarCustomSettings | null {
  if (settings.quick_access.includes(commandId)) return { ...settings, quick_access: [...settings.quick_access] };
  if (settings.quick_access.length >= 20) return null;
  return { ...settings, quick_access: [...settings.quick_access, commandId] };
}

export function quickAccessEntries(settings: ToolbarCustomSettings): CommandLayoutEntry[] {
  return settings.quick_access.map((id) => ({ kind: "command", id, visible: true }));
}

export { QUICK_ACCESS_BAR_ID };
