import { describe, expect, it, vi } from "vitest";
import { isDocumentTextBoundary } from "../office/document/useDocumentSelection";
import { readDocumentStatistics } from "../office/document/documentStatistics";
vi.mock("../services/officeEdit", () => ({ readDocumentStatistics: vi.fn(async () => ({
  revision: 3, page: 1, page_count: 2, words: 3, characters: 14, language: "en",
})) }));

describe("document viewport adapters", () => {
  it("surrogate pair cannot split", () => {
    expect(isDocumentTextBoundary("A😀B", 1)).toBe(true);
    expect(isDocumentTextBoundary("A😀B", 2)).toBe(false);
    expect(isDocumentTextBoundary("A😀B", 3)).toBe(true);
    expect(isDocumentTextBoundary("A😀B", 5)).toBe(false);
  });
  it("status fixture3words14characters", async () => {
    expect(await readDocumentStatistics("session")).toEqual({
      revision: 3, page: 1, page_count: 2, words: 3, characters: 14, language: "en",
    });
    // Native Unicode counting is the 20a E13 integration test, not proved by this mock.
  });
});
