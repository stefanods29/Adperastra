import { describe, expect, it } from "vitest";
import {
  chooseOcrLanguage,
  isValidOcrLanguageTag,
  normalizeOcrLanguagePreference,
  normalizeOcrLanguages,
  OCR_MAX_LANGUAGES,
  type OcrLanguage,
} from "../services/ocr";

function language(tag: string, name: string): OcrLanguage {
  return { tag, name, available: true };
}

const installed = [
  language("en-US", "English (United States)"),
  language("es-ES", "Spanish (Spain)"),
];

describe("OCR language rules", () => {
  it("accepts BCP47-shaped tags and refuses everything else", () => {
    expect(isValidOcrLanguageTag("en")).toBe(true);
    expect(isValidOcrLanguageTag("en-US")).toBe(true);
    expect(isValidOcrLanguageTag("es-419")).toBe(true);
    expect(isValidOcrLanguageTag("zh-Hant-TW")).toBe(true);
    expect(isValidOcrLanguageTag("")).toBe(false);
    expect(isValidOcrLanguageTag("en--US")).toBe(false);
    expect(isValidOcrLanguageTag("en_US")).toBe(false);
    expect(isValidOcrLanguageTag("en-")).toBe(false);
    expect(isValidOcrLanguageTag("a".repeat(65))).toBe(false);
    expect(isValidOcrLanguageTag(42)).toBe(false);
  });

  it("falls back to auto for an invalid preference", () => {
    expect(normalizeOcrLanguagePreference("es-ES")).toBe("es-ES");
    expect(normalizeOcrLanguagePreference("not a tag!")).toBe("auto");
    expect(normalizeOcrLanguagePreference(null)).toBe("auto");
  });

  it("uses the app language for auto", () => {
    expect(chooseOcrLanguage("auto", "es", installed)).toBe("es-ES");
    expect(chooseOcrLanguage("auto", "en", installed)).toBe("en-US");
  });

  it("never switches to an unrelated installed language", () => {
    expect(chooseOcrLanguage("auto", "en", [language("es-ES", "Spanish")])).toBeNull();
    expect(
      chooseOcrLanguage("auto", "en", [language("es-ES", "Spanish")], "es-ES"),
    ).toBeNull();
    expect(chooseOcrLanguage("auto", "pseudo", installed)).toBeNull();
  });

  it("accepts a same-language profile region", () => {
    expect(
      chooseOcrLanguage(
        "auto",
        "en",
        [language("en-GB", "English (United Kingdom)"), language("es-ES", "Spanish")],
        "en-US",
      ),
    ).toBe("en-GB");
  });

  it("requires an explicit tag to be installed", () => {
    expect(chooseOcrLanguage("EN-us", "en", installed)).toBe("en-US");
    expect(chooseOcrLanguage("fr-FR", "en", installed)).toBeNull();
    expect(chooseOcrLanguage("not a tag!", "en", installed)).toBeNull();
  });

  it("bounds and deduplicates the Windows list", () => {
    const many: OcrLanguage[] = [
      language(" en-US ", "English"),
      language("EN-us", "duplicate"),
      language("bad tag", "bad"),
    ];
    for (let index = 0; index < 200; index += 1) {
      // Letters only: a primary language subtag can never contain digits.
      const first = String.fromCharCode(97 + (index % 26));
      const second = String.fromCharCode(97 + Math.floor(index / 26));
      many.push(language(`l${first}${second}`, "x"));
    }
    const cleaned = normalizeOcrLanguages(many);
    expect(cleaned.length).toBeLessThanOrEqual(OCR_MAX_LANGUAGES);
    expect(cleaned.filter((entry) => entry.tag.toLowerCase() === "en-us")).toHaveLength(1);
    expect(cleaned.some((entry) => entry.tag === "bad tag")).toBe(false);
    expect(normalizeOcrLanguages(null)).toEqual([]);
  });
});
