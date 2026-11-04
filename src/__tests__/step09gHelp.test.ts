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

const KEYS = [
  "locks.title",
  "locks.inspect",
  "locks.close",
  "locks.retry",
  "locks.none",
  "locks.confirm",
  "locks.folderNote",
  "locks.protected",
  "locks.requested",
  "locks.alreadyClosed",
  "shelf.title",
  "shelf.add",
  "shelf.remove",
  "shelf.clear",
  "shelf.empty",
  "shelf.refresh",
  "shelf.missing",
  "shelf.changed",
  "shelf.openGroup",
  "shelf.clearConfirm",
  "shelf.sensitive",
  "shelf.unavailable",
  "errors.locks.failed",
  "errors.locks.timeout",
  "errors.locks.denied",
  "errors.locks.changed",
  "errors.locks.cancelled",
  "errors.locks.other",
  "errors.shelf.invalid",
  "errors.shelf.changed",
  "errors.shelf.limit",
  "errors.shelf.io",
  "errors.shelf.sensitive",
  "errors.shelf.other",
];

describe("step 09g help and text", () => {
  it("both help pages exist in both languages", () => {
    const filesInUseEn = readFileSync(join(root, "help", "en", "files-in-use.md"), "utf8");
    const filesInUseEs = readFileSync(join(root, "help", "es", "files-in-use.md"), "utf8");
    const shelfEn = readFileSync(join(root, "help", "en", "the-shelf.md"), "utf8");
    const shelfEs = readFileSync(join(root, "help", "es", "the-shelf.md"), "utf8");
    expect(filesInUseEn.split("\n")[0]).toBe("# Files in use");
    expect(filesInUseEs.split("\n")[0]).toBe("# Archivos en uso");
    expect(shelfEn.split("\n")[0]).toBe("# The shelf");
    expect(shelfEs.split("\n")[0]).toBe("# La bandeja");
    expect(filesInUseEn).toContain("The app never forces a program to stop.");
    expect(filesInUseEs).toContain("La aplicación nunca fuerza el cierre.");
    expect(shelfEn).toContain("without moving the files");
    expect(shelfEs).toContain("sin mover sus archivos");
  });

  it("has every English and Spanish key", () => {
    for (const language of ["en", "es"]) {
      const tree = readJson(language);
      for (const key of KEYS) {
        expect(typeof dig(tree, key), `${language}: ${key}`).toBe("string");
      }
    }
  });
});
