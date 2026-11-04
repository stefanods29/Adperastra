import { describe, expect, it } from "vitest";
import {
  nextSearchMode,
  parseSearchInput,
  SEARCH_MODE_CYCLE,
} from "../search/queryParsing";

describe("search prefix grammar", () => {
  it("selects each native mode and strips exactly one prefix", () => {
    expect(parseSearchInput("name:report", "name")).toEqual({
      mode: "name",
      text: "report",
      disabled_mode: null,
    });
    expect(parseSearchInput("text:alpha café", "name")).toEqual({
      mode: "content",
      text: "alpha café",
      disabled_mode: null,
    });
    expect(parseSearchInput("re:^report$", "name")).toEqual({
      mode: "regex",
      text: "^report$",
      disabled_mode: null,
    });
  });

  it("is case-insensitive and does not strip a second prefix", () => {
    expect(parseSearchInput("NAME:text:report", "name")).toEqual({
      mode: "name",
      text: "text:report",
      disabled_mode: null,
    });
  });

  it("returns no mode when the user did not type a prefix", () => {
    expect(parseSearchInput("report port", "content")).toEqual({
      mode: null,
      text: "report port",
      disabled_mode: null,
    });
  });

  it("marks ask, photo and similar as disabled without searching", () => {
    for (const prefix of ["ask", "photo", "similar"] as const) {
      expect(parseSearchInput(`${prefix}:a cat`, "name")).toEqual({
        mode: null,
        text: "a cat",
        disabled_mode: prefix,
      });
    }
  });

  it("cycles only the four native modes", () => {
    expect(nextSearchMode("name")).toBe("content");
    expect(nextSearchMode("content")).toBe("filters");
    expect(nextSearchMode("filters")).toBe("regex");
    expect(nextSearchMode("regex")).toBe("name");
    expect(SEARCH_MODE_CYCLE).toHaveLength(4);
  });
});
