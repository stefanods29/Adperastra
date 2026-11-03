import { Layers } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Photoshop files (Step 07g): the saved composite and layer names only. */
export const psdHandler: Handler = {
  id: "psd",
  version: 1,
  labelKey: "handlers.psd",
  icon: Layers,
  accent: "image",
  extensions: ["psd"],
  mimeTypes: ["image/vnd.adobe.photoshop", "image/x-photoshop", "image/psd"],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-psd",
  speedTier: "fast",
  supportsFind: false,
  editable: false,
  view: lazy(() => import("./PsdView")),
};
