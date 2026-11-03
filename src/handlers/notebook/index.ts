import { NotebookText } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { MAX_NOTEBOOK_SOURCE_BYTES } from "../../services/extraViews";

/** Jupyter notebooks (Step 07f). Code is text; outputs are inert and no
 * kernel, widget or JavaScript can run. Before the JSON tree and text. */
export const notebookHandler: Handler = {
  id: "notebook",
  version: 1,
  labelKey: "handlers.notebook",
  icon: NotebookText,
  accent: "explorer",
  extensions: ["ipynb"],
  mimeTypes: ["application/x-ipynb+json"],
  priorityExtensions: ["ipynb"],
  maxBytes: MAX_NOTEBOOK_SOURCE_BYTES,
  helpSlug: "viewing-notebooks",
  speedTier: "fast",
  supportsFind: true,
  editable: false,
  view: lazy(() => import("./NotebookView")),
};
