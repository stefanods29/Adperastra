import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../commands/registry";
import { registerDeckCommands } from "../office/deck/deckCommands";
import { deckRibbon } from "../office/deck/deckRibbon";
import type { DeckCommandContext } from "../office/deck/deckUiTypes";

vi.mock("../office/OfficeController", () => ({ acquireOfficeController: vi.fn(), registerOfficeControllerFactory: vi.fn() }));
vi.mock("../services/officeEdit", () => ({ officeFormatting: vi.fn() }));
vi.mock("../office/officeCompatibility", () => ({ canOfficeCommand: () => ({ enabled: true, reason_key: null }) }));

function catalog(language: "en" | "es"): Record<string, unknown> {
  return JSON.parse(readFileSync(
    fileURLToPath(repoUrl(`../../src/i18n/locales/${language}.json`, import.meta.url)),
    "utf8",
  )) as Record<string, unknown>;
}

function value(catalogValue: Record<string, unknown>, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, catalogValue);
}

const helpers = [
  "editing-presentations",
  "deck-layouts-and-themes",
  "deck-transitions-and-animations",
  "presenting-slides",
];

describe("deck help and translations", () => {
  it("all ten tabs, groups and command labels exist in both languages", () => {
    const en = catalog("en");
    const es = catalog("es");
    const registry = new CommandRegistry<DeckCommandContext>();
    registerDeckCommands(registry);
    const keys = new Set<string>();
    for (const tab of deckRibbon().tabs) {
      keys.add(tab.labelKey);
      for (const group of tab.groups) {
        keys.add(group.labelKey);
        for (const control of group.controls) {
          if (control.type === "custom") continue;
          const command = registry.get(control.command);
          expect(command, control.command).toBeDefined();
          keys.add(command!.labelKey);
        }
      }
    }
    for (const key of keys) {
      expect(value(en, key), `en ${key}`).toEqual(expect.any(String));
      expect(value(es, key), `es ${key}`).toEqual(expect.any(String));
    }
  });

  it("has the exact extra slide, notes and presentation texts", () => {
    const en = catalog("en");
    const es = catalog("es");
    expect(value(en, "officeDeck.slideStatus")).toBe("Slide {slide} of {total}");
    expect(value(es, "officeDeck.slideStatus")).toBe("Diapositiva {slide} de {total}");
    expect(value(en, "officeDeck.notesPlaceholder")).toBe("Click to add notes");
    expect(value(es, "officeDeck.notesPlaceholder")).toBe("Haz clic para agregar notas");
    expect(value(en, "officeDeck.hidden")).toBe("Hidden");
    expect(value(es, "officeDeck.hidden")).toBe("Oculta");
    expect(value(en, "officeDeck.notesPrivate")).toBe("Notes are shown only in presenter view.");
    expect(value(es, "officeDeck.notesPrivate")).toBe("Las notas solo aparecen en la vista del moderador.");
    expect(value(en, "officeDeck.monitorLost")).toBe("The presentation display disconnected. Choose a display to continue.");
    expect(value(es, "officeDeck.monitorLost")).toBe("Se desconectó la pantalla de presentación. Elige una pantalla para continuar.");
    expect(value(en, "officeDeck.end")).toBe("End presentation");
    expect(value(es, "officeDeck.end")).toBe("Finalizar presentación");
    expect(String(value(en, "officeDeck.deleteConfirm"))).toContain("plural");
    expect(String(value(es, "officeDeck.deleteConfirm"))).toContain("plural");
  });

  it("has every presentation and deck error in English and Spanish", () => {
    const en = catalog("en");
    const es = catalog("es");
    const keys = [
      "errors.presentation.invalid", "errors.presentation.unsupported",
      "errors.presentation.display_missing", "errors.presentation.failed",
      "errors.deck.invalid_theme", "errors.deck.invalid_selection",
      "errors.deck.invalid_template", "errors.deck.invalid_name", "errors.deck.overflow",
    ];
    for (const key of keys) {
      expect(value(en, key), `en ${key}`).toEqual(expect.any(String));
      expect(value(es, key), `es ${key}`).toEqual(expect.any(String));
    }
    expect(value(en, "errors.presentation.display_missing")).toBe("The selected display is not available.");
    expect(value(es, "errors.presentation.display_missing")).toBe("La pantalla seleccionada no está disponible.");
  });

  it("all four help pages exist in both languages with a related link", () => {
    for (const language of ["en", "es"] as const) {
      for (const slug of helpers) {
        const text = readFileSync(
          fileURLToPath(repoUrl(`../../help/${language}/${slug}.md`, import.meta.url)),
          "utf8",
        );
        expect(text.startsWith("# "), `${language}/${slug}`).toBe(true);
        expect(text).toContain(language === "en" ? "See also:" : "Consulta también:");
      }
    }
  });

  it("the help stays honest about a non-AI, static fallback", () => {
    const edit = readFileSync(fileURLToPath(repoUrl("../../help/en/editing-presentations.md", import.meta.url)), "utf8");
    const present = readFileSync(fileURLToPath(repoUrl("../../help/en/presenting-slides.md", import.meta.url)), "utf8");
    const effects = readFileSync(fileURLToPath(repoUrl("../../help/en/deck-transitions-and-animations.md", import.meta.url)), "utf8");
    expect(edit).toContain("preserved");
    expect(edit).not.toMatch(/\bAI\b|generated slides/);
    expect(present).toContain("never placed on the audience output");
    expect(effects).toContain("does not reproduce every animation");
  });
});