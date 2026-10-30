import { Binary } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Hex viewer (Step 04c): the bytes of any file. It has no extensions and
 * no content types, so it is never chosen by itself; only "Open as hex"
 * uses it (plan/rules.md R-OPEN-2). */
export const hexHandler: Handler = {
  id: "hex",
  version: 1,
  labelKey: "handlers.hex",
  icon: Binary,
  accent: "explorer",
  extensions: [],
  mimeTypes: [],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "open-as-text-or-hex",
  speedTier: "fast",
  supportsFind: false,
  view: lazy(() => import("./HexView")),
};
