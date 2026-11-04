import { describe, expect, it, vi } from "vitest";
import { search, type SearchQuery } from "../services/search";
import type { NaturalQueryRequest } from "../services/aiSearchTypes";
import {
  buildNaturalQueryPreview,
  confirmNaturalQuery,
  resolveRelativeDate,
} from "../search/ai/naturalQuery";

vi.mock("../services/search", () => ({
  search: vi.fn(async () => ({
    id: "mock",
    cancel: async () => undefined,
    completion: Promise.resolve({
      results: [],
      next_cursor: null,
      generation: 1,
      total_estimate: 0,
      total_exact: true,
      complete: true,
      coverage: "complete",
      skipped_count: 0,
    }),
  })),
}));

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";
const NOV_2_2026 = 1_793_577_600;

const request: NaturalQueryRequest = {
  text: "Maria's October PDF invoices",
  root_ids: [ROOT_A],
  now_unix: NOV_2_2026,
  timezone: "UTC",
  locale: "en",
  request_revision: 1,
};

const ready = (filter: unknown, roots = [ROOT_A]) => ({
  status: "ready",
  query: {
    text: "",
    roots,
    filter,
    sort: { key: "modified", direction: "descending" },
  },
  explanation: "PDF invoices from October.",
  unsupported: [],
});

describe("natural-language filters", () => {
  it("natural_query_preview_precedes_search", async () => {
    const result = buildNaturalQueryPreview(
      ready({ kind: "string", field: "ext", op: "eq", value: "pdf" }),
      request,
      [ROOT_A],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(search).not.toHaveBeenCalled();
    const edited = result.preview.query as SearchQuery;
    await confirmNaturalQuery(result.preview, edited);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(edited);
  });

  it("natural_query_last_month", () => {
    expect(resolveRelativeDate("last_month", NOV_2_2026, "UTC")).toEqual({
      from_unix: 1_790_812_800,
      to_unix: 1_793_491_199,
    });
  });

  it("natural_query_five_mib", () => {
    const result = buildNaturalQueryPreview(
      ready({ kind: "number", field: "size", op: "gt", value: 5, unit: "MiB" }),
      request,
      [ROOT_A],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.query?.filter).toEqual({
      kind: "number",
      field: "size",
      op: "gte",
      value: 5_242_881,
    });
  });

  it("natural_query_unsupported", () => {
    const result = buildNaturalQueryPreview(
      {
        status: "clarify",
        query: null,
        explanation: "Sending files by email is not a search.",
        unsupported: ["email"],
      },
      { ...request, text: "email these files" },
      [ROOT_A],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.status).toBe("clarify");
    expect(result.preview.query).toBeNull();
  });

  it("natural_query_roots_tamper", () => {
    const result = buildNaturalQueryPreview(
      ready({ kind: "string", field: "ext", op: "eq", value: "pdf" }, [ROOT_B]),
      request,
      [ROOT_A],
    );
    expect(result).toEqual({ ok: false, code: "ai_search.denied" });
  });
});
