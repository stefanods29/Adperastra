import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PDF_EDIT_COMMAND_IDS,
  PDF_EDIT_HELP_SLUGS,
  createPdfEditCommands,
  pdfEditHelpSlugForCommand,
  type PdfEditActions,
} from "../pdf-edit/commands";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const actions: PdfEditActions = {
  setTool: () => undefined,
  openPages: () => undefined,
  openMerge: () => undefined,
  openSplit: () => undefined,
  openInsert: () => undefined,
  rotateSelection: () => undefined,
  deleteSelection: () => undefined,
  undo: () => undefined,
  redo: () => undefined,
};

function help(language: "en" | "es", slug: string): string {
  return readFileSync(join(root, "help", language, `${slug}.md`), "utf8");
}

describe("PDF tools and compatibility help", () => {
  it("annotations_reopen_other_reader", () => {
    for (const language of ["en", "es"] as const) {
      const text = help(language, "pdf-annotations");
      expect(text.toLowerCase()).toMatch(language === "en" ? /standard pdf annotations/ : /anotaciones pdf estándar/);
      expect(text.toLowerCase()).toMatch(language === "en" ? /appearances/ : /apariencia/);
      expect(text.toLowerCase()).toMatch(language === "en" ? /unsupported structures/ : /estructuras no compatibles/);
      expect(text.toLowerCase()).toContain(language === "en" ? "undo" : "deshacer");
    }
    for (const language of ["en", "es"] as const) {
      const signing = help(language, "pdf-signing");
      expect(signing.toLowerCase()).toMatch(
        language === "en" ? /not a certified digital signature/ : /no una firma digital certificada/,
      );
      // Step 14a's help text says "usa Guardar una copia" (the button label
      // is Guardar una copia); match the final Spanish page, not the label.
      expect(signing.toLowerCase()).toMatch(language === "en" ? /save a copy/ : /usa guardar una copia/);
    }
  });

  it("forms_reopen_independent", () => {
    for (const language of ["en", "es"] as const) {
      const text = help(language, "pdf-forms");
      expect(text.toLowerCase()).toMatch(
        language === "en" ? /reopen the copy in your other pdf app/ : /vuelve a abrir la copia en tu otra aplicación pdf/,
      );
      expect(text.toLowerCase()).toMatch(language === "en" ? /never run/ : /nunca se ejecutan/);
      expect(text.toLowerCase()).toMatch(language === "en" ? /xfa/ : /xfa/);
    }
  });

  it("all_tools_keyboard_help", () => {
    const commands = createPdfEditCommands(actions);
    expect(commands.map((command) => command.id)).toEqual([...PDF_EDIT_COMMAND_IDS]);
    for (const command of commands) {
      expect(command.labelKey.length).toBeGreaterThan(0);
      expect(PDF_EDIT_HELP_SLUGS).toContain(command.helpSlug as (typeof PDF_EDIT_HELP_SLUGS)[number]);
      expect(pdfEditHelpSlugForCommand(command.id)).toBe(command.helpSlug);
      expect(command.enabledWhen).toBeTypeOf("function");
      expect(command.run).toBeTypeOf("function");
      expect(command.shortcut).toBeUndefined();
    }
    const tools = ["pdf.highlight", "pdf.draw", "pdf.text", "pdf.comment", "pdf.sign", "pdf.pages", "pdf.merge", "pdf.split", "pdf.rotate", "pdf.delete", "pdf.insert"];
    expect(PDF_EDIT_COMMAND_IDS).toEqual(expect.arrayContaining(tools));
    for (const language of ["en", "es"] as const) {
      for (const slug of PDF_EDIT_HELP_SLUGS) expect(help(language, slug).length).toBeGreaterThan(40);
    }
  });
});
