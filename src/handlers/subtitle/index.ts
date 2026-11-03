import { Captions } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { MAX_SUBTITLE_SOURCE_BYTES } from "../../services/extraViews";

/** SRT and WebVTT subtitles (Step 07f). Times are exact milliseconds and
 * selecting a cue never starts media or runs markup. */
export const subtitleHandler: Handler = {
  id: "subtitle",
  version: 1,
  labelKey: "handlers.subtitle",
  icon: Captions,
  accent: "explorer",
  extensions: ["srt", "vtt"],
  mimeTypes: ["application/x-subrip", "text/vtt"],
  priorityExtensions: ["srt", "vtt"],
  maxBytes: MAX_SUBTITLE_SOURCE_BYTES,
  helpSlug: "viewing-subtitles",
  speedTier: "fast",
  supportsFind: true,
  editable: false,
  view: lazy(() => import("./SubtitleView")),
};
