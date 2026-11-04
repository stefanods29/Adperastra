import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const pages = ["storage-view.md", "finding-duplicates.md", "folder-sizes.md"];

describe("step 11c help pages", () => {
  it("every page exists in both languages", () => {
    for (const page of pages) {
      expect(readFileSync(join(root, "help", "en", page), "utf8")).toContain("# ");
      expect(readFileSync(join(root, "help", "es", page), "utf8")).toContain("# ");
    }
  });

  it("the storage page explains partial, cloud and hard-link limits", () => {
    const text = readFileSync(join(root, "help", "en", "storage-view.md"), "utf8");
    expect(text).toContain("Incomplete scans show partial totals.");
    expect(text).toContain("Online-only files are counted without downloading.");
    expect(text).toContain("Hard links can have several names but share allocated space.");
    expect(text).toContain('See also: "Finding duplicates" and "Folder sizes".');
  });

  it("the duplicate page does not claim cleanup is available", () => {
    const text = readFileSync(join(root, "help", "en", "finding-duplicates.md"), "utf8");
    expect(text).toContain("Nothing is selected for removal automatically.");
    expect(text).toContain("At least one verified copy must stay.");
    expect(text).toContain("Cleanup is unavailable");
    expect(text.toLowerCase()).not.toContain("cleanup is available");
  });

  it("the folder-size page explains at-least and no download", () => {
    const text = readFileSync(join(root, "help", "en", "folder-sizes.md"), "utf8");
    expect(text).toContain("Partial values say At least.");
    expect(text).toContain("Online-only content is not downloaded.");
    expect(text).toContain("Network folders require their own opt-in.");
  });

  it("the Spanish pages use the glossary words", () => {
    const duplicate = readFileSync(
      join(root, "help", "es", "finding-duplicates.md"),
      "utf8",
    );
    expect(duplicate).toContain("Papelera");
    expect(duplicate).toContain("Debe quedar una copia verificada.");
    const sizes = readFileSync(join(root, "help", "es", "folder-sizes.md"), "utf8");
    expect(sizes).toContain("Como mínimo");
  });
});
