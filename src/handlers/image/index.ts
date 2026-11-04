import { Image } from "lucide-react";
import { lazy, type ComponentType } from "react";
import { DocumentRegistry } from "../../documents/DocumentRegistry";
import { registerDocumentControllerFactory } from "../../documents/controller";
import type { VirtualViewProps } from "../../documents/types";
import type { Handler } from "../types";

/** The ordinary image handler is also the 09a document presenter for the
 * Step 14b editor. SVG stays on the read-only `ImageView` (the editor refuses
 * markup); FileTabView keeps that route and the factory repeats the check. */
const ImageEditor = lazy(() => import("../../image-edit/ImageEditor"));
const ImageEditorForDocument = ImageEditor as unknown as ComponentType<VirtualViewProps>;

let controllerRegistered = false;

function registerImageEditorController(): void {
  if (controllerRegistered) return;
  controllerRegistered = true;
  registerDocumentControllerFactory("image", async (context) => {
    if (context.info.ext.toLowerCase() === "svg") throw new Error("image_edit.bad_request");
    const document = DocumentRegistry.get(context.document_id);
    if (!document) throw new Error("documents.not_open");
    // The editor graph (workers, project codec) loads only when an image is
    // actually edited, never at startup.
    const { acquireImageEditor, imageControllerBinding } = await import("../../image-edit/ImageDocument");
    const controller = await acquireImageEditor(document);
    return imageControllerBinding(context, controller);
  });
}

registerImageEditorController();

export const imageHandler: Handler = {
  id: "image",
  version: 2,
  labelKey: "handlers.image",
  icon: Image,
  accent: "image",
  extensions: ["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "svg", "avif"],
  mimeTypes: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/avif",
    "image/svg+xml",
  ],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-images",
  speedTier: "fast",
  supportsFind: true,
  editable: true,
  view: lazy(() => import("./ImageView")),
  virtualView: ImageEditorForDocument,
};
