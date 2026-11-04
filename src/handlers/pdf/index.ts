import { FileText } from "lucide-react";
import { lazy, type ComponentType } from "react";
import type { VirtualViewProps } from "../../documents/types";
import { registerPdfEditIntegration } from "../../pdf-edit/PdfDocument";
import type { Handler } from "../types";

/** PDF documents (Step 07d read-only viewer, Step 14a editing).
 *
 * The same handler keeps the one `.pdf`/`application/pdf` claim. Disk tabs
 * get the editable presenter through the 09a document controller; hosts
 * without a `DocumentHandle` still use the read-only `PdfView` for preview,
 * protected-view and fallback paths. The edit controller factory and both
 * native host ports are registered once when this module loads with the
 * handler registry, never from a mounted view. */

registerPdfEditIntegration();

const PdfEditor = lazy(() => import("../../pdf-edit/PdfEditor"));
const PdfEditorForDocument = PdfEditor as unknown as ComponentType<VirtualViewProps>;

export const pdfHandler: Handler = {
  id: "pdf",
  version: 1,
  labelKey: "handlers.pdf",
  icon: FileText,
  accent: "pdf",
  extensions: ["pdf"],
  mimeTypes: ["application/pdf"],
  maxBytes: 512 * 1024 * 1024,
  helpSlug: "viewing-pdfs",
  speedTier: "fast",
  supportsFind: true,
  editable: true,
  view: lazy(() => import("./PdfView")),
  virtualView: PdfEditorForDocument,
};
