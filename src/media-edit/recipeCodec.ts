import type { DocumentCommitRequest } from "../services/documents";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  MediaRecipe,
  MediaSource,
  MediaSubtitleCue,
  TimeUs,
} from "./types";
import {
  MEDIA_RECIPE_SCHEMA_VERSION,
  decodeMediaRecipe,
  isMediaSafeInteger,
  mediaEditFail,
  mediaRecipeBytes,
  mediaRecipeJson,
  newMediaId,
  validateMediaRecipe,
} from "./types";
import { withRelinkedSource } from "./timing";

/**
 * The documented `.admedia` recipe file (`D1`, T5).
 *
 * The file contains only the canonical recipe fields. It never stores
 * grants, helper grants, passwords or media bytes, so a recipe copied to
 * another computer still needs its source files.
 */

export const RECIPE_EXTENSION = "admedia";
export const RECIPE_FILE_MIME = "application/vnd.adperastra.media-edit+json";
/** The UI always shows why saving and exporting differ. */
export const RECIPE_EXPORT_NOTICE_KEYS = ["mediaEdit.recipeNotice"] as const;

export interface RecipeDocument {
  recipe: MediaRecipe;
  /** Canonical UTF-8 bytes, at most 16 MiB. */
  bytes: Uint8Array;
}

/** Encodes a recipe document, validating every bound first. */
export function encodeRecipeDocument(recipe: MediaRecipe): RecipeDocument {
  const checked = validateMediaRecipe(recipe);
  return { recipe: checked, bytes: mediaRecipeBytes(checked) };
}

/** Reads a recipe document from bytes; unknown fields are refused. */
export function decodeRecipeDocument(bytes: Uint8Array | string): MediaRecipe {
  return decodeMediaRecipe(bytes);
}

/** Canonical text for diagnostics, never for a second codec. */
export function recipeDocumentText(recipe: MediaRecipe): string {
  return mediaRecipeJson(recipe);
}

/** `<stem> - Edited.<ext>` (`D6`); numbering is 08a's publication job. */
export function editedMediaName(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = extension.replace(/^\./, "");
  if (!ext) mediaEditFail("media_edit.bad_request");
  return `${stem} - Edited.${ext}`;
}

/** A new recipe document name derived from a media file. */
export function recipeDocumentName(mediaName: string): string {
  return editedMediaName(mediaName, RECIPE_EXTENSION);
}

export interface RelinkResult {
  recipe: MediaRecipe;
  /** True when the replacement is not byte-identical to the old source. */
  changed: boolean;
}

/**
 * Relinks a missing source. Every edit is preserved. The replacement must
 * have the same stream kinds and be long enough for every existing segment;
 * a shorter or incompatible file is refused without changing the recipe.
 */
export function relinkMediaSource(
  recipe: MediaRecipe,
  sourceId: string,
  replacement: MediaSource,
): RelinkResult {
  const current = recipe.sources.find((source) => source.id === sourceId);
  if (!current) mediaEditFail("media_edit.missing_source");
  if (replacement.sensitive !== false) mediaEditFail("media_edit.unsupported");
  const hadVideo = current.video_rate !== null;
  const hasVideo = replacement.video_rate !== null;
  const hadAudio = current.audio_rate !== null;
  const hasAudio = replacement.audio_rate !== null;
  if (hadVideo !== hasVideo || hadAudio !== hasAudio) mediaEditFail("media_edit.unsupported");
  const longest = recipe.segments
    .filter((segment) => segment.source_id === sourceId)
    .reduce((end, segment) => Math.max(end, segment.end_us), 0);
  if (replacement.duration_us < longest) mediaEditFail("media_edit.unsupported");
  const next = withRelinkedSource(recipe, sourceId, replacement);
  const changed =
    current.path.toLowerCase() !== replacement.path.toLowerCase() ||
    current.stamp.file_id !== replacement.stamp.file_id ||
    current.stamp.modified_ticks !== replacement.stamp.modified_ticks ||
    current.stamp.size_bytes !== replacement.stamp.size_bytes;
  return { recipe: next, changed };
}

/** True while a recipe differs from the content id that was last saved. */
export function recipeIsDirty(recipe: MediaRecipe, savedContentId: string): boolean {
  return recipe.content_id !== savedContentId;
}

/** The 09a commit request for Save copy: never rebinds or clears dirty. */
export function createRecipeSaveCopyRequest(
  documentId: string,
  snapshot: ExportSnapshot,
  recipe: MediaRecipe,
  destPath: string,
): DocumentCommitRequest {
  if (snapshot.mime !== RECIPE_FILE_MIME) mediaEditFail("media_edit.unsupported");
  if (recipe.content_id !== snapshot.content_id || snapshot.revision < 1) {
    mediaEditFail("media_edit.changed");
  }
  if (typeof destPath !== "string" || !/^(?:[A-Za-z]:\\|\\\\)/.test(destPath)) {
    mediaEditFail("media_edit.bad_request");
  }
  return {
    document_id: documentId,
    snapshot_id: snapshot.snapshot_id,
    captured_revision: snapshot.revision,
    content_id: snapshot.content_id,
    expected_source: snapshot.source ?? undefined,
    mode: "copy",
    dest_path: destPath,
  };
}

export interface RecipeViewState {
  version: 1;
  position_us: TimeUs;
  selected_segment_id: string | null;
  active_source_id: string | null;
}

const MAX_VIEW_POSITION_US = 24 * 60 * 60 * 1_000_000;

function emptyViewState(): RecipeViewState {
  return { version: 1, position_us: 0, selected_segment_id: null, active_source_id: null };
}

/** Bounded view state for tab restore (`D6` of 09a). */
export const recipeViewStateCodec = {
  version: 1,
  encode(value: unknown): RecipeViewState | null {
    if (!value || typeof value !== "object") return emptyViewState();
    const input = value as Partial<RecipeViewState>;
    const position =
      isMediaSafeInteger(input.position_us) && input.position_us <= MAX_VIEW_POSITION_US
        ? input.position_us
        : 0;
    return {
      version: 1,
      position_us: position,
      selected_segment_id: typeof input.selected_segment_id === "string" ? input.selected_segment_id : null,
      active_source_id: typeof input.active_source_id === "string" ? input.active_source_id : null,
    };
  },
  decode(value: unknown): RecipeViewState {
    return recipeViewStateCodec.encode(value) ?? emptyViewState();
  },
};

/** A cue list grouped for the properties panel; there is no hidden copy. */
export function subtitleSummary(recipe: MediaRecipe): {
  count: number;
  first_us: TimeUs | null;
  last_us: TimeUs | null;
} {
  if (recipe.subtitles.length === 0) return { count: 0, first_us: null, last_us: null };
  const cues: MediaSubtitleCue[] = recipe.subtitles;
  return {
    count: cues.length,
    first_us: cues[0].start_us,
    last_us: cues[cues.length - 1].end_us,
  };
}

/** The schema value a future recipe reader must see. */
export function recipeSchemaVersion(): number {
  return MEDIA_RECIPE_SCHEMA_VERSION;
}

/** A stable project id for a recipe created in tests or by 19a import. */
export function newRecipeProjectId(): string {
  return newMediaId();
}
