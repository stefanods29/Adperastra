import { registerDeckEditorController } from "./deck/deckController";
import { registerDocumentEditorController } from "./document/documentController";
import { registerSheetEditorController } from "./sheet/sheetController";

/** One trusted registration point for the three Office editing families.
 * App startup calls this once; a mounted view never registers a factory.
 * The factories themselves stay inert until a native approved engine exists. */
export function registerOfficeEditorControllers(): void {
  registerDocumentEditorController();
  registerSheetEditorController();
  registerDeckEditorController();
}
