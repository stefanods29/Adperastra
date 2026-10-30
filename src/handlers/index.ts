import { imageHandler } from "./image";
import { HandlerRegistry } from "./registry";
import { textHandler } from "./text";

/** Every built-in handler, in priority order for ties. Later steps add
 * theirs here (04b text and Markdown, 04c media, ...). */
export function createHandlerRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register(imageHandler);
  registry.register(textHandler);
  return registry;
}

/** One registry for the whole app. */
export const handlers = createHandlerRegistry();
