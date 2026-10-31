import { describe, expect, it } from "vitest";
import { flattenTree, type JsonPages } from "../handlers/json/tree";
import type { JsonNodeInfo } from "../services/jsonView";

function node(patch: Partial<JsonNodeInfo> & { id: number }): JsonNodeInfo {
  return {
    key: null,
    index: null,
    kind: "string",
    preview: "",
    preview_cut: false,
    child_count: 0,
    ...patch,
  };
}

function pages(entries: [number, [number, JsonNodeInfo[]][]][]): JsonPages {
  return new Map(entries.map(([container, pageEntries]) => [container, new Map(pageEntries)]));
}

describe("json tree", () => {
  it("closed containers hide children", () => {
    const root = node({ id: 0, kind: "object", child_count: 1 });
    const child = node({ id: 1, kind: "array", key: "list", child_count: 2 });
    const rows = flattenTree(root, new Set([0]), pages([[0, [[0, [child]]]]]));
    expect(rows.map((row) => row.node?.id)).toEqual([0, 1]);
  });

  it("partly loaded containers get a more row", () => {
    const root = node({ id: 0, kind: "array", child_count: 2_500 });
    const loaded = Array.from({ length: 1_000 }, (_, index) =>
      node({ id: index + 1, kind: "number", index, preview: String(index) }),
    );
    const rows = flattenTree(root, new Set([0]), pages([[0, [[0, loaded]]]]));
    expect(rows).toHaveLength(1_002);
    expect(rows.at(-1)).toMatchObject({ kind: "more", remaining: 1_500, parentId: 0 });
  });

  it("depth follows nesting", () => {
    const root = node({ id: 0, kind: "object", child_count: 1 });
    const a = node({ id: 1, kind: "object", key: "a", child_count: 1 });
    const b = node({ id: 2, kind: "string", key: "b", preview: "x" });
    const rows = flattenTree(
      root,
      new Set([0, 1]),
      pages([
        [0, [[0, [a]]]],
        [1, [[0, [b]]]],
      ]),
    );
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });
});
