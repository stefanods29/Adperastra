import { describe, expect, it } from "vitest";
import i18n, { applyLanguage, htmlLang } from "../i18n";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pseudo from "../i18n/locales/pseudo.json";

function flattenKeys(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenKeys(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

describe("locale parity", () => {
  it("en and es have identical key sets", () => {
    expect([...flattenKeys(en)].sort()).toEqual([...flattenKeys(es)].sort());
  });

  it("pseudo covers at least every en key", () => {
    const pseudoKeys = flattenKeys(pseudo);
    for (const key of flattenKeys(en)) {
      expect(pseudoKeys.has(key), `pseudo is missing ${key}`).toBe(true);
    }
  });

  it("explorer.statusItems is an ICU plural in en and es", () => {
    expect(en.explorer.statusItems).toContain("plural");
    expect(es.explorer.statusItems).toContain("plural");
  });

  it("pseudo-locale ICU strings still format (no raw {count, plural} leaks)", async () => {
    await i18n.changeLanguage("pseudo");
    for (const key of ["jobs.copying", "jobs.skippedItems", "toast.copied", "dialogs.permanentBody"]) {
      const text = i18n.t(key, { count: 3 });
      expect(text, key).not.toContain("plural");
      expect(text, key).toContain("3");
    }
    await i18n.changeLanguage("en");
  });

  it("formats ICU plurals at runtime", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("explorer.statusItems", { count: 0 })).toBe("No items");
    expect(i18n.t("explorer.statusItems", { count: 1 })).toBe("1 item");
    expect(i18n.t("explorer.statusItems", { count: 5 })).toBe("5 items");
    await i18n.changeLanguage("es");
    expect(i18n.t("explorer.statusItems", { count: 0 })).toBe("Sin elementos");
    expect(i18n.t("explorer.statusItems", { count: 1 })).toBe("1 elemento");
    expect(i18n.t("explorer.statusItems", { count: 5 })).toBe("5 elementos");
    await i18n.changeLanguage("en");
  });
});
describe("page language", () => {
  it("uses a valid language tag for every app language", async () => {
    expect(htmlLang("en")).toBe("en");
    expect(htmlLang("es")).toBe("es");
    expect(htmlLang("pseudo")).toBe("en-XA");
    for (const lang of ["en", "es", "pseudo"]) {
      await applyLanguage(lang);
      expect(() => new Intl.Locale(document.documentElement.lang)).not.toThrow();
    }
    await applyLanguage("en");
  });
});
