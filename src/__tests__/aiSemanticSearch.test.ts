import { describe, expect, it, vi } from "vitest";
import type { SemanticHit } from "../services/aiSearchTypes";
import {
  planSemanticBatch,
  rankSemanticVectors,
  SemanticRevisionGate,
  SensitiveSemanticLease,
  splitTextChunks,
} from "../search/ai/semanticAdapter";

const input = {
  kind: "document" as const,
  id: "33333333-3333-4333-8333-333333333333",
  expected_revision: 1,
};

describe("semantic retrieval", () => {
  it("semantic_dot_product_order", () => {
    const ranked = rankSemanticVectors([1, 0], [
      { id: "A", key: "a", vector: [1, 0], chunk_index: 0 },
      { id: "B", key: "b", vector: [0, 1], chunk_index: 0 },
    ]);
    expect(ranked.map((hit) => hit.id)).toEqual(["A", "B"]);
    expect(ranked[0].score).toBe(1);
    expect(ranked[1].score).toBe(0);
  });

  it("semantic_chunks_overlap", () => {
    const split = splitTextChunks("a".repeat(448));
    expect(split.chunks.map((chunk) => [chunk.start, chunk.end])).toEqual([
      [0, 384],
      [320, 448],
    ]);
    expect(split.partial).toBe(false);
  });

  it("semantic_cloud_skip", () => {
    const open = vi.fn();
    const plan = planSemanticBatch(
      [
        { id: "cloud", onlineOnly: true, sensitive: false },
        { id: "local", onlineOnly: false, sensitive: false },
      ],
      open,
    );
    expect(plan.skipped).toEqual(["cloud"]);
    expect(plan.eligible).toEqual(["local"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("local");
  });

  it("semantic_cancel_stale", () => {
    const gate = new SemanticRevisionGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.accept(first)).toBe(false);
    expect(gate.accept(second)).toBe(true);
    gate.cancel();
    expect(gate.accept(second)).toBe(false);
  });

  it("semantic_sensitive_lock", () => {
    const lease = new SensitiveSemanticLease(input);
    lease.put([{} as SemanticHit]);
    expect(lease.results()).toHaveLength(1);
    lease.lock();
    expect(lease.active).toBe(false);
    expect(lease.results()).toEqual([]);
  });
});
