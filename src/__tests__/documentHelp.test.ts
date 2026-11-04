import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentRibbon } from "../office/document/documentRibbon";

const slugs = ["editing-documents", "document-formatting-and-styles", "document-review-and-comments",
  "document-spelling", "document-exporting-pdf", "document-dictation"];

/** The Step 20c AI commands deliberately use the documentAi namespace. */
const AI_LABELS: Record<string, string> = {
  "doc.aiRewrite": "documentAi.rewrite", "doc.aiShorten": "documentAi.shorten",
  "doc.aiExpand": "documentAi.expand", "doc.aiSimplify": "documentAi.simplify",
  "doc.aiGrammar": "documentAi.grammar", "doc.aiTone": "documentAi.tone",
  "doc.aiTranslate": "documentAi.translate", "doc.aiAltText": "documentAi.altText",
  "doc.aiDraft": "documentAi.draft", "doc.aiContinue": "documentAi.continue",
};

function translated(locale: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>)[part] : undefined, locale);
}

describe("document help and ribbon", () => {
  it("all9tabs in order", () => {
    expect(documentRibbon().tabs.map((tab) => tab.id)).toEqual([
      "doc.file", "doc.home", "doc.insert", "doc.design", "doc.layout", "doc.references", "doc.review", "doc.view", "doc.help",
    ]);
    expect(documentRibbon().tabs.map((tab) => tab.keyTip)).toEqual(["F", "H", "I", "D", "L", "R", "V", "W", "Y"]);
  });
  it("all matrix keys exist in English and Spanish", () => {
    for (const language of ["en", "es"]) {
      const locale = JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, "utf8")) as Record<string, unknown>;
      for (const tab of documentRibbon().tabs) {
        expect(translated(locale, tab.labelKey)).toBeTypeOf("string");
        for (const group of tab.groups) {
          expect(translated(locale, group.labelKey)).toBeTypeOf("string");
          for (const control of group.controls) {
            if (control.type !== "custom") {
              const key = AI_LABELS[control.command] ??
                (control.command.startsWith("doc.") ? `officeDoc.${control.command.slice(4)}` : control.command);
              expect(translated(locale, key)).toBeTypeOf("string");
            }
          }
        }
      }
    }
  });
  it("all six full help pages have bilingual sections", () => {
    for (const language of ["en", "es"]) for (const slug of slugs) {
      const body = readFileSync(`help/${language}/${slug}.md`, "utf8");
      expect(body.startsWith("# ")).toBe(true);
      expect(body).toContain(language === "en" ? "## How to use" : "## Cómo usar");
      expect(body).toContain(language === "en" ? "## Good to know" : "## Para tener en cuenta");
      expect(body).toContain(language === "en" ? "See also:" : "Consulta también:");
    }
  });
});
