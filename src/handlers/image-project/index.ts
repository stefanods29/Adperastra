import { Layers } from "lucide-react";
import { lazy, type ComponentType } from "react";
import { registerDocumentControllerFactory } from "../../documents/controller";
import { DocumentRegistry } from "../../documents/DocumentRegistry";
import type { VirtualViewProps } from "../../documents/types";
import {
  MAX_PROJECT_ARCHIVE_BYTES,
  PROJECT_EXTENSION,
  PROJECT_MIME,
} from "../../image-edit/projectTypes";
import type { Handler } from "../types";

/** The `.adimage` editable-project handler (Step 18b T6/D9).
 *
 * A project is a document, not an ordinary flattened image: it is presented
 * through the 09a document controller (`virtualView`) so the image editor can
 * bind its layered model and Undo history. The same editor is listed as
 * `view` for hosts that have not yet passed a DocumentHandle; such a host
 * shows the translated project error instead of pretending to edit. */

const ImageEditor = lazy(() => import("../../image-edit/ImageEditor"));
const ImageEditorForDocument = ImageEditor as unknown as ComponentType<VirtualViewProps>;

let controllerRegistered = false;

/** Binds `.adimage` to the trusted project importer. The importer graph is
 * loaded on demand; the factory refuses with a stable project code while the
 * native provider has not published the manifest and tile payloads. */
function registerImageProjectController(): void {
  if (controllerRegistered) return;
  controllerRegistered = true;
  registerDocumentControllerFactory("image-project", async (context) => {
    const document = DocumentRegistry.get(context.document_id);
    if (!document) throw new Error("documents.not_open");
    const { openImageProjectDocument } = await import("../../image-edit/projectImport");
    return openImageProjectDocument(context, document);
  });
}

registerImageProjectController();

export type ImageProjectHandler = Handler & {
  /** Additive 09a field: a document presenter, not a disk viewer. */
  virtualView: ComponentType<VirtualViewProps>;
};

export const imageProjectHandler: ImageProjectHandler = {
  id: "image-project",
  version: 1,
  labelKey: "imageProject.title",
  icon: Layers,
  accent: "image",
  extensions: [PROJECT_EXTENSION],
  mimeTypes: [PROJECT_MIME],
  maxBytes: MAX_PROJECT_ARCHIVE_BYTES,
  helpSlug: "image-projects",
  speedTier: "fast",
  supportsFind: false,
  editable: true,
  view: ImageEditor as unknown as Handler["view"],
  virtualView: ImageEditorForDocument,
};
