import { Type } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Font files (Step 06f): a sample sheet, the font's details, its character
 * map, and Install through Windows' own install verb. */
export const fontHandler: Handler = {
  id: "font",
  version: 1,
  labelKey: "handlers.font",
  icon: Type,
  accent: "explorer",
  extensions: ["ttf", "otf", "ttc", "woff", "woff2"],
  mimeTypes: ["font/ttf", "font/otf", "font/collection", "font/woff", "font/woff2"],
  maxBytes: 67_108_864,
  helpSlug: "viewing-fonts",
  speedTier: "fast",
  supportsFind: false,
  view: lazy(() => import("./FontView")),
};
