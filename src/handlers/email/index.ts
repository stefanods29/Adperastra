import { Mail } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { MAX_EMAIL_SOURCE_BYTES } from "../../services/extraViews";

/** Saved EML email (Step 07f). Remote images and links are removed;
 * attachments are only listed until the user asks to open one. */
export const emailHandler: Handler = {
  id: "email",
  version: 1,
  labelKey: "handlers.email",
  icon: Mail,
  accent: "explorer",
  extensions: ["eml"],
  mimeTypes: ["message/rfc822"],
  priorityExtensions: ["eml"],
  maxBytes: MAX_EMAIL_SOURCE_BYTES,
  helpSlug: "viewing-email",
  speedTier: "fast",
  supportsFind: true,
  editable: false,
  view: lazy(() => import("./EmailView")),
};
