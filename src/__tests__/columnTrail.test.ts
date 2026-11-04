import { describe, expect, it } from "vitest";
import type { ExplorerItem } from "../services/explorer";
import type { ItemGroup } from "../services/grouping";
import { EMPTY_SELECTION, selectOnly } from "../services/selection";
import {
  columnChain,
  columnItems,
  columnLeftTarget,
  columnName,
  columnTrailStep,
  displayItems,
  isSameOrInside,
  singleSelected,
} from "../views/explorer/views/columnTrail";

const item = (
  name: string,
  kind: "file" | "folder" = "file",
  path: string = `C:\\F\\${name}`,
  hidden = false,
  system = false,
): ExplorerItem => ({
  path,
  name,
  kind,
  size: 1,
  modified_unix: 1700000000,
  hidden,
  system,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const typeLabel = (entry: ExplorerItem) => (entry.kind === "folder" ? "Folder" : "TXT file");
const names = (list: readonly ExplorerItem[]) => list.map((entry) => entry.name);

describe("columnTrail", () => {
  it("isSameOrInside compares whole folder names", () => {
    expect(isSameOrInside("C:\\A\\B", "C:\\A")).toBe(true);
    expect(isSameOrInside("C:\\A", "c:\\a\\")).toBe(true);
    expect(isSameOrInside("\\\\?\\C:\\A\\B", "C:\\")).toBe(true);
    expect(isSameOrInside("C:\\AB", "C:\\A")).toBe(false);
    expect(isSameOrInside("D:\\A", "C:\\")).toBe(false);
    expect(isSameOrInside("\\\\srv\\share\\x", "\\\\srv\\share")).toBe(true);
  });

  it("columnChain lists the folders from the root", () => {
    expect(columnChain("C:\\", "C:\\A\\B")).toEqual(["C:\\", "C:\\A", "C:\\A\\B"]);
    expect(columnChain("c:\\a\\", "\\\\?\\C:\\A\\B")).toEqual(["C:\\A", "C:\\A\\B"]);
    expect(columnChain("C:\\A", "C:\\A")).toEqual(["C:\\A"]);
    expect(columnChain("D:\\X", "C:\\A")).toEqual(["C:\\A"]);
    expect(columnChain("\\\\srv\\share", "\\\\srv\\share\\docs")).toEqual(["\\\\srv\\share", "\\\\srv\\share\\docs"]);
  });

  it("columnChain keeps the last 24 columns", () => {
    const deep = `C:\\${Array.from({ length: 30 }, (_, index) => `d${index + 1}`).join("\\")}`;
    const chain = columnChain("C:\\", deep);
    expect(chain).toHaveLength(24);
    expect(chain[chain.length - 1]).toBe(deep);
    expect(chain[0]).toBe("C:\\d1\\d2\\d3\\d4\\d5\\d6\\d7");
  });

  it("columnName shows the last part", () => {
    expect(columnName("C:\\Users\\Ana")).toBe("Ana");
    expect(columnName("C:\\")).toBe("C:\\");
    expect(columnName("\\\\srv\\share")).toBe("\\\\srv\\share");
  });

  it("columnTrailStep keeps Column view inside its folders", () => {
    const step = (
      trailRoot: string | null,
      folder: string | null,
      baseMode: "details" | "tiles" | "largeIcons" | "columns",
      columnsVisible: boolean,
    ) => columnTrailStep(trailRoot, folder, baseMode, columnsVisible);
    expect(step(null, "C:\\A", "columns", true)).toEqual({ mode: "columns", root: "C:\\A" });
    expect(step(null, "C:\\A", "details", true)).toEqual({ mode: "details", root: null });
    expect(step("C:\\A", "C:\\A\\B", "details", true)).toEqual({ mode: "columns", root: "C:\\A" });
    expect(step("C:\\A", "C:\\A", "tiles", true)).toEqual({ mode: "columns", root: "C:\\A" });
    expect(step("C:\\A\\B", "C:\\A", "details", true)).toEqual({ mode: "columns", root: "C:\\A" });
    expect(step("C:\\A", "D:\\X", "largeIcons", true)).toEqual({ mode: "largeIcons", root: null });
    expect(step("C:\\A", "D:\\X", "columns", true)).toEqual({ mode: "columns", root: "D:\\X" });
    expect(step("C:\\A", null, "details", true)).toEqual({ mode: "details", root: "C:\\A" });
    expect(step("C:\\A", "C:\\A\\B", "details", false)).toEqual({ mode: "details", root: null });
    expect(step("c:\\a\\", "\\\\?\\C:\\A\\B", "details", true)).toEqual({ mode: "columns", root: "c:\\a\\" });
  });

  it("columnItems hides hidden items and keeps the grouped order", () => {
    const list = [item("b.txt"), item("a", "folder"), item("h.txt", "file", undefined, true), item("s.sys", "file", undefined, false, true)];
    const now = new Date("2026-01-01T00:00:00Z");
    expect(names(columnItems(list, false, "none", typeLabel, now))).toEqual(["b.txt", "a"]);
    expect(names(columnItems(list, true, "none", typeLabel, now))).toEqual(["b.txt", "a", "h.txt", "s.sys"]);
    expect(names(columnItems(list, false, "type", typeLabel, now))).toEqual(["a", "b.txt"]);
  });

  it("displayItems flattens groups", () => {
    const a = item("a.txt");
    const b = item("b.txt");
    const c = item("c.txt");
    const list = [a, b, c];
    expect(displayItems(list, null)).toBe(list);
    const groups: ItemGroup<ExplorerItem>[] = [
      { id: "one", items: [b] },
      { id: "two", items: [c, a] },
    ];
    expect(names(displayItems(list, groups))).toEqual(["b.txt", "c.txt", "a.txt"]);
  });

  it("singleSelected finds the one selected item", () => {
    const a = item("a.txt");
    const b = item("b.txt");
    const list = [a, b];
    expect(singleSelected(selectOnly(b.path), list)).toBe(b);
    expect(singleSelected({ selected: new Set([a.path, b.path]), anchor: null, focus: null }, list)).toBeNull();
    expect(singleSelected(selectOnly("C:\\F\\missing.txt"), list)).toBeNull();
    expect(singleSelected(EMPTY_SELECTION, list)).toBeNull();
  });

  it("columnLeftTarget goes one column back, then up", () => {
    expect(columnLeftTarget(["C:\\", "C:\\A"], "C:\\A")).toEqual({ folder: "C:\\", select: "C:\\A" });
    expect(columnLeftTarget(["C:\\A"], "C:\\A")).toEqual({ folder: "C:\\", select: "C:\\A" });
    expect(columnLeftTarget(["C:\\"], "C:\\")).toBeNull();
    expect(columnLeftTarget(["\\\\srv\\share"], "\\\\srv\\share")).toBeNull();
  });
});
