import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("archive help pages", () => {
  it("both languages have the same archive pages", () => {
    const english = readdirSync(join(root, "help", "en")).sort();
    const spanish = readdirSync(join(root, "help", "es")).sort();
    expect(spanish).toEqual(english);
    expect(english).toContain("archives.md");
    expect(english).toContain("creating-archives.md");
    expect(english).toContain("archive-passwords.md");
  });

  it("the archives page no longer promises password or RAR support later", () => {
    for (const language of ["en", "es"]) {
      const text = readFileSync(join(root, "help", language, "archives.md"), "utf8");
      expect(text).not.toMatch(/can't be opened yet/i);
      expect(text).not.toMatch(/todavía no se puede abrir/i);
      expect(text.toLowerCase()).toMatch(/password|contraseña/);
      expect(text.toLowerCase()).toMatch(/rar/);
      expect(text.toLowerCase()).toMatch(/bz2|bzip2/);
    }
  });

  it("the creation page explains the limits honestly", () => {
    for (const [language, words] of [
      ["en", ["8 GB", "Recycle Bin", "Cancel", "ZipCrypto"]],
      ["es", ["8 GB", "Papelera", "Cancelar", "ZipCrypto"]],
    ] as const) {
      const text = readFileSync(join(root, "help", language, "creating-archives.md"), "utf8");
      for (const word of words) expect(text, `${language}: ${word}`).toContain(word);
    }
  });
});
