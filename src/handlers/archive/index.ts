import { Archive } from "lucide-react";
import { lazy } from "react";
import { ARCHIVE_EXTENSIONS } from "../../archive/archiveFiles";
import type { Handler } from "../types";

const ArchiveView = lazy(() => import("./ArchiveView"));

/** Archives (Step 06d): zip, 7z, tar, tar.gz, tar.xz, gz and xz, opened like
 * folders. No content types: a .docx is a zip by content too, and Office
 * files belong to their own viewers. */
export const archiveHandler: Handler = {
  id: "archive",
  version: 1,
  labelKey: "handlers.archive",
  icon: Archive,
  accent: "explorer",
  extensions: ARCHIVE_EXTENSIONS,
  mimeTypes: [],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "archives",
  speedTier: "waiting",
  supportsFind: true,
  view: ArchiveView,
};
