import { describe, expect, it } from "vitest";
import { exportSettings, importSettings, isoDate } from "../services/settingsFile";

describe("settings file", () => {
  it("isoDate pads month and day", () => {
    expect(isoDate(new Date(2026, 2, 7))).toBe("2026-03-07");
  });

  it("export and import do nothing outside the app", async () => {
    await expect(exportSettings("Export", "s.json", "Settings")).resolves.toBeNull();
    await expect(importSettings("Import", "Settings")).resolves.toBeNull();
  });
});
