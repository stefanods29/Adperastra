import { BookOpen } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Markdown, shown rendered or as source (Step 04b). Bigger files open in
 * the text viewer instead. */
export const markdownHandler: Handler = {
  id: "markdown",
  version: 1,
  labelKey: "handlers.markdown",
  icon: BookOpen,
  accent: "explorer",
  extensions: ["md", "markdown", "mdown", "mkd"],
  mimeTypes: ["text/markdown"],
  maxBytes: 5 * 1024 * 1024,
  helpSlug: "viewing-markdown",
  speedTier: "fast",
  supportsFind: true,
  view: lazy(() => import("./MarkdownView")),
};
