import { describe, expect, it } from "vitest";
import { entryForJob, type OpReport } from "../services/fileops";

const base: OpReport = { completed: [], skipped: [], cancelled: false, replaced: [], created: [] };

describe("undo entries for finished jobs", () => {
  it("undoes a merge by removing only the items the copy created", () => {
    const report: OpReport = {
      ...base,
      completed: [{ from: "C:\src\A", to: "D:\out\A" }],
      created: [{ from: "C:\src\A\new.txt", to: "D:\out\A\new.txt" }],
    };
    const entry = entryForJob("copy", report, "D:\out");
    expect(entry?.undo).toEqual({ type: "recycle", paths: ["D:\out\A\new.txt"] });
    expect(entry?.redo).toMatchObject({ type: "copy", sources: ["C:\src\A"], destDir: "D:\out" });
  });

  it("brings back the exact bin entries a Replace sent away, after the new items", () => {
    const report: OpReport = {
      ...base,
      completed: [{ from: "C:\src\a.txt", to: "D:\out\a.txt" }],
      created: [{ from: "C:\src\a.txt", to: "D:\out\a.txt" }],
      replaced: [
        { path: "D:\out\a.txt", bin_id: "D:\$Recycle.Bin\S-1\$RAB12.txt" },
        { path: "D:\out\lost.txt", bin_id: null },
      ],
    };
    const entry = entryForJob("move", report, "D:\out");
    expect(entry?.undo).toEqual({
      type: "sequence",
      actions: [
        { type: "movePairs", pairs: [{ from: "D:\out\a.txt", to: "C:\src\a.txt" }] },
        { type: "restore", originals: ["D:\out\a.txt"], binIds: ["D:\$Recycle.Bin\S-1\$RAB12.txt"] },
      ],
    });
  });

  it("records nothing when nothing changed", () => {
    expect(entryForJob("copy", base, "D:\out")).toBeNull();
  });

  it("records destination changes from a cancelled move before any source completed", () => {
    const report: OpReport = {
      ...base,
      cancelled: true,
      transfer_id: "op-partial",
      created: [{ from: "C:\\src\\A\\first.txt", to: "D:\\out\\A\\first.txt" }],
    };
    const entry = entryForJob("move", report, "D:\\out");
    expect(entry?.undo).toEqual({ type: "transfer", id: "op-partial", reverse: true });
    expect(entry?.redo).toEqual({ type: "transfer", id: "op-partial", reverse: false });
  });

  it("records an empty destination folder created before a copy was cancelled", () => {
    const report: OpReport = {
      ...base,
      cancelled: true,
      created: [{ from: "C:\\src\\A", to: "D:\\out\\A" }],
    };
    expect(entryForJob("copy", report, "D:\\out")?.undo).toEqual({
      type: "recycle", paths: ["D:\\out\\A"],
    });
  });
});
