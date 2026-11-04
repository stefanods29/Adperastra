import { describe, expect, it } from "vitest";
import { nextSheetName, validSheetName } from "../office/sheet/SheetStructureDialogs";
describe("sheet names", () => {
  it("rename invalid and duplicate case fails", () => {
    for (const name of ["", "a".repeat(32), "a:b", "a/b", "a\\b", "a?b", "a*b", "a[b", "a]b"]) expect(validSheetName(name, [])).toBe(false);
    expect(validSheetName("DATA", ["Data", "Resumen"])).toBe(false);
    expect(validSheetName("DATA", ["Data", "Resumen"], "Data")).toBe(true);
  });
  it("new localized name uses lowest free positive index", () => {
    expect(nextSheetName(["Hoja 1", "Hoja 3"], (index) => `Hoja ${index}`)).toBe("Hoja 2");
  });
});
