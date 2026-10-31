import { archiveHandler } from "./archive";
import { fontHandler } from "./font";
import { hexHandler } from "./hex";
import { jsonHandler } from "./json";
import { imageHandler } from "./image";
import { markdownHandler } from "./markdown";
import { mediaHandler } from "./media";
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
  // Markdown before text: ties on ".md" go to the Markdown viewer.
  registry.register(markdownHandler);
  // The table viewer before text: ".csv" and ".tsv" go to the table, and a
  // table over its size limit still falls back to the text viewer.
  registry.register(tableHandler);
  // The JSON tree before text: ".json" files open as a tree, and a file over
  // its size limit still falls back to the text viewer.
  registry.register(jsonHandler);
  registry.register(textHandler);
  // Never chosen by itself (no extensions or types): only "Open as hex".
  registry.register(hexHandler);
  registry.register(archiveHandler);
  return registry;
}

/** One registry for the whole app. */
export const handlers = createHandlerRegistry();
