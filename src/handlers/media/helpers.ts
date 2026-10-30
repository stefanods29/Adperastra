/** Audio and video helpers (Step 04c). Pure, unit-tested. */

/** Video types the built-in player plays (WebView2 decodes them). */
export const VIDEO_EXTENSIONS: readonly string[] = ["mp4", "m4v", "webm"];
/** Audio types the built-in player plays. */
export const AUDIO_EXTENSIONS: readonly string[] = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"];
/** Playback speeds offered on the ribbon. */
export const SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** True when the file should show a picture (a video), false for sound only. */
export function isVideo(info: { mime: string; ext: string }): boolean {
  if (AUDIO_EXTENSIONS.includes(info.ext)) return false;
  return info.mime.startsWith("video/") || VIDEO_EXTENSIONS.includes(info.ext);
}

/** "0:07", "3:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** SubRip (.srt) to WebVTT, the subtitle format browsers read: a header,
 * and "." instead of "," in times (00:00:01,500 becomes 00:00:01.500). */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{1,2}):(\d{2}):(\d{2}),(\d{3})/g, (_match, h: string, m: string, s: string, ms: string) => `${h.padStart(2, "0")}:${m}:${s}.${ms}`);
  return `WEBVTT\n\n${body.trim()}\n`;
}

/** A subtitle file's text as WebVTT (`.srt` files are converted). */
export function toVtt(fileName: string, text: string): string {
  if (fileName.toLowerCase().endsWith(".vtt")) return text.replace(/^\uFEFF/, "");
  return srtToVtt(text);
}

/** How a subtitle file is listed: without the video's name when a
 * language part follows it ("Holidays.en.srt" is shown as "en.srt" for
 * "Holidays.mp4"); otherwise the whole file name. */
export function subtitleLabel(videoName: string, subtitleName: string): string {
  const dot = videoName.lastIndexOf(".");
  const stem = dot > 0 ? videoName.slice(0, dot) : videoName;
  const prefix = `${stem}.`;
  if (!subtitleName.toLowerCase().startsWith(prefix.toLowerCase())) return subtitleName;
  const rest = subtitleName.slice(prefix.length);
  return rest.includes(".") ? rest : subtitleName;
}
