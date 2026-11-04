import { describe, expect, it } from "vitest";
import { levelKey } from "../handlers/log/LogView";

describe("log display", () => {
  it("every level has a text label, including none", () => {
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal", "none"] as const) {
      expect(levelKey(level)).toBe(`log.level_${level}`);
    }
  });
});
