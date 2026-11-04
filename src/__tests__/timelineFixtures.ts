import type { MediaSource } from "../media-edit/types";
import type {
  PlaybackRate,
  TimelineClip,
  TimelineProject,
  Track,
} from "../timeline/types";
import { validateTimelineProject } from "../timeline/projectValidation";

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export function source(value = 1, path = "C:\\media\\clip.mp4"): MediaSource {
  return {
    id: uuid(value),
    path,
    stamp: {
      path_key: path,
      volume_id: "0a1b2c3d",
      file_id: `00112233445500${String(value).padStart(2, "0")}`,
      modified_ticks: `13300000000000${String(value).padStart(4, "0")}`,
      size_bytes: 4096,
    },
    duration_us: 20_000_000,
    video_rate: { num: 30, den: 1 },
    audio_rate: 48_000,
    sensitive: false,
  };
}

export function clip(input: {
  id: number;
  start_us: number;
  source_in_us?: number;
  source_out_us: number;
  speed?: PlaybackRate;
  link_id?: string | null;
  source_id?: string;
}): TimelineClip {
  return {
    id: uuid(input.id),
    source_id: input.source_id ?? uuid(1),
    link_id: input.link_id ?? null,
    start_us: input.start_us,
    source_in_us: input.source_in_us ?? 0,
    source_out_us: input.source_out_us,
    speed: input.speed ?? { num: 1, den: 1 },
    gain: 1,
    mute: false,
    solo: false,
    fade_in_us: 0,
    fade_out_us: 0,
    transform: { crop: null, rotation: 0 },
    effects: [],
  };
}

export function track(
  id: number,
  kind: "video" | "audio",
  index: number,
  clips: TimelineClip[],
  locked = false,
): Track {
  return {
    id: uuid(id),
    kind,
    name: kind === "video" ? `Video ${index + 1}` : `Audio ${index + 1}`,
    locked,
    visible: true,
    mute: false,
    solo: false,
    gain: 1,
    index,
    clips,
  };
}

export function project(options: {
  sources?: MediaSource[];
  tracks: Track[];
  frame_rate?: { num: number; den: number };
}): TimelineProject {
  return validateTimelineProject({
    schema_version: 1,
    project_id: uuid(100),
    content_id: uuid(101),
    sources: options.sources ?? [source()],
    tracks: options.tracks,
    width: 1920,
    height: 1080,
    frame_rate: options.frame_rate ?? { num: 30, den: 1 },
    audio_rate: 48_000,
    audio_channels: 2,
    transitions: [],
    titles: [],
    subtitles: [],
  });
}

export function videoProject(clips: TimelineClip[], frame_rate?: { num: number; den: number }): TimelineProject {
  return project({ tracks: [track(10, "video", 0, clips)], frame_rate });
}
