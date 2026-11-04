import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
describe("columns and palette help", () => {
  it("paired full pages and related page targets", () => {
    for (const language of ["en", "es"]) {
      for (const slug of ["folder-columns", "selecting-with-a-box", "command-palette"]) {
        const text = readFileSync(join(root, "help", language, `${slug}.md`), "utf8");
        expect(text).toMatch(/^# .+/u); expect(text.match(/^## /gmu)).toHaveLength(2);
        expect(text).toMatch(/See also:|Consulta también:/u);
      }
      for (const slug of ["view-modes", "file-details", "selecting-files", "saved-tab-groups"]) {
        expect(existsSync(join(root, "help", language, `${slug}.md`))).toBe(true);
      }
    }
  });
  it("the specified keyboard shortcuts related title resolves", () => {
    // Specification test: the final integrated page is Step 10b's
    // `keyboard-styles.md`, titled "Keyboard shortcuts and styles"; the
    // earlier working title "Keyboard shortcuts" was never a page of its own.
    const titles = readdirSync(join(root, "help", "en")).filter((name) => name.endsWith(".md")).map((name) =>
      readFileSync(join(root, "help", "en", name), "utf8").split(/\r?\n/u)[0]);
    expect(titles).toContain("# Keyboard shortcuts and styles");
  });
  it("English Spanish keys and ICU arguments match", () => {
    const en = JSON.parse(readFileSync(join(root, "src/i18n/locales/en.json"), "utf8"));
    const es = JSON.parse(readFileSync(join(root, "src/i18n/locales/es.json"), "utf8"));
    for (const area of ["columns", "palette"]) {
      expect(Object.keys(es[area]).sort()).toEqual(Object.keys(en[area]).sort());
      for (const key of Object.keys(en[area])) {
        const argumentsOf = (value: string) => [...value.matchAll(/\{([a-zA-Z_][a-zA-Z_0-9]*)[,}]/gu)].map((match) => match[1]).sort();
        expect(argumentsOf(es[area][key])).toEqual(argumentsOf(en[area][key]));
      }
    }
  });
});
