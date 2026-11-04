import type { TimeUs } from "../services/mediaEngine";
import type { TimelineClip, TimelineRenderPlan, Track } from "./types";
import { TimelineError } from "./types";
import type { AudioContribution } from "./effectTypes";
import { clipDurationUs, clipEndUs, clipSourceTime, sampleIndexForUs } from "./timing";

function gainValue(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 4) throw new TimelineError("timeline.bad_request");
  return value;
}

/** Solo eligibility is computed once across the whole plan, including inactive
 * solo clips. Track visibility controls pictures, not audio; mute is explicit.
 * Requires the additive 19a TimelineClip.solo proposal before integration.
 */
function eligibleClips(plan: Readonly<TimelineRenderPlan>): Array<{ track: Track; clip: TimelineClip; eligible: boolean }> {
  const audioTracks = plan.tracks.filter((track) => track.kind === "audio");
  const soloTrack = audioTracks.some((track) => !track.mute && track.solo);
  const qualifying = audioTracks.filter((track) => !track.mute && (!soloTrack || track.solo));
  const soloClip = qualifying.some((track) => track.clips.some((clip) => !clip.mute && clip.solo));
  return audioTracks.flatMap((track) => track.clips.map((clip) => ({
    track, clip,
    eligible: !track.mute && !clip.mute && (!soloTrack || track.solo) && (!soloClip || clip.solo),
  })));
}

function fadeGain(clip: TimelineClip, timeUs: TimeUs): number {
  const duration = clipDurationUs(clip);
  if (![clip.fade_in_us, clip.fade_out_us].every((v) => Number.isSafeInteger(v) && v >= 0) ||
      clip.fade_in_us + clip.fade_out_us > duration) throw new TimelineError("timeline.bad_request");
  const fadeIn = clip.fade_in_us === 0 ? 1 : Math.min(1, (timeUs - clip.start_us) / clip.fade_in_us);
  const fadeOut = clip.fade_out_us === 0 ? 1 : Math.min(1, (clipEndUs(clip) - timeUs) / clip.fade_out_us);
  return Math.max(0, fadeIn) * Math.max(0, fadeOut);
}

export function resolveAudioMix(plan: Readonly<TimelineRenderPlan>, timeUs: TimeUs): readonly AudioContribution[] {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0 || timeUs >= plan.duration_us) return [];
  const sources = new Map(plan.sources.map((source) => [source.id, source]));
  const result: AudioContribution[] = [];
  for (const { track, clip, eligible } of eligibleClips(plan)) {
    if (timeUs < clip.start_us || timeUs >= clipEndUs(clip)) continue;
    const rate = sources.get(clip.source_id)?.audio_rate;
    if (!rate) throw new TimelineError("timeline.missing_source");
    const gain = gainValue(track.gain) * gainValue(clip.gain) * fadeGain(clip, timeUs);
    result.push({
      clip_id: clip.id, source_id: clip.source_id,
      source_sample: sampleIndexForUs(clipSourceTime(clip, timeUs), rate),
      gain: eligible ? gain : 0, channels: plan.audio_channels, enabled: eligible,
    });
  }
  return result;
}

/** Exact eligibility, conservative gain envelope. End events precede starts at
 * equal times; adjacent clips never produce a spurious overlap. A fixed-order
 * sum tree avoids cumulative floating subtraction drift and quadratic scans.
 */
export function audioClippingRequired(plan: Readonly<TimelineRenderPlan>, sampledPeak = 0): boolean {
  if (!Number.isFinite(sampledPeak) || sampledPeak < 0) throw new TimelineError("timeline.bad_request");
  if (sampledPeak > 1) return true;
  const clips = eligibleClips(plan).filter((entry) => entry.eligible);
  const events = clips.flatMap(({ clip }, index) => [
    { time: clip.start_us, index, start: true }, { time: clipEndUs(clip), index, start: false },
  ]).sort((a, b) => a.time - b.time || Number(a.start) - Number(b.start) || a.index - b.index);
  let size = 1;
  while (size < clips.length) size *= 2;
  const tree = new Float64Array(size * 2);
  const weights = clips.map(({ track, clip }) => Math.abs(gainValue(track.gain) * gainValue(clip.gain)));
  for (let i = 0; i < events.length;) {
    const time = events[i].time;
    while (i < events.length && events[i].time === time) {
      const event = events[i++];
      let node = size + event.index;
      tree[node] = event.start ? weights[event.index] : 0;
      while (node > 1) {
        node = Math.floor(node / 2);
        tree[node] = tree[node * 2] + tree[node * 2 + 1];
      }
    }
    if (tree[1] > 1) return true;
  }
  return false;
}
