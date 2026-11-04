import type { DocumentHandle } from "../../documents/types";
import { errorCode } from "../../services/errors";
import { acquireOfficeController, registerOfficeControllerFactory, type OfficeController } from "../OfficeController";
import { canOfficeCommand } from "../officeCompatibility";

export const SHEET_HANDLER_ID = "office-sheet";
export const SHEET_FAMILY = "sheet";

let registered = false;

/** Called once by the application registration, never from a mounted view. */
export function registerSheetEditorController(): void {
  if (registered) return;
  registered = true;
  registerOfficeControllerFactory(SHEET_HANDLER_ID, SHEET_FAMILY);
}

export type SheetControllerResult = { kind: "editing"; controller: OfficeController } | { kind: "viewing"; reason_key: string };

/** Acquire the registry-owned model. Missing engines retain the step-13 presenter. */
export async function acquireSheetController(document: DocumentHandle, previewOnly = false): Promise<SheetControllerResult> {
  if (previewOnly) return { kind: "viewing", reason_key: "office.readOnly" };
  try {
    const controller = await acquireOfficeController(document, "sheet");
    return { kind: "editing", controller };
  } catch (error) {
    const code = errorCode(error);
    if (code === "office_edit.engine_missing") return { kind: "viewing", reason_key: "office.engineNeeded" };
    if (code === "office_edit.unsupported" || code === "office_edit.preservation_failed") return { kind: "viewing", reason_key: "office.unsupported" };
    throw error;
  }
}

export function canEditSheet(controller: OfficeController, previewOnly: boolean): boolean {
  return !previewOnly && canOfficeCommand(controller.getState(), "sheet_cells", true).enabled;
}
