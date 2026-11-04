import type { OfficeController } from "../OfficeController";
import { formatOfficeFormula, parseOfficeFormula } from "../../services/officeEdit";

/** The approved engine owns tokenization, catalogue names and AST serialization. */
export function displayFormula(controller: OfficeController, canonical: string, locale: "en-US" | "es-419"): Promise<string> {
  return formatOfficeFormula(controller.session_id, canonical, locale);
}

export function parseFormula(controller: OfficeController, display: string, locale: "en-US" | "es-419"): ReturnType<typeof parseOfficeFormula> {
  return parseOfficeFormula(controller.session_id, display, locale);
}
