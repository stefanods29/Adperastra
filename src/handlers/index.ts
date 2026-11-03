import { modelHandler } from "./model";
import { rawHandler } from "./raw";
import { codecImageHandler } from "./codecImage";
import { psdHandler } from "./psd";
import { archiveHandler } from "./archive";
import { bookHandler } from "./book";
import { emailHandler } from "./email";
import { fontHandler } from "./font";
import { logHandler } from "./log";
import { notebookHandler } from "./notebook";
import { subtitleHandler } from "./subtitle";
import { sqliteHandler } from "./sqlite";
import { hexHandler } from "./hex";
import { jsonHandler } from "./json";
import { imageHandler } from "./image";
import { markdownHandler } from "./markdown";
import { mediaHandler } from "./media";
import { pdfHandler } from "./pdf";
import { HandlerRegistry } from "./registry";
import { tableHandler } from "./table";
import { textHandler } from "./text";

/** Every built-in handler, in priority order for ties. Later steps add
 * theirs here (04b text and Markdown, 04c media, ...). */
export function createHandlerRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register(imageHandler);
  registry.register(mediaHandler);
  registry.register(fontHandler);
  // PDF wins before any text fallback (Step 07d).
  registry.register(pdfHandler);
  // Extra read-only viewers before the generic text/JSON/table handlers:
  // their extension lists overlap text/JSON (Step 07f T7).
  registry.register(bookHandler);
  registry.register(notebookHandler);
  registry.register(emailHandler);
  registry.register(subtitleHandler);
  registry.register(logHandler);
  registry.register(sqliteHandler);
  // Markdown before text: ties on ".md" go to the Markdown viewer.
  registry.register(markdownHandler);
  // The table viewer before text: ".csv" and ".tsv" go to the table, and a
  // table over its size limit still falls back to the text viewer.
  registry.register(tableHandler);
  // The JSON tree before text: ".json" files open as a tree, and a file over
  // its size limit still falls back to the text viewer.
  registry.register(jsonHandler);
  registry.register(modelHandler);
  registry.register(rawHandler);
  registry.register(codecImageHandler);
  registry.register(psdHandler);
  registry.register(textHandler);
  // Never chosen by itself (no extensions or types): only "Open as hex".
  registry.register(hexHandler);
  registry.register(archiveHandler);
  return registry;
}

/** One registry for the whole app. */
export const handlers = createHandlerRegistry();
