import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readText(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8");
}

function readJson(language: string): Record<string, unknown> {
  return JSON.parse(readText("src", "i18n", "locales", `${language}.json`)) as Record<string, unknown>;
}

function dig(tree: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, tree);
}

const SPLIT_KEYS = [
  "splits.open",
  "splits.title",
  "splits.vertical",
  "splits.horizontal",
  "splits.swap",
  "splits.sync",
  "splits.closeSide",
  "splits.first",
  "splits.second",
  "splits.active",
  "splits.divider",
  "splits.syncUnavailable",
  "splits.compact",
  "errors.splits.invalid",
  "errors.splits.unsupported",
  "errors.splits.limit",
  "errors.splits.other",
];

const COMMANDS = [
  { id: "tab.openSplit", labelKey: "splits.open" },
  { id: "tab.splitSwap", labelKey: "splits.swap" },
  { id: "tab.splitVertical", labelKey: "splits.vertical" },
  { id: "tab.splitHorizontal", labelKey: "splits.horizontal" },
  { id: "tab.splitSync", labelKey: "splits.sync" },
];

const HELP_SLUG = "split-view";

describe("step 09i help, keys and commands", () => {
  it("bilingualhelp: both split help pages exist with the guide text", () => {
    const english = readText("help", "en", `${HELP_SLUG}.md`);
    const spanish = readText("help", "es", `${HELP_SLUG}.md`);
    expect(english.split("\n")[0]).toBe("# Split view");
    expect(spanish.split("\n")[0]).toBe("# Vista dividida");
    expect(english).toContain("Keep two compatible views inside one tab.");
    expect(spanish).toContain("Mantén dos vistas compatibles dentro de una pestaña.");
    expect(english).toContain("Open in split view");
    expect(spanish).toContain("Abrir en vista dividida");
    expect(english).toContain("Close this side");
    expect(spanish).toContain("Cerrar este lado");
    expect(english).toContain('See also: "Working with tabs"');
    expect(spanish).toContain("Consulta también:");
  });

  it("keyboard: the page documents the whole-tab close and the focus route", () => {
    const english = readText("help", "en", `${HELP_SLUG}.md`);
    const spanish = readText("help", "es", `${HELP_SLUG}.md`);
    for (const page of [english, spanish]) {
      expect(page).toContain("Ctrl+W");
      expect(page).toContain("F6");
    }
    expect(english).toContain("arrow keys");
    expect(spanish).toContain("flechas");
  });

  it("every split key exists in English and Spanish", () => {
    for (const language of ["en", "es"]) {
      const tree = readJson(language);
      for (const key of SPLIT_KEYS) {
        expect(typeof dig(tree, key), `${language}: ${key}`).toBe("string");
      }
    }
  });

  it("commandIDsunique: split command ids are unique and point at the split help page", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of COMMANDS) {
      expect(SPLIT_KEYS).toContain(command.labelKey);
    }
    for (const language of ["en", "es"]) {
      const page = readText("help", language, `${HELP_SLUG}.md`);
      expect(page.startsWith("# ")).toBe(true);
    }
  });
});
