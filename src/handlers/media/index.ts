import { Film } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "./helpers";

/** Audio and video the built-in player plays (Step 04c). Other formats
 * (MKV, AVI, WMV, MOV...) open in their Windows app. Any size: the player
 * reads only the parts it needs. */
export const mediaHandler: Handler = {
  id: "media",
  version: 1,
  labelKey: "handlers.media",
  icon: Film,
  accent: "explorer",
  extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS],
  mimeTypes: [
    "video/mp4",
    "video/x-m4v",
    "video/webm",
    "audio/mpeg",
    "audio/m4a",
    "audio/mp4",
    "audio/aac",
    "audio/x-wav",
    "audio/wav",
    "audio/ogg",
    "audio/opus",
    "audio/x-flac",
    "audio/flac",
    "audio/webm",
  ],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "playing-audio-and-video",
  speedTier: "fast",
  supportsFind: false,
  view: lazy(() => import("./MediaView")),
};
