import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import bookEn from "../../help/en/reading-e-books.md?raw";
import bookEs from "../../help/es/reading-e-books.md?raw";
import notebookEn from "../../help/en/viewing-notebooks.md?raw";
import notebookEs from "../../help/es/viewing-notebooks.md?raw";
import emailEn from "../../help/en/viewing-email.md?raw";
import emailEs from "../../help/es/viewing-email.md?raw";
import subtitleEn from "../../help/en/viewing-subtitles.md?raw";
import subtitleEs from "../../help/es/viewing-subtitles.md?raw";
import logEn from "../../help/en/viewing-logs.md?raw";
import logEs from "../../help/es/viewing-logs.md?raw";
import sqliteEn from "../../help/en/viewing-sqlite.md?raw";
import sqliteEs from "../../help/es/viewing-sqlite.md?raw";

const pages = [
  ["reading-e-books", bookEn, bookEs],
  ["viewing-notebooks", notebookEn, notebookEs],
  ["viewing-email", emailEn, emailEs],
  ["viewing-subtitles", subtitleEn, subtitleEs],
  ["viewing-logs", logEn, logEs],
  ["viewing-sqlite", sqliteEn, sqliteEs],
] as const;

function flatKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatKeys(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function icuArguments(value: string): string[] {
  return [...value.matchAll(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[,}]/g)]
    .map((match) => match[1])
    .sort();
}

describe("extra viewer help and translations", () => {
  it("all six handlers have help", () => {
    expect(pages).toHaveLength(6);
    for (const [slug, english, spanish] of pages) {
      expect(english, slug).toContain("# ");
      expect(english.toLowerCase()).toContain("## how to use");
      expect(english.toLowerCase()).toContain("## good to know");
      expect(english).toContain("See also:");
      expect(spanish, slug).toContain("# ");
      expect(spanish.toLowerCase()).toContain("## cómo usar");
      expect(spanish.toLowerCase()).toContain("## para tener en cuenta");
      expect(spanish).toContain("Consulta también:");
    }
  });

  it("English and Spanish keys and ICU arguments match", () => {
    const englishKeys = flatKeys(en).sort();
    const spanishKeys = new Set(flatKeys(es));
    for (const key of englishKeys) expect(spanishKeys.has(key), `missing ${key}`).toBe(true);
    const read = (source: unknown, path: string): string => {
      let value: unknown = source;
      for (const part of path.split(".")) {
        value = (value as Record<string, unknown>)[part];
      }
      return value as string;
    };
    for (const key of englishKeys.filter((key) => key.startsWith("extra_view.") || key.startsWith("errors.extra_view."))) {
      expect(icuArguments(read(en, key)), key).toEqual(icuArguments(read(es, key)));
    }
  });

  it("every new handler label and help slug is present", () => {
    for (const id of ["book", "notebook", "email", "subtitle", "log", "sqlite"]) {
      expect((en as unknown as Record<string, Record<string, string>>).handlers[id]).toBeTruthy();
      expect((es as unknown as Record<string, Record<string, string>>).handlers[id]).toBeTruthy();
    }
  });
});
