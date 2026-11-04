import { describe, expect, it } from "vitest";
import { formatCustomDatePattern } from "../services/customDatePattern";
import {
  defaultFormatOptions,
  displayFileName,
  formatDateWithOptions,
} from "../services/displayFormats";
import { splitGraphemes } from "../services/nameDisplay";

const NOW = 1_800_000_000;

function relativeOptions() {
  return { ...defaultFormatOptions(), date_style: "relative" as const };
}

describe("relative dates", () => {
  it("uses now below one minute, then minutes, hours and days", () => {
    const options = relativeOptions();
    expect(formatDateWithOptions(NOW - 59, "en", options, NOW)).toBe("now");
    expect(formatDateWithOptions(NOW - 60, "en", options, NOW)).toBe("1 minute ago");
    expect(formatDateWithOptions(NOW - 3600, "en", options, NOW)).toBe("1 hour ago");
    expect(formatDateWithOptions(NOW - 86400, "en", options, NOW)).toBe("1 day ago");
  });

  it("keeps future dates positive", () => {
    const options = relativeOptions();
    expect(formatDateWithOptions(NOW + 3600, "en", options, NOW)).toBe("in 1 hour");
    expect(formatDateWithOptions(NOW + 120, "en", options, NOW)).toBe("in 2 minutes");
  });
});

describe("file names", () => {
  const family = "👩‍👩‍👧‍👦";

  it("never splits an emoji grapheme in the middle", () => {
    const name = `${family.repeat(10)}.txt`;
    const result = displayFileName(name, "txt", true, {
      ...defaultFormatOptions(),
      name_truncation: "middle",
    }, 12);
    expect(result.display.endsWith(".txt")).toBe(true);
    expect(result.display.includes("…")).toBe(true);
    expect(result.full).toBe(name);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(result.display)).toBe(false);
    const inputParts = new Set(splitGraphemes(name));
    for (const part of splitGraphemes(result.display)) {
      expect(part === "…" || inputParts.has(part)).toBe(true);
    }
  });

  it("keeps the final extension when truncating in the middle", () => {
    const name = "quarterly-report-2026-draft.txt";
    const result = displayFileName(name, "txt", true, {
      ...defaultFormatOptions(),
      name_truncation: "middle",
    }, 20);
    expect(result.display.endsWith(".txt")).toBe(true);
    expect(result.display.includes("…")).toBe(true);
    expect(result.full).toBe(name);
  });

  it("removes only the extension from the display when extensions are hidden", () => {
    const result = displayFileName("quarterly-report-2026-draft.txt", "txt", false, defaultFormatOptions(), 20);
    expect(result.display.endsWith(".txt")).toBe(false);
    expect(result.full).toBe("quarterly-report-2026-draft.txt");
  });

  it("uses an extension override over the global setting", () => {
    const options = { ...defaultFormatOptions(), extension_overrides: { txt: false } };
    expect(displayFileName("report.txt", "txt", true, options).display).toBe("report");
  });
});

describe("absolute and custom dates", () => {
  it("keeps the legacy blank for Unix time zero", () => {
    expect(formatDateWithOptions(0, "en", defaultFormatOptions(), NOW)).toBe("");
    expect(formatDateWithOptions(0, "en", defaultFormatOptions(true), NOW)).toBe("");
  });

  it("formats an absolute short date and the allowed custom fields", () => {
    const date = new Date(2026, 10, 1, 13, 5, 9);
    expect(formatCustomDatePattern("YYYY-MM-DD HH:mm:ss", date, "en")).toBe("2026-11-01 13:05:09");
    expect(formatCustomDatePattern("hh:mm A", date, "en")).toBe("01:05 PM");
    expect(formatCustomDatePattern("DD.MM.YYYY", date, "en")).toBe("01.11.2026");
  });
});
