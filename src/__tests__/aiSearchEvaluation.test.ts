import { describe, expect, it } from "vitest";
import {
  ndcgAt10,
  queryAstEquivalent,
  scoreSortCases,
  type SortCase,
} from "../../tests/ai/suites/aiSearchEvaluation";

const ROOT = "11111111-1111-4111-8111-111111111111";

describe("AI search evaluation", () => {
  it("relevance_hand_oracle", () => {
    expect(ndcgAt10([1])).toBe(1);
    expect(ndcgAt10([0, 1])).toBeCloseTo(1 / Math.log2(3), 12);
    expect(ndcgAt10([0, 1])).toBeLessThan(ndcgAt10([1]));
  });

  it("query_ast_scoring_order", () => {
    const left = {
      mode: "filters",
      text: "",
      roots: [ROOT],
      filter: {
        kind: "all",
        clauses: [
          { kind: "string", field: "ext", op: "eq", value: "pdf" },
          { kind: "number", field: "size", op: "gte", value: 5242881 },
        ],
      },
      regex_scope: "name",
      match_case: false,
      sort: { key: "name", direction: "ascending" },
    };
    const reversed = {
      ...left,
      filter: { kind: "all", clauses: [...left.filter.clauses].reverse() },
    };
    expect(queryAstEquivalent(left, reversed)).toBe(true);
    const changedOperator = {
      ...left,
      filter: {
        kind: "all",
        clauses: [
          { kind: "string", field: "ext", op: "eq", value: "pdf" },
          { kind: "number", field: "size", op: "lte", value: 5242881 },
        ],
      },
    };
    expect(queryAstEquivalent(left, changedOperator)).toBe(false);
  });

  it("sort_unsafe_zero_tolerance", () => {
    const cases: SortCase[] = [
      {
        id: "s1",
        locale: "en",
        extension: "jpg",
        destination_ids: ["a", "b"],
        history: [
          { destination_id: "a", count: 4 },
          { destination_id: "b", count: 0 },
        ],
        disabled: [],
        expected_destination: "a",
      },
    ];
    const safe = scoreSortCases(cases, new Map([["s1", { destination_id: "a", automatic_moves: 0 }]]));
    expect(safe.passed).toBe(true);
    const unsafe = scoreSortCases(cases, new Map([["s1", { destination_id: "a", automatic_moves: 1 }]]));
    expect(unsafe.passed).toBe(false);
    expect(unsafe.automatic_moves).toBe(1);
  });
});
