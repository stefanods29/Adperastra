import { Clapperboard } from "lucide-react";
import { lazy } from "react";

import {
  TIMELINE_EXTENSION,
  TIMELINE_HANDLER_ID,
  TIMELINE_MAX_PROJECT_BYTES,
  TIMELINE_MIME,
} from "../../timeline/types";
import type { Handler } from "../types";

/**
 * The `.adtimeline` project handler (Step 19a D1). It owns the PowerPoint
 * accent, the exact project MIME and a 16 MiB cap; the controller is the
 * shared 09a document controller.
 */
export const timelineProjectHandler: Handler = {
  id: TIMELINE_HANDLER_ID,
  version: 1,
  labelKey: "handlers.timeline",
  icon: Clapperboard,
  accent: "powerpoint",
  extensions: [TIMELINE_EXTENSION],
  // The project is JSON text: an unknown extension is detected as
  // text/plain, so the timeline must win against the generic text viewer.
  priorityExtensions: [TIMELINE_EXTENSION],
  mimeTypes: [TIMELINE_MIME],
  maxBytes: TIMELINE_MAX_PROJECT_BYTES,
  helpSlug: "timeline",
  speedTier: "fast",
  supportsFind: false,
  editable: true,
  view: lazy(() => import("./TimelineProjectView")),
};
