import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deckReleaseDecision } from "../../tests/ai/suites/deckEvaluation";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function localeValue(language: "en" | "es", key: string): string | undefined {
  const json = JSON.parse(read(`src/i18n/locales/${language}.json`)) as Record<string, unknown>;
  let value: unknown = json;
  for (const part of key.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : undefined;
}

describe("deck AI help and release evidence", () => {
  it("documents all six actions in both languages", () => {
    const en = read("help/en/creating-slides-with-ai.md");
    const es = read("help/es/creating-slides-with-ai.md");
    for (const word of [
      "Create slides from",
      "add a slide",
      "shorten selected text",
      "speaker notes",
      "suggest a layout",
      "suggest a style",
    ]) {
      expect(en.toLowerCase()).toContain(word.toLowerCase());
    }
    for (const word of ["Crear diapositivas", "agregar una diapositiva", "acortar texto", "notas del orador", "disposición", "estilo"]) {
      expect(es.toLowerCase()).toContain(word.toLowerCase());
    }
    for (const action of ["create", "add", "shorten", "notes", "layout", "style"]) {
      expect(localeValue("en", `deckAi.${action}`)).toBeTruthy();
      expect(localeValue("es", `deckAi.${action}`)).toBeTruthy();
    }
    for (const error of ["invalid", "changed", "too_large", "overflow", "unsupported", "failed"]) {
      expect(localeValue("en", `errors.deck_ai.${error}`)).toBeTruthy();
      expect(localeValue("es", `errors.deck_ai.${error}`)).toBeTruthy();
    }
  });

  it("keeps the manual style library independent of AI", () => {
    const manual = read("help/en/deck-style-library.md");
    expect(manual).toContain("Open **Design > Style library**");
    expect(manual).toContain("Optional AI generation");
    expect(manual.toLowerCase()).not.toContain("requires ai");
    const checklist = read("docs/releases/v1.0-checklist.md");
    expect(checklist).toContain("## Manual style library");
    expect(checklist.indexOf("## Manual style library")).toBeLessThan(checklist.indexOf("## AI deck actions"));
  });

  it("does not publish a release without run and owner evidence", () => {
    const decision = deckReleaseDecision({
      quality: { status: "pending", failures: ["deck_eval_not_run"] },
      gate_passed: false,
      package_passed: false,
      speed_passed: false,
      security_passed: false,
      fidelity_passed: false,
      owner_approved_release: false,
      open_blockers: 0,
      open_majors: 0,
    });
    expect(decision.publish).toBe(false);
    const checklist = read("docs/releases/v1.0-checklist.md");
    expect(checklist).toContain("Status: **draft, unpublished**");
    expect(checklist).toContain("- [ ] Full gate passed with executed output.");
    expect(checklist).not.toContain("- [x]");
    expect(checklist.toLowerCase()).not.toContain("published on");
  });
});
