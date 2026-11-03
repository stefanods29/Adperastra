import { FileText } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** PDF documents (Step 07d): pages, text selection, outline, search and
 * printing, parsed by PDF.js in a separate trusted helper process. Read-only:
 * the viewer has no editing commands (annotations arrive in Step 14a). */
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
  editable: false,
  view: lazy(() => import("./PdfView")),
};
