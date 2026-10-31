import { Table2 } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** CSV and TSV files (Step 06f): a read-only table that sorts and filters in
 * Rust, so a million rows scroll smoothly. */
export const tableHandler: Handler = {
  id: "table",
  version: 1,
  labelKey: "handlers.table",
  icon: Table2,
  accent: "excel",
  extensions: ["csv", "tsv"],
  mimeTypes: [],
  maxBytes: 134_217_728,
  helpSlug: "viewing-tables",
  speedTier: "fast",
  supportsFind: true,
  view: lazy(() => import("./TableView")),
};
