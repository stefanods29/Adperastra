import { describe, expect, it } from "vitest";
import {
  extraViewKindFor,
  MAX_PAGE_BYTES,
  MAX_PAGE_RECORDS,
  takePage,
  validateExtraPageRequest,
  validateExtraViewKind,
  type ExtraPageRequest,
} from "../services/extraViews";
import { normalizeSettings } from "../services/settings";

const sessionId = "6f2e6a8e-4a4e-4f56-8f0b-2f3f6f4f7a10";

describe("extra viewer contracts", () => {
  it("rejects an unknown kind", () => {
    expect(() => validateExtraViewKind("video")).toThrowError("extra_view.bad_request");
    expect(validateExtraViewKind("book")).toBe("book");
  });

  it("splits a page over 768 KiB with a continuation", () => {
    const item = (id: number) => ({ id, bytes: 300 * 1024 });
    const { items, rest } = takePage([item(1), item(2), item(3)], (value) => value.bytes);
    expect(items.map((value) => value.id)).toEqual([1, 2]);
    expect(rest.map((value) => value.id)).toEqual([3]);
    expect(items.reduce((sum, value) => sum + value.bytes, 0)).toBeLessThanOrEqual(MAX_PAGE_BYTES);
  });

  it("stops a page at 256 records even when the bytes fit", () => {
    const records = Array.from({ length: MAX_PAGE_RECORDS + 1 }, (_, index) => index);
    const { items, rest } = takePage(records, () => 1);
    expect(items).toHaveLength(MAX_PAGE_RECORDS);
    expect(rest).toEqual([MAX_PAGE_RECORDS]);
  });

  it("keeps one oversized record on its own page instead of looping", () => {
    const { items, rest } = takePage([MAX_PAGE_BYTES + 1, 1, 2], (value) => value);
    expect(items).toEqual([MAX_PAGE_BYTES + 1]);
    expect(rest).toEqual([1, 2]);
  });

  it("refuses a cursor that is not a UUID", () => {
    const request: ExtraPageRequest = { session_id: sessionId, cursor: "../../secret" };
    expect(() => validateExtraPageRequest(request, "notebook")).toThrowError(
      "extra_view.bad_request",
    );
  });

  it("refuses SQLite fields on a notebook page", () => {
    const request: ExtraPageRequest = {
      session_id: sessionId,
      table: "t",
      sort_column: 0,
      sort_direction: "asc",
    };
    expect(() => validateExtraPageRequest(request, "notebook")).toThrowError(
      "extra_view.bad_request",
    );
    expect(validateExtraPageRequest(request, "sqlite").table).toBe("t");
  });

  it("keeps schema 14 language and dark theme and adds reading defaults", () => {
    const settings = normalizeSettings({
      schema_version: 14,
      language: "en",
      theme: { mode: "dark" },
    });
    expect(settings.schema_version).toBe(56);
    expect(settings.language).toBe("en");
    expect(settings.theme.mode).toBe("dark");
    expect(settings.reading).toEqual({ font_px: 18, theme: "app" });
  });

  it("does not claim a .db file whose content is not SQLite", () => {
    expect(extraViewKindFor({ ext: "db", mime: "application/octet-stream" })).toBeNull();
    expect(extraViewKindFor({ ext: "db", mime: "application/vnd.sqlite3" })).toBe("sqlite");
    expect(extraViewKindFor({ ext: "epub", mime: "application/octet-stream" })).toBe("book");
  });
});
