import { invoke } from "@tauri-apps/api/core";
import type {
  ConversionInput,
  ConversionReport,
  ConversionRequest,
} from "../convert/types";
import type { ExportSnapshot } from "./exportSnapshots";
import type {
  MediaPreviewQuality,
  MediaRecipe,
  MediaSource,
  WavePage,
} from "../media-edit/types";
import {
  MEDIA_EDIT_MIME,
  MAX_MEDIA_RECIPE_BYTES,
  WAVEFORM_BUCKETS_PER_PAGE,
  WAVEFORM_BUCKETS_PER_SECOND,
  WAVEFORM_MAX_CHANNELS,
  WAVEFORM_MAX_MINUTES,
  isMediaFinite,
  isMediaSafeInteger,
  mediaEditFail,
  mediaRecipeBytes,
  validateMediaRecipe,
  validateSourceStamp,
} from "../media-edit/types";
import type { CacheLease } from "./cache";
import { fileDetect } from "./files";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/**
 * Media editing services (`E3`/`E4`, `media-edit-1`).
 *
 * Only this file calls the native media edit commands. File bytes never
 * travel through these calls: a recipe export reads the captured 08a
 * snapshot natively, and a waveform answer is at most 512 numeric buckets.
 */

/** A request id prefix `runJob` accepts (1..12 lower-case letters). */
const EXPORT_PREFIX = "mediaexport";
const PROXY_PREFIX = "mediaproxy";

/** The largest bucket count for a 100-minute source at 100 buckets/s. */
export const MAX_WAVEFORM_BUCKETS = WAVEFORM_MAX_MINUTES * 60 * WAVEFORM_BUCKETS_PER_SECOND;

/** The snapshot input 08a needs for a recipe export. */
export function recipeSnapshotInput(snapshot: ExportSnapshot): ConversionInput {
  if (snapshot.mime !== MEDIA_EDIT_MIME) mediaEditFail("media_edit.unsupported");
  return {
    kind: "snapshot",
    snapshot_id: snapshot.snapshot_id,
    document_id: snapshot.document_id,
    revision: snapshot.revision,
  };
}

/** Refuses a recipe that these CLI engines cannot read safely (`D7`). */
export function assertMediaExportable(recipe: MediaRecipe): MediaRecipe {
  const checked = validateMediaRecipe(recipe);
  if (checked.sources.some((source) => source.sensitive)) mediaEditFail("media_edit.unsupported");
  if (checked.segments.length === 0) mediaEditFail("media_edit.bad_request");
  const bytes = mediaRecipeBytes(checked);
  if (bytes.byteLength > MAX_MEDIA_RECIPE_BYTES) mediaEditFail("media_edit.too_large");
  return checked;
}

/**
 * Starts the native recipe export (`E3`). The snapshot is the immutable
 * recipe capture; `request` already carries the chosen 08a converter and a
 * new destination. Native validation repeats every recipe bound before the
 * engine sees a file.
 */
export async function exportMediaRecipe(
  recipeSnapshot: ExportSnapshot,
  request: ConversionRequest,
): Promise<JobHandle<ConversionReport>> {
  if (!isTauriRuntime()) throw new Error("media_edit.failed");
  if (recipeSnapshot.mime !== MEDIA_EDIT_MIME) mediaEditFail("media_edit.unsupported");
  if (!request.keep_original) mediaEditFail("media_edit.read_only");
  if (request.inputs.length !== 1) mediaEditFail("media_edit.bad_request");
  const input = request.inputs[0];
  if (
    input.kind !== "snapshot" ||
    input.snapshot_id !== recipeSnapshot.snapshot_id ||
    input.document_id !== recipeSnapshot.document_id ||
    input.revision !== recipeSnapshot.revision
  ) {
    mediaEditFail("media_edit.changed");
  }
  return runJob<ConversionReport>(EXPORT_PREFIX, async (requestId) => {
    await invoke("media_recipe_export_start", {
      requestId,
      snapshotId: recipeSnapshot.snapshot_id,
      request,
    });
  });
}

function validateWaveSource(source: MediaSource): void {
  if (typeof source.id !== "string" || source.id.length < 1 || source.id.length > 128) {
    mediaEditFail("media_edit.bad_request");
  }
  if (typeof source.path !== "string" || !/^(?:[A-Za-z]:\\|\\\\)/.test(source.path)) {
    mediaEditFail("media_edit.bad_request");
  }
  validateSourceStamp(source.stamp);
  if (!isMediaSafeInteger(source.duration_us)) mediaEditFail("media_edit.bad_request");
  if (source.sensitive !== false) mediaEditFail("media_edit.unsupported");
}

function validateWavePage(page: WavePage, source: MediaSource, channel: number, firstBucket: number): WavePage {
  if (!page || page.source_id !== source.id || page.channel !== channel || page.first_bucket !== firstBucket) {
    mediaEditFail("media_edit.changed");
  }
  if (!isMediaSafeInteger(page.total_buckets) || page.total_buckets > MAX_WAVEFORM_BUCKETS) {
    mediaEditFail("media_edit.too_large");
  }
  if (!Array.isArray(page.buckets) || page.buckets.length > WAVEFORM_BUCKETS_PER_PAGE) {
    mediaEditFail("media_edit.too_large");
  }
  if (page.buckets.length > Math.max(0, page.total_buckets - firstBucket)) {
    mediaEditFail("media_edit.changed");
  }
  for (const peak of page.buckets) {
    if (!isMediaFinite(peak.min) || !isMediaFinite(peak.max)) mediaEditFail("media_edit.failed");
    if (peak.min < -1 || peak.max > 1 || peak.min > peak.max) mediaEditFail("media_edit.failed");
  }
  return page;
}

/** One bounded waveform page (`E4`); at most 512 buckets are returned. */
export async function waveformPage(
  source: MediaSource,
  channel: number,
  firstBucket: number,
): Promise<WavePage> {
  if (!isTauriRuntime()) throw new Error("media_edit.failed");
  validateWaveSource(source);
  if (!Number.isInteger(channel) || channel < 0 || channel >= WAVEFORM_MAX_CHANNELS) {
    mediaEditFail("media_edit.bad_request");
  }
  if (!isMediaSafeInteger(firstBucket) || firstBucket > 0xffff_ffff) mediaEditFail("media_edit.bad_request");
  const page = (await invoke("media_waveform_page", {
    source,
    channel,
    firstBucket,
  })) as WavePage;
  return validateWavePage(page, source, channel, firstBucket);
}

/** A cache identity for a proxy; a changed stamp is a different preview. */
export function mediaProxyKey(source: MediaSource, quality: Exclude<MediaPreviewQuality, "source">): string {
  const stamp = source.stamp;
  return [
    source.id,
    stamp.volume_id,
    stamp.file_id,
    stamp.modified_ticks,
    stamp.size_bytes,
    source.duration_us,
    quality,
  ].join(":");
}

/**
 * Requests an optional proxy (`D5`). A background request never hydrates an
 * online-only source; the caller must open such a file explicitly first.
 */
export async function startMediaProxy(
  source: MediaSource,
  quality: Exclude<MediaPreviewQuality, "source">,
): Promise<JobHandle<CacheLease>> {
  if (!isTauriRuntime()) throw new Error("media_edit.failed");
  validateWaveSource(source);
  if (quality !== "512" && quality !== "960") mediaEditFail("media_edit.bad_request");
  const info = await fileDetect(source.path);
  if (info.online_only) mediaEditFail("media_edit.unsupported");
  return runJob<CacheLease>(PROXY_PREFIX, async (requestId) => {
    await invoke("media_proxy_start", { requestId, source, quality });
  });
}

/** The default converter family of a recipe before the user picks a preset. */
export function defaultMediaConverterId(recipe: MediaRecipe): "media/video" | "media/audio" {
  return recipe.sources.some((source) => source.video_rate !== null) ? "media/video" : "media/audio";
}

export interface MediaExportRequestOptions {
  destDir: string;
  converterId: string;
  requestRevision?: number;
}

/**
 * Builds the 08a request for a captured recipe. Format-specific naming is
 * 08a's; this only supplies the documented stem pattern and the recipe's
 * typed media options (`D6`).
 */
export function buildMediaExportRequest(
  recipe: MediaRecipe,
  snapshot: ExportSnapshot,
  options: MediaExportRequestOptions,
): ConversionRequest {
  const checked = assertMediaExportable(recipe);
  if (typeof options.destDir !== "string" || !/^(?:[A-Za-z]:\\|\\\\)/.test(options.destDir)) {
    mediaEditFail("media_edit.bad_request");
  }
  if (typeof options.converterId !== "string" || !/^media\/[a-z0-9_/-]{1,48}$/.test(options.converterId)) {
    mediaEditFail("media_edit.bad_request");
  }
  const requestRevision =
    typeof options.requestRevision === "number" && Number.isInteger(options.requestRevision) && options.requestRevision >= 1
      ? options.requestRevision
      : 1;
  const dateUtc = new Date().toISOString().slice(0, 10);
  const sampleRate = checked.sources[0]?.audio_rate;
  return {
    inputs: [recipeSnapshotInput(snapshot)],
    converter_id: options.converterId,
    options: {
      kind: "media",
      value: {
        video_codec: "auto",
        audio_codec: "auto",
        keep_metadata: checked.metadata_keep,
        burn_subtitles: checked.subtitle_mode === "burn",
        speed: 1,
        volume: checked.volume,
        ...(sampleRate !== null && sampleRate !== undefined ? { sample_rate: sampleRate } : {}),
      },
    },
    dest_dir: options.destDir,
    keep_original: true,
    accepted_losses: [],
    accepted_warning_codes: [],
    request_revision: requestRevision,
    naming: {
      pattern: "{stem} - Edited.{ext}",
      date_utc: dateUtc,
      start_index: 1,
    },
  };
}
