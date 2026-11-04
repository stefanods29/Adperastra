import type { MediaSubtitleCue } from "../media-edit/types";
import { deterministicMediaId } from "../media-edit/types";
import type { TranscriptSegment } from "../services/speechTypes";
import { MAX_TRANSCRIPT_SEGMENTS } from "../services/speechTypes";

/**
 * Transcript -> subtitles and text files (Step 17b D7).
 *
 * Times are integer microseconds. SRT/VTT timestamps use floor for the
 * start and `max(start + 1, ceil(end))` for the end, so a zero-length input
 * still produces a visible 1 ms cue. Text is escaped literal text: no HTML,
 * ASS or script output is ever produced.
 */

export const SRT_MAX_SEGMENTS = MAX_TRANSCRIPT_SEGMENTS;
const MAX_PAGES = 10_000;

/** Exact integer-microsecond cues for the 15 media controller. */
export function transcriptToMediaCues(segments: readonly TranscriptSegment[]): MediaSubtitleCue[] {
  const cues: MediaSubtitleCue[] = [];
  for (const segment of segments) {
    if (!Number.isSafeInteger(segment.start_us) || !Number.isSafeInteger(segment.end_us)) {
      throw new Error("speech.invalid");
    }
    if (segment.end_us <= segment.start_us) throw new Error("speech.invalid");
    cues.push({
      id: deterministicMediaId(segment.id, segment.index),
      start_us: segment.start_us,
      end_us: segment.end_us,
      text: escapeSubtitleText(segment.text),
    });
  }
  return cues.sort((left, right) => left.start_us - right.start_us || left.end_us - right.end_us);
}

/** Escapes markup so a subtitle player shows the literal characters. */
export function escapeSubtitleText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SubtitleTime {
  hours: number;
  minutes: number;
  seconds: number;
  millis: number;
}

/** Exact SRT/VTT timestamp rule; `ceilingEnd` is true for the cue end. */
export function subtitleTime(us: number, ceilingEnd = false): SubtitleTime {
  if (!Number.isSafeInteger(us) || us < 0) throw new Error("speech.invalid");
  const millis = ceilingEnd ? Math.ceil(us / 1000) : Math.floor(us / 1000);
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const seconds = Math.floor((millis % 60_000) / 1000);
  return { hours, minutes, seconds, millis: millis % 1000 };
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, "0");
}

export function srtTimestamp(us: number, ceilingEnd = false): string {
  const time = subtitleTime(us, ceilingEnd);
  return `${pad(time.hours, 2)}:${pad(time.minutes, 2)}:${pad(time.seconds, 2)},${pad(time.millis, 3)}`;
}

export function vttTimestamp(us: number, ceilingEnd = false): string {
  const time = subtitleTime(us, ceilingEnd);
  return `${pad(time.hours, 2)}:${pad(time.minutes, 2)}:${pad(time.seconds, 2)}.${pad(time.millis, 3)}`;
}

/** One cue as SRT uses it: start floor, end max(start + 1 ms, ceil(end)). */
export function cueMilliseconds(cue: Pick<MediaSubtitleCue, "start_us" | "end_us">): { start: number; end: number } {
  if (!Number.isSafeInteger(cue.start_us) || !Number.isSafeInteger(cue.end_us) || cue.end_us <= cue.start_us) {
    throw new Error("speech.invalid");
  }
  const start = Math.floor(cue.start_us / 1000);
  const end = Math.max(start + 1, Math.ceil(cue.end_us / 1000));
  return { start, end };
}

export function toSrt(cues: readonly MediaSubtitleCue[]): string {
  const lines: string[] = [];
  cues.forEach((cue, index) => {
    // The floor/ceil rule is provided by `srtTimestamp` itself; using the
    // cue milliseconds here would add the same milliseconds twice.
    cueMilliseconds(cue);
    lines.push(String(index + 1));
    lines.push(`${srtTimestamp(cue.start_us)} --> ${srtTimestamp(cue.end_us, true)}`);
    lines.push(escapeSubtitleText(cue.text));
    lines.push("");
  });
  return lines.join("\r\n");
}

export function toVtt(cues: readonly MediaSubtitleCue[]): string {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue) => {
    cueMilliseconds(cue);
    lines.push(`${vttTimestamp(cue.start_us)} --> ${vttTimestamp(cue.end_us, true)}`);
    lines.push(escapeSubtitleText(cue.text));
    lines.push("");
  });
  return lines.join("\n");
}

export function toPlainText(segments: readonly Pick<TranscriptSegment, "text">[]): string {
  return segments.map((segment) => escapeSubtitleText(segment.text).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join("\n");
}
