import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sheet AI bilingual help", () => {
  it("sheet_ai_help_complete", () => {
    const en = readFileSync("help/en/ai-help-in-spreadsheets.md", "utf8");
    const es = readFileSync("help/es/ai-help-in-spreadsheets.md", "utf8");
    for (const term of ["Write a formula", "Explain this formula", "Clean this data", "Suggest a chart", "Describe this table",
      "separate copy", "canonical", "localized", "actual result", "one-time", "Undo"]) expect(en).toContain(term);
    for (const term of ["Escribir una fórmula", "Explicar esta fórmula", "Limpiar estos datos", "Sugerir un gráfico",
      "Describir esta tabla", "copia separada", "canónica", "resultado real", "una sola vez", "Deshacer"]) expect(es).toContain(term);
  });
});
