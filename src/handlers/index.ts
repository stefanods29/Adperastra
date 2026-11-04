import { modelHandler } from "./model";
import { imageProjectHandler } from "./image-project";
import { mediaRecipeHandler } from "./media-recipe";
import { officeHandlers } from "./office";
import { timelineProjectHandler } from "./timeline-project";
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
import { lockedTextHandler } from "./locked";
import type { SerializableViewState } from "../documents/types";
import { deckViewStateCodec } from "../office/deck/deckViewState";
import { documentViewStateCodec } from "../office/document/documentViewState";
import { sheetViewStateCodec } from "../office/sheet/sheetViewState";
import { recipeViewStateCodec } from "../media-edit/recipeCodec";
import { TIMELINE_HANDLER_ID } from "../timeline/types";
import {
  decodeTimelineViewState,
  encodeTimelineViewState,
} from "../timeline/timelineViewTypes";
import {
  imageViewStateCodec,
  mediaViewStateCodec,
  registerViewStateCodec,
  textViewStateCodec,
  viewStateCodec,
  type ViewStateCodec,
} from "../services/viewState";

/** Every built-in handler, in priority order for ties. Later steps add
 * theirs here (04b text and Markdown, 04c media, ...). */
export function createHandlerRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register(imageHandler);
  registry.register(imageProjectHandler);
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
  // Read-only Office viewers before the text fallback; they claim only their
  // exact Office extensions/MIME, never application/zip (Step 13).
  for (const officeHandler of officeHandlers) registry.register(officeHandler);
  // JSON project/recipe files before text (Steps 15 and 19a); their
  // priority extensions beat a generic text/plain detection.
  registry.register(mediaRecipeHandler);
  registry.register(timelineProjectHandler);
  registry.register(modelHandler);
  registry.register(rawHandler);
  registry.register(codecImageHandler);
  registry.register(psdHandler);
  registry.register(textHandler);
  // Virtual locked entries only: no disk extension or MIME selects it.
  registry.register(lockedTextHandler);
  // Never chosen by itself (no extensions or types): only "Open as hex".
  registry.register(hexHandler);
  registry.register(archiveHandler);
  return registry;
}

/** Adapt a statically typed codec to the shared `ViewStateCodec` surface.
 * The encoded value is validated by `encodeViewState` before it is stored,
 * so the cast only bridges the codec's concrete state type. */
function serializableCodec(codec: {
  version: number;
  encode: (state: unknown) => unknown;
  decode: (state: unknown) => unknown;
}): ViewStateCodec {
  return {
    version: codec.version,
    encode: (state) => {
      const encoded = codec.encode(state);
      return encoded === null || encoded === undefined
        ? null
        : (encoded as SerializableViewState);
    },
    decode: (state) => codec.decode(state),
  };
}

/** Register static session codecs once. `office-word`, `office-sheet` and
 * `office-slide` store their editors' own view states (Steps 20b, 21a and
 * 22a); the read-only presenters still fall back to their defaults when a
 * saved editor state does not apply. */
export function registerBuiltInViewStateCodecs(): void {
  const builtins: readonly [string, ViewStateCodec][] = [
    ["image", imageViewStateCodec],
    ["media", mediaViewStateCodec],
    ["text", textViewStateCodec],
    ["media-recipe", serializableCodec(recipeViewStateCodec)],
    [TIMELINE_HANDLER_ID, serializableCodec({
      version: 1,
      encode: (state) => encodeTimelineViewState(decodeTimelineViewState(state)),
      decode: (state) => decodeTimelineViewState(state),
    })],
    // The Office editors own their canonical 09a view states (Steps 20b,
    // 21a and 22a); the slide editor mounts through the probing `office-slide`
    // presenter, so its saved state must use the deck codec as well.
    ["office-word", documentViewStateCodec],
    ["office-sheet", serializableCodec(sheetViewStateCodec)],
    ["office-slide", deckViewStateCodec],
  ];
  for (const [id, codec] of builtins) {
    if (!viewStateCodec(id)) registerViewStateCodec(id, codec);
  }
}

registerBuiltInViewStateCodecs();

/** One registry for the whole app. */
export const handlers = createHandlerRegistry();
