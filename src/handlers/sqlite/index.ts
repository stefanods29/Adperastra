import { Database } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { MAX_SQLITE_SOURCE_BYTES } from "../../services/extraViews";

/** SQLite databases (Step 07f). Physical tables only, read-only flags,
 * no SQL console, no extension and no write. `.db` is claimed only when the
 * content is recognized as SQLite (T7). */
export const sqliteHandler: Handler = {
  id: "sqlite",
  version: 1,
  labelKey: "handlers.sqlite",
  icon: Database,
  accent: "explorer",
  extensions: ["sqlite", "sqlite3", "db"],
  mimeTypes: ["application/vnd.sqlite3", "application/x-sqlite3"],
  priorityExtensions: ["sqlite", "sqlite3", "db"],
  contentExtensions: ["db"],
  maxBytes: MAX_SQLITE_SOURCE_BYTES,
  helpSlug: "viewing-sqlite",
  speedTier: "fast",
  supportsFind: true,
  editable: false,
  view: lazy(() => import("./SqliteView")),
};
