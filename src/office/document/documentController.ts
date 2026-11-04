import type { DocumentHandle } from "../../documents/types";
import { errorCode } from "../../services/errors";
import { acquireOfficeController, registerOfficeControllerFactory, type OfficeController } from "../OfficeController";
import { canOfficeCommand } from "../officeCompatibility";
import type { OfficeCapability, OfficeSessionState } from "../types";

let registered = false;

/** Called once by application registration, never from a mounted view. */
export function registerDocumentEditorController(): void {
  if (registered) return;
  registered = true;
  registerOfficeControllerFactory("office-word", "document");
}

export function acquireDocumentController(document: DocumentHandle): Promise<OfficeController> {
  return acquireOfficeController(document, "document");
}

export type DocumentControllerResult =
  | { kind: "editing"; controller: OfficeController }
  | { kind: "viewing"; reason_key: string };

/** Open the editor's shared controller. A missing native engine (20a is still
 * fail-closed until its approved binding exists) keeps the read-only outcome
 * instead of fabricating an editable model. Every view of one document gets
 * the same controller; the caller always releases its own reference. */
export async function openDocumentController(
  document: DocumentHandle,
): Promise<DocumentControllerResult> {
  try {
    return { kind: "editing", controller: await acquireDocumentController(document) };
  } catch (error) {
    const code = errorCode(error);
    if (code === "office_edit.engine_missing") return { kind: "viewing", reason_key: "office.engineNeeded" };
    if (code === "office_edit.unsupported" || code === "office_edit.preservation_failed") {
      return { kind: "viewing", reason_key: "office.unsupported" };
    }
    throw error;
  }
}

/** previewOnly/read-only is per view: never switch the shared document's mode
 * to enforce it. A protected download becomes editable only through the
 * explicit Enable editing mode change, never through a command default. */
export function canDocumentMutate(
  state: OfficeSessionState,
  capability: OfficeCapability,
  previewOnly = false,
) {
  if (previewOnly) return { enabled: false, reason_key: "office.enableEditing" };
  return canOfficeCommand(state, capability, true);
}
