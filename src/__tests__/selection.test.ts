import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  clearSelection,
  invertSelection,
  moveFocus,
  pruneSelection,
  selectAll,
  selectOnly,
  selectRange,
  summarizeSelection,
  toggleFocused,
  toggleItem,
  typeAheadIndex,
} from "../services/selection";

const order = ["a", "b", "c", "d", "e"];
const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe("selection model", () => {
  it("click, Ctrl+click and Shift+click", () => {
    let state = selectOnly("b");
    expect(sorted(state.selected)).toEqual(["b"]);
    state = toggleItem(state, "d");
    expect(sorted(state.selected)).toEqual(["b", "d"]);
    state = toggleItem(state, "b");
    expect(sorted(state.selected)).toEqual(["d"]);
    state = selectOnly("b");
    state = selectRange(state, order, "d");
    expect(sorted(state.selected)).toEqual(["b", "c", "d"]);
    expect(state.anchor).toBe("b");
    // Shift again from the same anchor shrinks the range.
    state = selectRange(state, order, "a");
    expect(sorted(state.selected)).toEqual(["a", "b"]);
    // Ctrl+Shift adds a second range.
    state = toggleItem(selectOnly("a"), "d");
    state = selectRange(state, order, "e", true);
    expect(sorted(state.selected)).toEqual(["a", "d", "e"]);
  });

  it("keyboard moves select, extend, or move only the caret", () => {
    let state = moveFocus(EMPTY_SELECTION, order, "next");
    expect(state.focus).toBe("a");
    state = moveFocus(state, order, "next");
    expect(sorted(state.selected)).toEqual(["b"]);
    state = moveFocus(state, order, "next", { shift: true });
    state = moveFocus(state, order, "next", { shift: true });
    expect(sorted(state.selected)).toEqual(["b", "c", "d"]);
    state = moveFocus(state, order, "previous", { ctrl: true });
    expect(state.focus).toBe("c");
    expect(sorted(state.selected)).toEqual(["b", "c", "d"]);
    state = toggleFocused(state);
    expect(sorted(state.selected)).toEqual(["b", "d"]);
    expect(moveFocus(state, order, "last").focus).toBe("e");
    expect(moveFocus(state, order, "first").focus).toBe("a");
    expect(moveFocus(selectOnly("a"), order, "pageDown", { pageSize: 3 }).focus).toBe("d");
    expect(moveFocus(selectOnly("e"), order, "pageUp", { pageSize: 10 }).focus).toBe("a");
  });

  it("select all, none, invert, and pruning after a refresh", () => {
    let state = selectAll(selectOnly("c"), order);
    expect(state.selected.size).toBe(5);
    state = clearSelection(state);
    expect(state.selected.size).toBe(0);
    expect(state.focus).toBe("c");
    state = invertSelection(toggleItem(selectOnly("a"), "b"), order);
    expect(sorted(state.selected)).toEqual(["c", "d", "e"]);
    state = pruneSelection(state, ["a", "c"]);
    expect(sorted(state.selected)).toEqual(["c"]);
    const same = selectOnly("a");
    expect(pruneSelection(same, order)).toBe(same);
  });

  it("type-ahead finds prefixes and cycles on a repeated letter", () => {
    const names = ["Alpha", "beta", "Bravo", "bridge", "Charlie"];
    expect(typeAheadIndex(names, -1, "b")).toBe(1);
    expect(typeAheadIndex(names, 1, "b")).toBe(2);
    expect(typeAheadIndex(names, 1, "bb")).toBe(2);
    expect(typeAheadIndex(names, 3, "b")).toBe(1);
    expect(typeAheadIndex(names, 1, "bri")).toBe(3);
    expect(typeAheadIndex(names, 0, "z")).toBe(-1);
    expect(typeAheadIndex(names, 0, "")).toBe(-1);
  });

  it("summaries count files and folders and add up file sizes only", () => {
    const items: Record<string, { kind: string; size: number }> = {
      a: { kind: "file", size: 100 },
      b: { kind: "folder", size: 0 },
      c: { kind: "file", size: 23 },
    };
    const summary = summarizeSelection(new Set(["a", "b", "c", "gone"]), (p) => items[p]);
    expect(summary).toEqual({ count: 3, files: 2, folders: 1, bytes: 123 });
  });
});
