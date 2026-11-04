import { invoke } from "@tauri-apps/api/core";
import type { MediaConversionOptions } from "../convert/types";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";
import type {
  DiskConversionInput,
  FrameRate,
  MediaInfo,
  MediaPreview,
  TimeUs,
} from "./engineTypes";

/**
 * Media engine (Step 12b E2/E5, revision `media-probe-2`).
 *
 * Probe and sample preview run as shared jobs inside the confined engine
 * process; this file asks for them and returns the shared `JobHandle`. Every
 * integer microsecond value stays an integer: the timing contract of D5 is
 * never rounded through floating milliseconds.
 *
 * Steps 15 and 19 import `TimeUs`, `FrameRate`, `MediaInfo` and
 * `MediaPreview` from here, not from a private module.
 */

export type { FrameRate, MediaInfo, MediaPreview, TimeUs } from "./engineTypes";

/** Probe one disk file (at most 32 GiB, 24 hours, 64 streams). */
export async function probeMedia(
  input: DiskConversionInput,
): Promise<JobHandle<MediaInfo>> {
  if (!isTauriRuntime()) throw new Error("engines.failed");
  return runJob<MediaInfo>("mediaprobe", async (requestId) => {
    await invoke("media_probe_start", { requestId, input });
  });
}

/** Ask for a leased sample of at most three seconds at a 512 px edge. */
export async function previewMedia(
  input: DiskConversionInput,
  options: MediaConversionOptions,
): Promise<JobHandle<MediaPreview>> {
  if (!isTauriRuntime()) throw new Error("engines.failed");
  return runJob<MediaPreview>("mediaprev", async (requestId) => {
    await invoke("media_preview_start", { requestId, input, options });
  });
}

/**
 * Generation numbers for preview requests. A reply is used only when its
 * generation is still the newest one, so replacing the options cannot let a
 * slower earlier sample replace the newer picture.
 */
export class PreviewGenerations {
  private current = 0;

  /** Start a request: returns its generation number. */
  begin(): number {
    this.current += 1;
    return this.current;
  }

  /** True while `generation` is still the newest accepted request. */
  isCurrent(generation: number): boolean {
    return generation === this.current;
  }

  /** Forget everything (closing the dialog). Older replies are ignored. */
  reset(): void {
    this.current += 1;
  }
}

/** The same check for a plain number pair, for callers that keep one ID. */
export function isCurrentGeneration(latest: number, candidate: number): boolean {
  return latest === candidate;
}
