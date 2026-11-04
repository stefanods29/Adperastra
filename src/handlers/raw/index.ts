import { Camera } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Camera RAW files (Step 07g): WIC embedded preview first, full decode
 * only by explicit request. */
export const rawHandler: Handler = {
  id: "raw",
  version: 1,
  labelKey: "handlers.raw",
  icon: Camera,
  accent: "image",
  extensions: ["cr2", "cr3", "nef", "arw", "dng", "raf", "orf", "rw2"],
  mimeTypes: [
    "image/x-canon-cr2",
    "image/x-canon-cr3",
    "image/x-nikon-nef",
    "image/x-sony-arw",
    "image/x-adobe-dng",
    "image/x-fuji-raf",
    "image/x-olympus-orf",
    "image/x-panasonic-rw2",
  ],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-raw-images",
  speedTier: "fast",
  supportsFind: false,
  editable: false,
  view: lazy(() => import("./RawView")),
};
