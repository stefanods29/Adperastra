import type { MediaSubtitleCue } from "../media-edit/types";
import type { TimeUs } from "../services/mediaEngine";

/** Selection only. Rasterization must consume text as glyphs, never HTML/ASS.
 * Input is the immutable, validated, sorted plan; no lossy overlap deduplication.
 */
export function subtitleFrames(cues: readonly MediaSubtitleCue[], timeUs: TimeUs): readonly MediaSubtitleCue[] {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0) return [];
  const result: MediaSubtitleCue[] = [];
  for (const cue of cues) {
    if (cue.start_us > timeUs) break;
    if (timeUs < cue.end_us) result.push(cue);
  }
  return result;
}
