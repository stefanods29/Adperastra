import type { MediaSubtitleCue } from "../media-edit/types";
import { importMediaSubtitles } from "../media-edit/subtitles";
import type { TimeUs } from "../services/mediaEngine";
import { TimelineError, TIMELINE_MAX_DURATION_US } from "./types";
import { validateMediaSubtitleCue } from "./projectValidation";

export function validateTimelineSubtitles(cues: readonly MediaSubtitleCue[]): MediaSubtitleCue[] {
  if (!Array.isArray(cues) || cues.length > 100_000) throw new TimelineError("timeline.too_large");
  const ids = new Set<string>();
  let bytes = 0;
  const result: MediaSubtitleCue[] = [];
  for (const item of cues) {
    const cue = validateMediaSubtitleCue(item);
    if (ids.has(cue.id) || cue.end_us > TIMELINE_MAX_DURATION_US) throw new TimelineError("timeline.bad_request");
    ids.add(cue.id);
    bytes += new TextEncoder().encode(cue.text).byteLength;
    if (bytes > 4 * 1024 * 1024) throw new TimelineError("timeline.too_large");
    result.push(cue);
  }
  return result.sort((a, b) => a.start_us - b.start_us || a.id.localeCompare(b.id));
}

/** Same 15 E6 parser and time conversion. Invalid indices remain explicit. */
export async function importTimelineSubtitles(sessionId: string, cursor?: string) {
  const page = await importMediaSubtitles(sessionId, cursor);
  return { ...page, cues: validateTimelineSubtitles(page.cues) };
}

export function srtTimestamp(us: TimeUs, edge: "start" | "end"): string {
  if (!Number.isSafeInteger(us) || us < 0 || us > TIMELINE_MAX_DURATION_US) throw new TimelineError("timeline.bad_request");
  const ms = edge === "start" ? Math.floor(us / 1000) : Math.ceil(us / 1000);
  const hh = Math.floor(ms / 3_600_000);
  const mm = Math.floor(ms / 60_000) % 60;
  const ss = Math.floor(ms / 1000) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** Plain UTF-8/LF payload; publication belongs to the 08a owned output sink. */
export function timelineSrt(cues: readonly MediaSubtitleCue[]): string {
  return validateTimelineSubtitles(cues).map((cue, index) =>
    `${index + 1}\n${srtTimestamp(cue.start_us, "start")} --> ${srtTimestamp(cue.end_us, "end")}\n${cue.text.replace(/\r\n?/g, "\n")}\n\n`,
  ).join("");
}
