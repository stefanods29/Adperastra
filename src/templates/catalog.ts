/** Built-in templates and blank file kinds (Step 06c). Same ids as Rust
 * templates.rs. */

export type BuiltinTemplateId =
  | "letter"
  | "report"
  | "budget"
  | "invoice"
  | "meetingNotes"
  | "presentation";

export interface BuiltinTemplate {
  id: BuiltinTemplateId;
  /** The file in `templates/builtin/<lang>/`. */
  file: string;
  nameKey: string;
  descriptionKey: string;
}

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: "letter",
    file: "letter.docx",
    nameKey: "templates.letter.name",
    descriptionKey: "templates.letter.description",
  },
  {
    id: "report",
    file: "report.docx",
    nameKey: "templates.report.name",
    descriptionKey: "templates.report.description",
  },
  {
    id: "budget",
    file: "budget.xlsx",
    nameKey: "templates.budget.name",
    descriptionKey: "templates.budget.description",
  },
  {
    id: "invoice",
    file: "invoice.xlsx",
    nameKey: "templates.invoice.name",
    descriptionKey: "templates.invoice.description",
  },
  {
    id: "meetingNotes",
    file: "meeting-notes.md",
    nameKey: "templates.meeting.name",
    descriptionKey: "templates.meeting.description",
  },
  {
    id: "presentation",
    file: "presentation.pptx",
    nameKey: "templates.presentation.name",
    descriptionKey: "templates.presentation.description",
  },
];

export type BlankKind = "markdown" | "csv" | "document" | "spreadsheet" | "presentation";

export interface BlankKindInfo {
  kind: BlankKind;
  /** The new file's extension, with its dot. */
  ext: string;
  nameKey: string;
  /** The shipped blank Office file, or null for the kinds created empty. */
  blankFile: string | null;
}

export const BLANK_KINDS: readonly BlankKindInfo[] = [
  { kind: "markdown", ext: ".md", nameKey: "files.newMarkdownName", blankFile: null },
  { kind: "csv", ext: ".csv", nameKey: "files.newCsvName", blankFile: null },
  { kind: "document", ext: ".docx", nameKey: "files.newDocumentName", blankFile: "blank.docx" },
  { kind: "spreadsheet", ext: ".xlsx", nameKey: "files.newSpreadsheetName", blankFile: "blank.xlsx" },
  { kind: "presentation", ext: ".pptx", nameKey: "files.newPresentationName", blankFile: "blank.pptx" },
];

/** The translated name plus the template file's own extension: "Carta" and
 * `letter.docx` give "Carta.docx". */
export function templateFileName(nameText: string, file: string): string {
  const dot = file.lastIndexOf(".");
  return `${nameText}${dot > 0 ? file.slice(dot) : ""}`;
}
