import type { FileTypeInfo } from "../services/files";
import type { Handler } from "./types";

/** Score of a handler for a file (Step 07f additive rules):
 * 90 when a specific extension claims a generic text/JSON/octet-stream MIME
 * (the subtitle, log, notebook, book, Office, media-recipe and timeline
 * viewers), 80 when the content type is one the handler lists, 50 when only
 * the extension matches, 0 otherwise. A `contentExtensions` extension
 * (`.db`) never scores without the matching content type, so a mislabelled
 * database stays in the user's chosen app. */
export function handlerScore(handler: Handler, info: FileTypeInfo): number {
  if (
    info.ext !== "" &&
    handler.contentExtensions?.includes(info.ext) &&
    !handler.mimeTypes.includes(info.mime)
  ) {
    return 0;
  }
  if (info.ext !== "" && handler.priorityExtensions?.includes(info.ext)) {
    const generic =
      info.mime === "application/octet-stream" ||
      info.mime === "text/plain" ||
      info.mime === "application/json";
    if (generic || handler.mimeTypes.includes(info.mime)) return 90;
  }
  if (handler.mimeTypes.includes(info.mime)) return 80;
  if (info.ext !== "" && handler.extensions.includes(info.ext)) return 50;
  return 0;
}

export class HandlerRegistry {
  private handlers: Handler[] = [];

  register(handler: Handler): void {
    if (this.handlers.some((existing) => existing.id === handler.id)) {
      throw new Error(`duplicate handler id: ${handler.id}`);
    }
    this.handlers.push(handler);
  }

  get(id: string): Handler | undefined {
    return this.handlers.find((handler) => handler.id === id);
  }

  list(): readonly Handler[] {
    return this.handlers;
  }

  /** The best handler for a file, or null (open it in the Windows app).
   * Ties go to the handler registered first. Files bigger than a
   * handler's `maxBytes` are not given to it. */
  pick(info: FileTypeInfo): Handler | null {
    let best: Handler | null = null;
    let bestScore = 0;
    for (const handler of this.handlers) {
      const score = handlerScore(handler, info);
      if (score > bestScore && info.size <= handler.maxBytes) {
        best = handler;
        bestScore = score;
      }
    }
    return best;
  }
}
