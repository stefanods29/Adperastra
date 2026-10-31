import { describe, expect, it } from "vitest";
import { BLANK_KINDS, BUILTIN_TEMPLATES, templateFileName } from "../templates/catalog";

describe("template catalog", () => {
  it("templateFileName keeps the extension", () => {
    expect(templateFileName("Carta", "letter.docx")).toBe("Carta.docx");
    expect(templateFileName("Notas", "meeting-notes.md")).toBe("Notas.md");
  });

  it("ids match the files", () => {
    expect(BUILTIN_TEMPLATES.map((entry) => [entry.id, entry.file])).toEqual([
      ["letter", "letter.docx"],
      ["report", "report.docx"],
      ["budget", "budget.xlsx"],
      ["invoice", "invoice.xlsx"],
      ["meetingNotes", "meeting-notes.md"],
      ["presentation", "presentation.pptx"],
    ]);
    expect(BLANK_KINDS.map((entry) => entry.kind)).toEqual([
      "markdown",
      "csv",
      "document",
      "spreadsheet",
      "presentation",
    ]);
    expect(BLANK_KINDS.find((entry) => entry.kind === "markdown")?.blankFile).toBeNull();
    expect(BLANK_KINDS.find((entry) => entry.kind === "csv")?.blankFile).toBeNull();
  });
});
