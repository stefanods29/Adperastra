import { FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** The three Office handlers (Step 13 D1). They are separate so a
 * spreadsheet gets the grid, a deck gets presentation controls and a text
 * document gets the paged presenter; each `virtualView` probes its approved
 * editor and keeps the Step 13 read-only presenter as the fallback. None
 * advertises a save capability. `application/zip` is deliberately absent:
 * Office containers are matched by their exact extension/MIME, never as
 * archives. */
const OFFICE_MAX_BYTES = 512 * 1024 * 1024;

export const officeWordHandler: Handler = {
  id: "office-word",
  version: 1,
  labelKey: "office.word",
  icon: FileText,
  accent: "word",
  extensions: ["docx", "odt", "rtf", "doc"],
  // Office extensions stay with this viewer even when detection reports a
  // generic text type (an .rtf file is plain text to the detector).
  priorityExtensions: ["docx", "odt", "rtf", "doc"],
  mimeTypes: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.oasis.opendocument.text",
    "application/rtf",
    "application/msword",
  ],
  maxBytes: OFFICE_MAX_BYTES,
  helpSlug: "viewing-office",
  speedTier: "waiting",
  supportsFind: false,
  // The 20b editor is selected through the virtual presenter, but the
  // handler stays non-editable while no approved engine exists; the
  // presenter falls back to the Step 13 read-only viewer.
  editable: false,
  view: lazy(() => import("./OfficeView")),
  virtualView: lazy(() => import("./DocumentView")),
};

export const officeSheetHandler: Handler = {
  id: "office-sheet",
  // Version 2 shows the Step 21a editing presenter when its approved engine
  // exists and the Step 13 read-only presenter otherwise. Editable stays
  // false: the presenter probes the engine itself and the handler must not
  // acquire an editor (or recovery capture) for a missing engine.
  version: 2,
  labelKey: "office.sheet",
  icon: FileSpreadsheet,
  accent: "excel",
  extensions: ["xlsx", "ods", "xls"],
  priorityExtensions: ["xlsx", "ods", "xls"],
  mimeTypes: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.ms-excel",
  ],
  maxBytes: OFFICE_MAX_BYTES,
  helpSlug: "viewing-office",
  speedTier: "waiting",
  supportsFind: false,
  editable: false,
  view: lazy(() => import("./OfficeView")),
  virtualView: lazy(() => import("./SheetView")),
};

export const officeSlideHandler: Handler = {
  id: "office-slide",
  // Version 2 shows the Step 22a editing presenter when its approved engine
  // exists and the Step 13 read-only presenter otherwise.
  version: 2,
  labelKey: "office.slide",
  icon: Presentation,
  accent: "powerpoint",
  extensions: ["pptx", "odp", "ppt"],
  priorityExtensions: ["pptx", "odp", "ppt"],
  mimeTypes: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.ms-powerpoint",
  ],
  maxBytes: OFFICE_MAX_BYTES,
  helpSlug: "viewing-office",
  speedTier: "waiting",
  supportsFind: false,
  // Version 2 shows the Step 22a editing presenter when its approved engine
  // exists and the Step 13 read-only presenter otherwise. Editable stays
  // false: the presenter probes the engine itself and the handler must not
  // acquire an editor (or recovery capture) for a missing engine.
  editable: false,
  view: lazy(() => import("./OfficeView")),
  virtualView: lazy(() => import("./DeckView")),
};

export const officeHandlers: readonly Handler[] = [
  officeWordHandler,
  officeSheetHandler,
  officeSlideHandler,
];
