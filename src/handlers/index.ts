import { imageHandler } from "./image";
import { markdownHandler } from "./markdown";
import { mediaHandler } from "./media";
import { HandlerRegistry } from "./registry";
import { textHandler } from "./text";

/** Every built-in handler, in priority order for ties. Later steps add
 * theirs here (04b text and Markdown, 04c media, ...). */
export function createHandlerRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register(imageHandler);
  registry.register(mediaHandler);
  // Markdown before text: ties on ".md" go to the Markdown viewer.
  registry.register(markdownHandler);
  registry.register(textHandler);
  return registry;
}

/** One registry for the whole app. */
export const handlers = createHandlerRegistry();
