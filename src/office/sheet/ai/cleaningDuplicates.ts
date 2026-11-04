import type { CellInput } from "../../types";

/** Typed keys avoid collisions between text, numbers, dates and formulas. */
export function cleaningDuplicateKey(values: readonly CellInput[]): string {
  return JSON.stringify(values.map(input => {
    switch (input.kind) {
      case "blank": return ["blank"];
      case "text": return ["text", input.text];
      case "number":
        if (!Number.isFinite(input.value)) throw new Error("sheet_ai.invalid");
        return ["number", input.value];
      case "boolean": return ["boolean", input.value];
      case "date": return ["date", input.iso_date];
      case "formula": return ["formula", input.canonical];
    }
  }));
}
