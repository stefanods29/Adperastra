import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { describe, expect, it } from "vitest";

const slugs = ["editing-spreadsheets", "spreadsheet-formulas", "spreadsheet-formatting", "spreadsheet-charts", "spreadsheet-pivots", "spreadsheet-sort-filter"];
describe("spreadsheet help", () => {
  it("all help pages in English and Spanish", () => {
    for (const locale of ["en", "es"]) for (const slug of slugs) {
      const page = readFileSync(repoUrl(`../../help/${locale}/${slug}.md`, import.meta.url), "utf8");
      expect(page).toMatch(/^# .+/);
      expect(page).toContain(locale === "en" ? "## How to use" : "## Cómo usar");
      expect(page).toContain(locale === "en" ? "## Good to know" : "## Para tener en cuenta");
      expect(page).toContain(locale === "en" ? "See also:" : "Consulta también:");
    }
  });
  it("formula clipboard and network limits disclosed in both languages", () => {
    expect(readFileSync(repoUrl("../../help/en/spreadsheet-formulas.md", import.meta.url), "utf8")).toContain("clipboard text stays text");
    expect(readFileSync(repoUrl("../../help/es/spreadsheet-formulas.md", import.meta.url), "utf8")).toContain("se conserva como texto");
    expect(readFileSync(repoUrl("../../help/en/editing-spreadsheets.md", import.meta.url), "utf8")).toContain("External connections and macros do not run");
    expect(readFileSync(repoUrl("../../help/es/editing-spreadsheets.md", import.meta.url), "utf8")).toContain("No se ejecutan conexiones externas ni macros");
  });
});