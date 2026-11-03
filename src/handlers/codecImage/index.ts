import { Image } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** HEIC/HEIF images (Step 07g). AVIF stays in the existing image handler;
 * this handler never competes for it. Codec absence is explicit. */
export const codecImageHandler: Handler = {
  id: "codecImage",
  version: 1,
  labelKey: "handlers.codecImage",
  icon: Image,
  accent: "image",
  extensions: ["heic", "heif"],
  mimeTypes: ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-heic-and-avif",
  speedTier: "fast",
  supportsFind: false,
  editable: false,
  view: lazy(() => import("./CodecImageView")),
};
