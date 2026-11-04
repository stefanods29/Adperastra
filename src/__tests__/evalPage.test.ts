import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { evalPage, runEvalSuite } from "../services/aiEval";
import {
  AI_EVAL_DEFAULT_PAGE,
  validateEvalPage,
  type AiEvalPage,
} from "../services/aiEvalValidation";

const mockedInvoke = vi.mocked(invoke);

const row = {
  id: "asst-en-001",
  feature: "assistant.reply",
  locale: "en",
  tool_id: null,
  must_refuse: false,
  must_warn: false,
  forbidden_effects: ["network"],
  valid: true,
};

const page = {
  suite_id: "assistant-en",
  offset: 0,
  limit: 1,
  total: 100,
  next_offset: 1,
  notrun: true,
  cases: [row],
} as unknown as AiEvalPage;

afterEach(() => {
  mockedInvoke.mockReset();
});

describe("evalPage", () => {
  it("returns a bounded page and keeps notrun explicit", async () => {
    mockedInvoke.mockResolvedValueOnce(page);
    const result = await evalPage("assistant-en");
    expect(mockedInvoke).toHaveBeenCalledWith("ai_eval_page", {
      suiteId: "assistant-en",
      offset: 0,
      limit: AI_EVAL_DEFAULT_PAGE,
    });
    expect(result.notrun).toBe(true);
    expect(result.next_offset).toBe(1);
    expect(result.cases).toHaveLength(1);
  });

  it("normalizes a zero limit to the native default", async () => {
    mockedInvoke.mockResolvedValueOnce(page);
    await evalPage("assistant-en", 0, 0);
    expect(mockedInvoke).toHaveBeenCalledWith("ai_eval_page", {
      suiteId: "assistant-en",
      offset: 0,
      limit: AI_EVAL_DEFAULT_PAGE,
    });
  });

  it("refuses a page that claims a model run", async () => {
    mockedInvoke.mockResolvedValueOnce({ ...page, notrun: false });
    await expect(evalPage("assistant-en")).rejects.toThrow("ai_eval.page_invalid");
  });

  it("refuses a page whose bounds or cursor disagree", async () => {
    mockedInvoke.mockResolvedValueOnce({ ...page, offset: 101 });
    await expect(evalPage("assistant-en")).rejects.toThrow("ai_eval.page_invalid");
    mockedInvoke.mockResolvedValueOnce({ ...page, next_offset: null });
    await expect(evalPage("assistant-en")).rejects.toThrow("ai_eval.page_invalid");
  });

  it("refuses an unknown suite before calling the backend", async () => {
    await expect(evalPage("assistant-xx")).rejects.toThrow("ai_eval.unknown_suite");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("validateEvalPage", () => {
  it("refuses unknown effects and duplicate case ids", () => {
    expect(() =>
      validateEvalPage({ ...page, cases: [{ ...row, forbidden_effects: ["teleport"] }] }),
    ).toThrow("ai_eval.page_invalid");
    expect(() =>
      validateEvalPage({
        ...page,
        limit: 2,
        total: 2,
        next_offset: null,
        cases: [row, row],
      }),
    ).toThrow("ai_eval.page_invalid");
  });

  it("refuses missing notrun instead of assuming it", () => {
    expect(() =>
      validateEvalPage({
        suite_id: page.suite_id,
        offset: page.offset,
        limit: page.limit,
        total: page.total,
        next_offset: page.next_offset,
        cases: page.cases,
      }),
    ).toThrow("ai_eval.page_invalid");
  });
});

describe("runEvalSuite", () => {
  it("refuses an unknown suite before starting a job", async () => {
    await expect(runEvalSuite("assistant-xx")).rejects.toThrow("ai_eval.unknown_suite");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
