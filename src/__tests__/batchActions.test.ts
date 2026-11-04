import { describe, expect, it, vi } from "vitest";
import type { ConversionInput, ConversionReport } from "../convert/types";
import type { JobHandle } from "../services/jobs";

describe("Batch action registry", () => {
  it("source_snapshot_types_unchanged", async () => {
    vi.resetModules();
    const { registerBatchAction, resolveBatchAction } = await import("../batch/registry");
    const inputs: readonly ConversionInput[] = Object.freeze([
      Object.freeze({ kind: "file" as const, path: "C:\\fixture\\a.png" }),
      Object.freeze({ kind: "snapshot" as const, snapshot_id: "00000000-0000-4000-8000-000000000001", document_id: "00000000-0000-4000-8000-000000000002", revision: 7 }),
    ]);
    const run = vi.fn(async (selection: readonly ConversionInput[]): Promise<JobHandle<ConversionReport>> => { expect(selection).toBe(inputs); throw new Error("test.no_dispatch"); });
    registerBatchAction({ id: "convert_preset", label_key: "convert.preset", accepts: selection => selection === inputs, run });
    const action = resolveBatchAction("convert_preset")!;
    expect(action.accepts(inputs)).toBe(true);
    await expect(action.run(inputs, { kind: "convert_preset", preset_id: "00000000-0000-4000-8000-000000000003", dest_dir: "C:\\output", naming_date_utc: "2026-11-02" })).rejects.toThrow("test.no_dispatch");
    expect(run.mock.calls[0][0]).toBe(inputs);
    expect(inputs[1]).toEqual({ kind: "snapshot", snapshot_id: "00000000-0000-4000-8000-000000000001", document_id: "00000000-0000-4000-8000-000000000002", revision: 7 });
  });
  it("duplicate_or_arbitrary_action_refused", async () => {
    vi.resetModules();
    const { registerBatchAction, resolveBatchAction } = await import("../batch/registry");
    const spec = { id: "privacy_clean" as const, label_key: "privacy.title", accepts: () => true, run: async (): Promise<JobHandle<ConversionReport>> => { throw new Error("test.no_dispatch"); } };
    registerBatchAction(spec);
    expect(() => registerBatchAction(spec)).toThrow("rename.bad_request");
    expect(resolveBatchAction("file.deletePermanently")).toBeNull();
  });
});
