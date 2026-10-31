import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The files `npm run templates` writes for each language (Step 06c). */
const BUILTIN_FILES = [
  "letter.docx",
  "report.docx",
  "budget.xlsx",
  "invoice.xlsx",
  "meeting-notes.md",
  "presentation.pptx",
];

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

describe("built-in templates", () => {
  it("every built-in template exists in both languages", () => {
    for (const lang of ["en", "es"]) {
      for (const file of BUILTIN_FILES) {
        expect(sizeOf(join(root, "templates", "builtin", lang, file)), `${lang}/${file}`).toBeGreaterThan(0);
      }
    }
    for (const file of ["blank.docx", "blank.xlsx", "blank.pptx"]) {
      expect(sizeOf(join(root, "templates", "blank", file)), file).toBeGreaterThan(0);
    }
  });

  it("the Markdown template uses the translations", () => {
    const notes = readFileSync(join(root, "templates", "builtin", "es", "meeting-notes.md"), "utf8");
    expect(notes.startsWith("# Notas de la reunión")).toBe(true);
  });
});
