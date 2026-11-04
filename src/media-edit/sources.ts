import type { MediaInfo } from "../services/mediaEngine";
import type { MediaSource } from "./types";
import { newMediaId } from "./types";

/**
 * A recipe source built from the 12b probe (`E1`, `D1`).
 *
 * The probe owns the source stamp, duration and stream facts; this module
 * only maps them into the canonical recipe shape. It never reads the media
 * bytes and never fabricates a path from anything but the probed source.
 */
export function mediaSourceForProbe(info: MediaInfo): MediaSource {
  const video = info.streams.find((stream) => stream.kind === "video");
  const audio = info.streams.find((stream) => stream.kind === "audio");
  return {
    id: newMediaId(),
    path: info.source.path_key,
    stamp: info.source,
    duration_us: info.duration_us,
    video_rate: video?.frame_rate ?? null,
    audio_rate: audio?.sample_rate ?? null,
    sensitive: false,
  };
}
