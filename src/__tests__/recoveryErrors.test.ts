import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";

const RECOVERY_ERRORS = [
  "invalid",
  "too_large",
  "unsupported",
  "locked",
  "corrupt",
  "io",
  "changed",
  "cancelled",
  "busy",
  "other",
];
const DIAGNOSTICS_ERRORS = ["invalid", "too_large", "io", "cancelled", "other"];

type Tree = { [key: string]: string | Tree };

function at(tree: Tree, path: string): string | undefined {
  let current: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Tree)[part];
  }
  return typeof current === "string" ? current : undefined;
}

describe("recovery and diagnostics translations", () => {
  for (const [language, tree] of [
    ["en", en as unknown as Tree],
    ["es", es as unknown as Tree],
  ] as const) {
    it(`${language} has every recovery and diagnostics error`, () => {
      for (const reason of RECOVERY_ERRORS) {
        expect(at(tree, `errors.recovery.${reason}`), reason).toBeTruthy();
      }
      for (const reason of DIAGNOSTICS_ERRORS) {
        expect(at(tree, `errors.diagnostics.${reason}`), reason).toBeTruthy();
      }
    });

    it(`${language} has the recovery, safe-mode and diagnostics labels`, () => {
      for (const key of [
        "recovery.title",
        "recovery.open",
        "recovery.discard",
        "recovery.later",
        "recovery.available",
        "recovery.unavailable",
        "recovery.sensitive",
        "recovery.copyLocation",
        "recovery.discardConfirm",
        "recovery.tabFailed",
        "recovery.reload",
        "recovery.enabled",
        "recovery.interval",
        "recovery.legacyFound",
        "recovery.importLegacy",
        "safeMode.banner",
        "safeMode.restart",
        "diagnostics.title",
        "diagnostics.redact",
        "diagnostics.dumps",
        "diagnostics.save",
        "diagnostics.issue",
        "diagnostics.review",
        "diagnostics.dumpWarning",
      ]) {
        expect(at(tree, key), key).toBeTruthy();
      }
    });
  }

  it("has both languages of the three help pages", () => {
    for (const language of ["en", "es"]) {
      for (const slug of ["recovering-after-a-crash", "safe-mode", "reporting-a-problem"]) {
        const text = readFileSync(resolve(`help/${language}/${slug}.md`), "utf8");
        expect(text.length).toBeGreaterThan(80);
      }
    }
  });
});
