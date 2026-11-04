import { Braces } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** JSON files (Step 06f): a tree you can fold, search and copy from. A file
 * with an error, or with comments, is offered to the text viewer. */
export const jsonHandler: Handler = {
  id: "json",
  version: 1,
  labelKey: "handlers.json",
  icon: Braces,
  accent: "explorer",
  extensions: ["json", "geojson", "webmanifest"],
  mimeTypes: ["application/json"],
  maxBytes: 33_554_432,
  helpSlug: "viewing-json",
  speedTier: "fast",
  supportsFind: true,
  view: lazy(() => import("./JsonView")),
};
