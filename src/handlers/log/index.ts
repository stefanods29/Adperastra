import { ScrollText } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { MAX_LOG_SOURCE_BYTES } from "../../services/extraViews";

/** Streamed logs (Step 07f). Pages are read by ranges; the file is never
 * loaded whole and never changed. Registered before plain text. */
export const logHandler: Handler = {
  id: "log",
  version: 1,
  labelKey: "handlers.log",
  icon: ScrollText,
  accent: "explorer",
  extensions: ["log"],
  mimeTypes: ["text/x-log"],
  priorityExtensions: ["log"],
  maxBytes: MAX_LOG_SOURCE_BYTES,
  helpSlug: "viewing-logs",
  speedTier: "fast",
  supportsFind: true,
  editable: false,
  view: lazy(() => import("./LogView")),
};
