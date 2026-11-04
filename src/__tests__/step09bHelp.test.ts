import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(language: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, "src", "i18n", "locales", `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function dig(tree: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, tree);
}

const GROUP_KEYS = [
  "groups.new",
  "groups.add",
  "groups.remove",
  "groups.rename",
  "groups.color",
  "groups.collapse",
  "groups.expand",
  "groups.ungroup",
  "groups.close",
  "groups.save",
  "groups.saveClose",
  "groups.saved",
  "groups.update",
  "groups.export",
  "groups.import",
  "groups.name",
  "groups.empty",
  "groups.open",
  "groups.count",
  "groups.confirmRemove",
  "groups.purple",
  "groups.blue",
  "groups.green",
  "groups.teal",
  "groups.orange",
  "groups.red",
  "groups.removeSaved",
  "groups.exportSelected",
  "toast.groupChanged",
  "toast.groupSaved",
  "errors.groups.invalid",
  "errors.groups.limit",
  "errors.groups.changed",
  "errors.groups.io",
  "errors.groups.unsupported_version",
  "errors.groups.cancelled",
  "errors.groups.other",
];

const COMMANDS = [
  { id: "tab.groupNew", helpSlug: "tab-groups" },
  { id: "tab.groupRemove", helpSlug: "tab-groups" },
  { id: "tab.groupSave", helpSlug: "tab-groups" },
  { id: "app.savedGroups", helpSlug: "saved-tab-groups" },
];

describe("step 09b help and commands", () => {
  it("both group help pages exist in both languages with the guide titles", () => {
    const englishGroups = readFileSync(join(root, "help", "en", "tab-groups.md"), "utf8");
    const spanishGroups = readFileSync(join(root, "help", "es", "tab-groups.md"), "utf8");
    const englishSaved = readFileSync(join(root, "help", "en", "saved-tab-groups.md"), "utf8");
    const spanishSaved = readFileSync(join(root, "help", "es", "saved-tab-groups.md"), "utf8");
    expect(englishGroups.split("\n")[0]).toBe("# Tab groups");
    expect(spanishGroups.split("\n")[0]).toBe("# Grupos de pestañas");
    expect(englishSaved.split("\n")[0]).toBe("# Saved groups");
    expect(spanishSaved.split("\n")[0]).toBe("# Grupos guardados");
    expect(englishGroups).toContain("without moving their files");
    expect(englishSaved).toContain("not unsaved edits or passwords");
    expect(spanishSaved).toContain("no cambios sin guardar ni contraseñas");
  });

  it("every group key exists in English and Spanish", () => {
    for (const language of ["en", "es"]) {
      const tree = readJson(language);
      for (const key of GROUP_KEYS) {
        expect(typeof dig(tree, key), `${language}: ${key}`).toBe("string");
      }
    }
  });

  it("group command ids are unique and their help pages exist", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of COMMANDS) {
      for (const language of ["en", "es"]) {
        const page = readFileSync(
          join(root, "help", language, `${command.helpSlug}.md`),
          "utf8",
        );
        expect(page.startsWith("# ")).toBe(true);
      }
    }
  });
});
