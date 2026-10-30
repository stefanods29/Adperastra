import { Image } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

export const imageHandler: Handler = {
  id: "image",
  version: 1,
  labelKey: "handlers.image",
  icon: Image,
  accent: "image",
  extensions: ["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "svg", "avif"],
  mimeTypes: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/avif",
    "image/svg+xml",
  ],
  maxBytes: 256 * 1024 * 1024,
  helpSlug: "viewing-images",
  speedTier: "fast",
  supportsFind: false,
  view: lazy(() => import("./ImageView")),
};
