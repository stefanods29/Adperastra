import { Film } from "lucide-react";
import { lazy, type ComponentType } from "react";
import type { VirtualViewProps } from "../../documents/types";
import {
  installMediaRecipeController,
  MEDIA_RECIPE_HANDLER_ID,
} from "../../media-edit/MediaDocument";
import { MEDIA_EDIT_MIME, MAX_MEDIA_RECIPE_BYTES } from "../../media-edit/types";
import type { Handler } from "../types";

/**
 * The `.admedia` recipe handler (T5).
 *
 * A recipe is a document, not a media file: it is presented through the 09a
 * document controller (`virtualView`) so the original media tab stays an
 * ordinary player. The same component is listed as `view` for hosts that
 * have not yet passed a DocumentHandle; such a host shows the translated
 * media-edit error instead of pretending to edit.
 */

const MediaEditor = lazy(() => import("../../media-edit/MediaEditor"));
const MediaEditorForDocument = MediaEditor as unknown as ComponentType<VirtualViewProps>;

// 09a asks for the editor factory while the tab mounts; register it with the
// handler instead of waiting for the lazy editor to load.
installMediaRecipeController();

export type MediaRecipeHandler = Handler & {
  /** Additive 09a field: a document presenter, not a disk viewer. */
  virtualView: ComponentType<VirtualViewProps>;
};

export const mediaRecipeHandler: MediaRecipeHandler = {
  id: MEDIA_RECIPE_HANDLER_ID,
  version: 1,
  labelKey: "handlers.mediaRecipe",
  icon: Film,
  accent: "explorer",
  extensions: ["admedia"],
  // A recipe is JSON text: file detection reports text/plain for an unknown
  // extension, so the recipe must claim its own extension before the text
  // viewer scores the generic content type.
  priorityExtensions: ["admedia"],
  mimeTypes: [MEDIA_EDIT_MIME],
  maxBytes: MAX_MEDIA_RECIPE_BYTES,
  helpSlug: "media-trimming",
  speedTier: "fast",
  supportsFind: false,
  editable: true,
  view: MediaEditor as unknown as Handler["view"],
  virtualView: MediaEditorForDocument,
};
