import { describe, expect, it } from "vitest";
import {
  defaultFormatOptions,
  displayFileName,
  formatSizeWithOptions,
  normalizeFormatOptions,
  validateFormatOptions,
} from "../services/displayFormats";

describe("display format options", () => {
  it("formats 1000 bytes as 1 KB with decimal units", () => {
    const options = { ...defaultFormatOptions(), size_base: "decimal" as const };
    expect(formatSizeWithOptions(1000, "en", options)).toBe("1 KB");
  });

  it("formats 1536 bytes as 1.5 KiB with binary units", () => {
    const options = { ...defaultFormatOptions(), size_base: "binary" as const };
    expect(formatSizeWithOptions(1536, "en", options)).toBe("1.5 KiB");
  });

  it("keeps the legacy labels when no options are given", () => {
    expect(formatSizeWithOptions(1536, "en")).toBe("1.5 KB");
    expect(formatSizeWithOptions(1536, "en", { ...defaultFormatOptions(), size_base: "legacy" })).toBe(
      "1.5 KB",
    );
  });

  it("rejects an invalid custom date pattern", () => {
    const invalid = { ...defaultFormatOptions(), custom_date: "YYYY-MM-DDTHH:mm" };
    expect(validateFormatOptions(invalid)).toBe("preferences.invalid_format");
    expect(validateFormatOptions(defaultFormatOptions())).toBeNull();
  });

  it("migrates schema 29 to the legacy base and uses binary for a fresh profile", () => {
    const migrated = normalizeFormatOptions(undefined, true);
    expect(migrated.size_base).toBe("legacy");
    expect(defaultFormatOptions().size_base).toBe("binary");
    expect(normalizeFormatOptions({}, false).size_base).toBe("binary");
    expect(normalizeFormatOptions({ size_base: "decimal" }, true).size_base).toBe("decimal");
  });

  it("hides the final extension for display without changing the full name", () => {
    const result = displayFileName("report.txt", "txt", false, defaultFormatOptions());
    expect(result.display).toBe("report");
    expect(result.full).toBe("report.txt");
  });
});
