import { registerDocumentControllerFactory } from "../documents/controller";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import { registerNativePdfEditHosts } from "../services/pdfEdit";
import { createPdfEditDocumentBinding } from "./PdfEditRegistry";
import { pdfEditError } from "./types";

/** Editable PDF document composition (Step 14a E1/E2).
 *
 * The existing `pdf` handler becomes a document presenter: the 09a registry
 * asks this factory for the one editable controller of a PDF document. The
 * factory needs the live `DocumentHandle`, because the 09a factory context
 * has no `captureSnapshot`; the registry already holds that handle under
 * `context.document_id`. Both native host ports are registered here, once,
 * at app startup (the PDF handler module is loaded with the handler
 * registry); a mounted view never registers a factory or a host. */

export const PDF_EDIT_HANDLER_ID = "pdf";

let integrationRegistered = false;
let controllerRegistered = false;

/** Trusted static registration of the PDF document controller factory. */
export function registerPdfEditDocumentController(): void {
  if (controllerRegistered) return;
  controllerRegistered = true;
  registerDocumentControllerFactory(PDF_EDIT_HANDLER_ID, async (context) => {
    if (context.info.ext.toLowerCase() !== "pdf") throw pdfEditError("pdf_edit.unsupported");
    const document = DocumentRegistry.get(context.document_id);
    if (!document) throw pdfEditError("pdf_edit.changed");
    return createPdfEditDocumentBinding(document, context);
  });
}

/** App composition: the two native host ports and the controller factory.
 * Safe to call more than once; only the first call registers. */
export function registerPdfEditIntegration(): void {
  if (integrationRegistered) return;
  integrationRegistered = true;
  registerNativePdfEditHosts();
  registerPdfEditDocumentController();
}
