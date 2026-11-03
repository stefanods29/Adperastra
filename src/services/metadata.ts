import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import { POLL_INTERVAL_MS, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Rich file facts from the Windows property helper (Step 07b E1).
 *
 * The UI only names a path and its own consumer; Windows property names
 * never leave Rust (D4/D5). Field IDs mirror `MetadataFieldId` exactly. */

export type MetadataFieldId =
  | "width"
  | "height"
  | "orientation"
  | "date_taken"
  | "camera_make"
  | "camera_model"
  | "duration_ms"
  | "video_codec"
  | "frame_rate"
  | "audio_title"
  | "audio_artist"
  | "audio_album"
  | "author"
  | "page_count"
  | "word_count";

/** Mirrors Rust `MetadataValue` (tagged by `kind`). */
export type MetadataValue =
  | { kind: "text"; value: string }
  | { kind: "integer"; value: number }
  | { kind: "decimal"; value: number }
  | { kind: "date"; value: string }
  | { kind: "list"; value: string[] };

export interface MetadataField {
  id: MetadataFieldId;
  value: MetadataValue;
}

/** Mirrors Rust `MetadataInfo` (snake_case, same names). */
export interface MetadataInfo {
  source: SourceStamp;
  fields: MetadataField[];
  partial: boolean;
  missing: MetadataFieldId[];
}

/** Mirrors Rust `MetadataRequest`: path and consumer only. */
export interface MetadataRequest {
  path: string;
  consumer_id: string;
}

interface JobPoll {
  done: boolean;
  result: unknown;
  error: string | null;
}

/** Start one metadata read and poll its shared job.
 *
 * `requestId` comes from `newRequestId("metadata")`; the caller cancels it
 * with `handle.cancel()` when the selection changes. */
export async function readMetadata(
  requestId: string,
  request: MetadataRequest,
): Promise<JobHandle<MetadataInfo>> {
  if (!isTauriRuntime()) throw new Error("jobs.unavailable");
  await invoke("metadata_read_start", { requestId, request });
  let cancelSent = false;
  const cancel = async () => {
    if (cancelSent) return;
    cancelSent = true;
    try {
      await invoke("job_cancel", { requestId });
    } catch {
      // The job may have finished a moment ago.
    }
  };
  const completion = (async (): Promise<MetadataInfo> => {
    for (;;) {
      const poll = (await invoke("job_poll", { requestId })) as JobPoll;
      if (poll.error) throw new Error(poll.error);
      if (poll.done) return poll.result as MetadataInfo;
      await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }
  })();
  return { id: requestId, cancel, completion };
}

/** Forget a consumer; idempotent, like `releaseThumbnail` (D6). */
export async function releaseMetadata(consumerId: string): Promise<void> {
  await invoke("metadata_release", { consumerId });
}
