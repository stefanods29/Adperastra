import { describe, expect, it } from "vitest";
import {
  effectiveStem,
  formatIndex,
  isValidUtcDate,
  normalizeSheetComponent,
  renderConversionName,
} from "../convert/naming";
import { CONVERSION_ADAPTERS_08B, adapterAcceptsOptions, extensionForConverter } from "../convert/adapters08b";
import type { ConvertOptions } from "../convert/types";

describe("conversion naming", () => {
  it("renders the exact guide oracle", () => {
    expect(renderConversionName("{stem}-{index}.{ext}", "photo", "jpg", 2, "2026-11-01")).toEqual({
      name: "photo-002.jpg",
    });
  });

  it("applies a page part before expanding the pattern once", () => {
    const stem = effectiveStem("photo", { kind: "page", page: 2 });
    expect(stem).toBe("photo-page-002");
    expect(renderConversionName("{stem}-{index}.{ext}", stem, "png", 1, "2026-11-01")).toEqual({
      name: "photo-page-002-001.png",
    });
  });

  it("normalizes a worksheet part before the pattern", () => {
    const stem = effectiveStem("book", { kind: "sheet", sheet: "A/B" });
    expect(stem).toBe("book-A_B");
    expect(renderConversionName("{stem}-{index}.{ext}", stem, "csv", 1, "2026-11-01")).toEqual({
      name: "book-A_B-001.csv",
    });
    expect(effectiveStem("book", { kind: "sheet", sheet: "Budget2026" })).toBe("book-Budget2026");
  });

  it("refuses an unknown token", () => {
    expect(renderConversionName("{stem}-{unknown}.{ext}", "photo", "jpg", 1, "2026-11-01")).toEqual({
      error: "convert.invalid_pattern",
    });
  });

  it("requires exactly one final extension token", () => {
    for (const pattern of ["{stem}.{ext}.{ext}", "{stem}-{ext}", "{stem}.{ext}-x"]) {
      expect(renderConversionName(pattern, "photo", "jpg", 1, "2026-11-01")).toEqual({
        error: "convert.invalid_pattern",
      });
    }
  });

  it("refuses invalid literal characters and reserved result names", () => {
    expect(renderConversionName("a:b.{ext}", "photo", "jpg", 1, "2026-11-01")).toEqual({
      error: "convert.invalid_pattern",
    });
    expect(renderConversionName("{stem}.{ext}", "CON", "txt", 1, "2026-11-01")).toEqual({
      error: "convert.invalid_pattern",
    });
  });

  it("validates UTC dates strictly", () => {
    expect(isValidUtcDate("2024-02-29")).toBe(true);
    expect(isValidUtcDate("2023-02-29")).toBe(false);
    expect(isValidUtcDate("2026-11-1")).toBe(false);
  });

  it("normalizes worksheet names for file-name use", () => {
    expect(normalizeSheetComponent("Budget2026")).toBe("Budget2026");
    expect(normalizeSheetComponent("A/B")).toBe("A_B");
    expect(normalizeSheetComponent("Name... ")).toBe("Name");
    expect(normalizeSheetComponent("   ")).toBe("sheet");
  });

  it("pads indexes to at least three digits", () => {
    expect(formatIndex(1)).toBe("001");
    expect(formatIndex(999)).toBe("999");
    expect(formatIndex(1000)).toBe("1000");
  });

  it("declares one identical option kind for every adapter", () => {
    const expected: Record<string, string> = {
      "images/pdf": "document",
      "pdf/png": "pdf",
      "pdf/jpeg": "pdf",
      "markdown/html": "document",
      "markdown/pdf": "document",
      "html/pdf": "document",
      "csv/xlsx": "table",
      "xlsx/csv": "table",
      "zip/seven_z": "archive",
      "seven_z/zip": "archive",
    };
    for (const spec of CONVERSION_ADAPTERS_08B) {
      expect(expected[spec.id]).toBeDefined();
      expect(extensionForConverter(spec.id)).not.toBeNull();
      expect(spec.help_slug).toBe("converting-files");
      const options = { kind: expected[spec.id], value: {} } as unknown as ConvertOptions;
      expect(adapterAcceptsOptions(spec.id, options)).toBe(true);
    }
  });
});
