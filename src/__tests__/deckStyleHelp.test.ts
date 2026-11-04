import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import { DECK_STYLE_LAYOUT_ORDER } from "../office/deck/styles/styleLayouts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function localeValue(language: "en" | "es", key: string): string | undefined {
  const json = JSON.parse(read(`src/i18n/locales/${language}.json`)) as Record<string, unknown>;
  // i18next joins the shortest remaining dotted segment at each level and
  // keeps looking when that value is a string with segments left (the
  // built-in style names use `deckStyle.name.<suffix>` with a dot).
  let current: unknown = json;
  const tokens = key.split(".");
  let index = 0;
  while (index < tokens.length) {
    if (current === null || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    let found: unknown;
    let consumed = 0;
    for (let end = index; end < tokens.length; end += 1) {
      const segment = tokens.slice(index, end + 1).join(".");
      if (!Object.prototype.hasOwnProperty.call(record, segment)) continue;
      found = record[segment];
      consumed = end - index + 1;
      if (typeof found === "string" && end < tokens.length - 1) continue;
      break;
    }
    if (consumed === 0) return undefined;
    current = found;
    index += consumed;
  }
  return typeof current === "string" ? current : undefined;
}

function importStatements(path: string): string {
  return read(path)
    .split("\n")
    .filter((line) => line.trimStart().startsWith("import "))
    .join("\n");
}

describe("manual deck style help", () => {
  it("documents all eight style names and layouts in both languages", () => {
    for (const style of BUILTIN_DECK_STYLES) {
      for (const key of [style.name_key, style.description_key, style.guidance.advice_key]) {
        expect(key).not.toBeNull();
        expect(localeValue("en", key ?? "")).toBeTruthy();
        expect(localeValue("es", key ?? "")).toBeTruthy();
      }
    }
    for (const kind of DECK_STYLE_LAYOUT_ORDER) {
      expect(localeValue("en", `deckStyle.layout.${kind}`)).toBeTruthy();
      expect(localeValue("es", `deckStyle.layout.${kind}`)).toBeTruthy();
    }
    expect(localeValue("en", "deckStyle.guidance")).toContain("{bullets}");
    expect(localeValue("es", "deckStyle.guidance")).toContain("{words}");
  });

  it("keeps the import help honest about template content", () => {
    const en = read("help/en/deck-importing-styles.md");
    const es = read("help/es/deck-importing-styles.md");
    expect(en).toContain("Template text, notes, images, macros and active content are not imported.");
    expect(es).toContain("No se importan texto, notas, imágenes, macros ni contenido activo de la plantilla.");
    expect(en).not.toContain("training data");
    expect(es).not.toContain("datos de entrenamiento");
  });

  it("works without the AI assistant and without any AI import", () => {
    for (const path of [
      "src/office/deck/styles/DeckStyleLibrary.tsx",
      "src/office/deck/styles/styleApplication.ts",
      "src/office/deck/styles/styleImport.ts",
      "src/services/deckStyles.ts",
    ]) {
      const imports = importStatements(path);
      expect(imports).not.toContain("assistant");
      expect(imports).not.toContain("deckAi");
      expect(imports).not.toContain("localAi");
    }
  });

  it("does not mark v1.0 or step 22b complete without evidence", () => {
    const status = read("plan/STATUS.md");
    const row = status.split("\n").find((line) => line.startsWith("| 22b |"));
    expect(row).toBeDefined();
    expect(row).not.toContain("| done |");
    expect(status).not.toContain("Step 22b is on main");
    expect(status).not.toContain("v1.0.0 released");
  });
});
