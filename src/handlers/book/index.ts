import { BookOpen } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { MAX_BOOK_SOURCE_BYTES } from "../../services/extraViews";

/** EPUB, MOBI and AZW3 books (Step 07f). Read-only, parser-only helper,
 * empty-sandbox pages. Registered before the generic text handler. */
export const bookHandler: Handler = {
  id: "book",
  version: 1,
  labelKey: "handlers.book",
  icon: BookOpen,
  accent: "explorer",
  extensions: ["epub", "mobi", "azw3"],
  mimeTypes: ["application/epub+zip", "application/x-mobipocket-ebook"],
  priorityExtensions: ["epub", "mobi", "azw3"],
  maxBytes: MAX_BOOK_SOURCE_BYTES,
  helpSlug: "reading-e-books",
  speedTier: "fast",
  supportsFind: true,
  editable: false,
  view: lazy(() => import("./BookView")),
};
