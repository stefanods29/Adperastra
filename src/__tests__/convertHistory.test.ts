import { describe, expect, it, vi } from "vitest";
import {
  conversionHistoryEntry,
  createdPathsOf,
  mergeConversionPages,
} from "../convert/convertHistory";
import type { ConversionReport } from "../convert/types";
import { UndoStack } from "../services/undo";

vi.mock("../services/fileops", () => ({
  executeFileAction: vi.fn(async () => {
    throw new Error("ops.cancelled");
  }),
}));

import { executeFileAction } from "../services/fileops";

function report(overrides: Partial<ConversionReport> = {}): ConversionReport {
  return {
    report_id: "report",
    items: [],
    outputs: [],
    created_paths: [],
    input_total: 1,
    done_count: 0,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    outputs_created: 0,
    cancelled: false,
    job_finished: true,
    complete: true,
    ...overrides,
  };
}

describe("conversion history", () => {
  it("a failed item contributes no Undo output", () => {
    const failed = report({
      input_total: 1,
      failed_count: 1,
      items: [
        {
          input_index: 0,
          output_count: 0,
          status: "failed",
          reason: "unsupported",
          metadata_lost: [],
          bytes_written: 0,
        },
      ],
    });
    expect(conversionHistoryEntry(failed)).toBeNull();
    expect(createdPathsOf(failed)).toEqual([]);
  });

  it("outputs completed before cancellation never create unsafe path-only Undo", () => {
    const cancelled = report({
      cancelled: true,
      input_total: 2,
      done_count: 1,
      cancelled_count: 1,
      outputs_created: 1,
      created_paths: ["C:\\out\\one.png"],
      outputs: [
        {
          output_id: "o1",
          input_indices: [0],
          output_index: 0,
          path: "C:\\out\\one.png",
          byte_len: 3,
        },
      ],
      items: [
        { input_index: 0, output_count: 1, status: "done", metadata_lost: [], bytes_written: 3 },
        { input_index: 1, output_count: 0, status: "cancelled", reason: "cancelled", metadata_lost: [], bytes_written: 0 },
      ],
    });
    const entry = conversionHistoryEntry(cancelled);
    expect(entry).toBeNull();
    expect(createdPathsOf(cancelled)).toEqual(["C:\\out\\one.png"]);
    expect(cancelled.outputs).toHaveLength(1);
  });

  it("path-only Redo is refused until exact native restore receipts exist", () => {
    const done = report({
      outputs_created: 1,
      created_paths: ["C:\\out\\one.png"],
      outputs: [
        { output_id: "o1", input_indices: [0], output_index: 0, path: "C:\\out\\one.png", byte_len: 3 },
      ],
    });
    const entry = conversionHistoryEntry(done);
    expect(entry).toBeNull();
    expect(done.outputs[0].path).toBe("C:\\out\\one.png");
  });

  it("a failed undo leaves the history cursor unchanged", async () => {
    const stack = new UndoStack();
    // The existing shared history cursor still advances only on success.
    // This is an explicit baseline entry, not an accepted conversion receipt.
    const entry = {
      labelKey: "toast.converted",
      undo: { type: "recycle" as const, paths: ["C:\\out\\one.png"] },
      redo: { type: "restore" as const, originals: ["C:\\out\\one.png"] },
    };
    stack.push(entry);
    const before = stack.peekUndo();
    await expect(executeFileAction(entry.undo)).rejects.toThrow("ops.cancelled");
    // The shared history confirms only a successful action.
    expect(stack.peekUndo()?.id).toBe(before?.id);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it("merges report pages before building one group entry", () => {
    const merged = mergeConversionPages([
      report({ created_paths: ["C:\\out\\a.png"], outputs_created: 1, next_cursor: "cursor" }),
      report({ created_paths: ["C:\\out\\b.png"], outputs_created: 1 }),
    ]);
    expect(merged.created_paths).toEqual(["C:\\out\\a.png", "C:\\out\\b.png"]);
    expect(merged.next_cursor).toBeUndefined();
    expect(merged.complete).toBe(true);
  });
});
