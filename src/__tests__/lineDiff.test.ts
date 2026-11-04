import { describe, expect, it } from "vitest";
import { diffLines, splitLines, withContext } from "../versions/lineDiff";

describe("line diff", () => {
  it("splitLines handles every line break", () => {
    expect(splitLines("a\r\nb\nc\rd\n")).toEqual(["a", "b", "c", "d"]);
  });

  it("equal texts have no changes", () => {
    expect(diffLines(["a", "b"], ["a", "b"])).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
    expect(withContext(diffLines(["a", "b"], ["a", "b"]) ?? [])).toEqual([]);
  });

  it("one changed line", () => {
    expect(diffLines(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("added and removed lines at the ends", () => {
    expect(diffLines(["a", "b"], ["b", "c"])).toEqual([
      { kind: "removed", text: "a" },
      { kind: "same", text: "b" },
      { kind: "added", text: "c" },
    ]);
  });

  it("context collapses long unchanged runs", () => {
    const before = Array.from({ length: 20 }, (_, index) => String(index + 1));
    const after = before.map((line) => (line === "10" ? "X" : line));
    const rows = withContext(diffLines(before, after) ?? []);
    expect(rows).toEqual([
      { kind: "skip", count: 6 },
      { kind: "same", text: "7" },
      { kind: "same", text: "8" },
      { kind: "same", text: "9" },
      { kind: "removed", text: "10" },
      { kind: "added", text: "X" },
      { kind: "same", text: "11" },
      { kind: "same", text: "12" },
      { kind: "same", text: "13" },
      { kind: "skip", count: 7 },
    ]);
  });

  it("too many changes", () => {
    const before = Array.from({ length: 5000 }, (_, index) => `a${index}`);
    const after = Array.from({ length: 5000 }, (_, index) => `b${index}`);
    expect(diffLines(before, after)).toBeNull();
  });

  it("empty texts", () => {
    expect(diffLines([], ["a"])).toEqual([{ kind: "added", text: "a" }]);
    expect(diffLines(["a"], [])).toEqual([{ kind: "removed", text: "a" }]);
  });
});
