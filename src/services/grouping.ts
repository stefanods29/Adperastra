/** Group by (Sort menu, Step 03a). Groups keep the incoming (sorted) order
 * of their items; group order is fixed per grouping, like Windows. */

export type GroupBy = "none" | "name" | "modified" | "type" | "size";

export interface GroupableItem {
  name: string;
  kind: string;
  size: number;
  modified_unix: number;
}

export interface ItemGroup<T> {
  /** Stable id; translated through `explorer.group.<id>` unless `label` is set. */
  id: string;
  /** Literal label (already translated), used for type groups. */
  label?: string;
  items: T[];
}

const NAME_ORDER = ["digits", "aToH", "iToP", "qToZ", "other"];
const DATE_ORDER = [
  "today", "yesterday", "earlierThisWeek", "lastWeek", "earlierThisMonth",
  "lastMonth", "earlierThisYear", "longAgo", "unknownDate",
];
const SIZE_ORDER = ["folders", "empty", "tiny", "small", "medium", "large", "huge", "gigantic"];

function nameBucket(name: string): string {
  const first = name.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  if (first >= "0" && first <= "9") return "digits";
  if (first >= "A" && first <= "H") return "aToH";
  if (first >= "I" && first <= "P") return "iToP";
  if (first >= "Q" && first <= "Z") return "qToZ";
  return "other";
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Monday-based weeks, the most common first day for our languages. */
export function dateBucket(modifiedUnix: number, now: Date): string {
  if (modifiedUnix <= 0) return "unknownDate";
  const time = modifiedUnix * 1000;
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  const weekday = (now.getDay() + 6) % 7;
  const weekStart = today - weekday * day;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  if (time >= today) return "today";
  if (time >= today - day) return "yesterday";
  if (time >= weekStart) return "earlierThisWeek";
  if (time >= weekStart - 7 * day) return "lastWeek";
  if (time >= monthStart) return "earlierThisMonth";
  if (time >= lastMonthStart) return "lastMonth";
  if (time >= yearStart) return "earlierThisYear";
  return "longAgo";
}

export function sizeBucket(kind: string, size: number): string {
  if (kind === "folder" || kind === "drive") return "folders";
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (size === 0) return "empty";
  if (size < 16 * kb) return "tiny";
  if (size < mb) return "small";
  if (size < 128 * mb) return "medium";
  if (size < gb) return "large";
  if (size < 4 * gb) return "huge";
  return "gigantic";
}

export function groupItems<T extends GroupableItem>(
  items: readonly T[],
  groupBy: GroupBy,
  now: Date,
  typeLabel: (item: T) => string,
): ItemGroup<T>[] {
  if (groupBy === "none") return [{ id: "all", items: [...items] }];
  const groups = new Map<string, ItemGroup<T>>();
  for (const item of items) {
    let id: string;
    let label: string | undefined;
    if (groupBy === "name") id = nameBucket(item.name);
    else if (groupBy === "modified") id = dateBucket(item.modified_unix, now);
    else if (groupBy === "size") id = sizeBucket(item.kind, item.size);
    else {
      label = typeLabel(item);
      id = `${item.kind === "folder" ? "0" : "1"}:${label}`;
    }
    let group = groups.get(id);
    if (!group) {
      group = { id, label, items: [] };
      groups.set(id, group);
    }
    group.items.push(item);
  }
  const order = groupBy === "name" ? NAME_ORDER : groupBy === "modified" ? DATE_ORDER : groupBy === "size" ? SIZE_ORDER : null;
  const list = [...groups.values()];
  if (order) list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  else list.sort((a, b) => a.id.localeCompare(b.id));
  return list;
}
