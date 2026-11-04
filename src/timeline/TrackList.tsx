import { Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX } from "lucide-react";
import type { PointerEvent as ReactPointerEvent, UIEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatTimecode } from "./format";
import type { TimelineClip, TimelineProject, Track } from "./types";
import { clipDurationUs, clipEndUs } from "./timing";
import ClipView from "./ClipView";
import { TIME_OVERSCAN_US, TRACK_OVERSCAN, visibleTrackRange } from "./timelineViewTypes";

const TRACK_HEADER = 160;
const RULER_HEIGHT = 28;
const VIDEO_HEIGHT = 72;
const AUDIO_HEIGHT = 56;

export interface TrackListProps {
  project: Readonly<TimelineProject>;
  selected_ids: ReadonlySet<string>;
  active_track_id: string | null;
  playhead_us: number;
  scroll_us: number;
  pixels_per_second: number;
  viewport_width: number;
  viewport_height: number;
  scroll_top: number;
  /** Drag preview only: the dragged clip's tentative start, or null. */
  drag_clip_id?: string | null;
  drag_start_us?: number | null;
  onScrollTop: (scrollTop: number) => void;
  onSelectTrack: (trackId: string) => void;
  onSelectClip: (clipId: string, additive: boolean) => void;
  onSelectTransition: (transitionId: string) => void;
  onSelectTitle: (titleId: string) => void;
  onClipPointerDown: (event: ReactPointerEvent<HTMLDivElement>, clip: TimelineClip, track: Track) => void;
  onToggleLock: (track: Track) => void;
  onToggleVisible: (track: Track) => void;
  onToggleMute: (track: Track) => void;
  onMoveTrack: (track: Track, direction: -1 | 1) => void;
}

function niceStep(pixelsPerSecond: number): number {
  for (const seconds of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1_800, 3_600]) {
    if (seconds * pixelsPerSecond >= 80) return seconds * 1_000_000;
  }
  return 3_600_000_000;
}

/** Horizontal position and width of a clip in the visible window. */
export function clipGeometry(
  clip: TimelineClip,
  windowStartUs: number,
  pixelsPerSecond: number,
): { left_px: number; width_px: number } {
  const left = ((clip.start_us - windowStartUs) * pixelsPerSecond) / 1_000_000;
  const width = (clipDurationUs(clip) * pixelsPerSecond) / 1_000_000;
  return { left_px: left, width_px: width };
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export default function TrackList(props: TrackListProps) {
  const { t, i18n } = useTranslation();
  const {
    project,
    selected_ids: selected,
    active_track_id: activeTrack,
    playhead_us: playhead,
    scroll_us: scroll,
    pixels_per_second: zoom,
    viewport_width: width,
    viewport_height: height,
    scroll_top: scrollTop,
  } = props;
  const spanUs = Math.round((Math.max(0, width) * 1_000_000) / zoom);
  const windowStart = Math.max(0, scroll);
  const windowEnd = windowStart + spanUs;
  const range = visibleTrackRange(project.tracks, scrollTop, Math.max(0, height - RULER_HEIGHT), {
    video: VIDEO_HEIGHT,
    audio: AUDIO_HEIGHT,
  }, TRACK_OVERSCAN);
  const visibleTracks = project.tracks.slice(Math.max(0, range.first), range.last + 1);
  const step = niceStep(zoom);
  const firstTick = Math.floor(windowStart / step) * step;
  const ticks: number[] = [];
  for (let at = firstTick; at <= windowEnd + TIME_OVERSCAN_US; at += step) {
    if (at >= windowStart) ticks.push(at);
  }
  const toX = (timeUs: number) => ((timeUs - windowStart) * zoom) / 1_000_000;

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    props.onScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <div className="adp-timeline-tracks" role="group" aria-label={t("timeline.tracksLabel")}>
      <div
        className="adp-timeline-ruler"
        role="presentation"
        style={{ height: `${RULER_HEIGHT}px`, marginLeft: `${TRACK_HEADER}px` }}
      >
        {ticks.map((at) => (
          <span
            key={at}
            className="adp-timeline-tick"
            style={{ left: `${toX(at)}px` }}
            aria-hidden="true"
          >
            {formatTimecode(at, i18n.language)}
          </span>
        ))}
        <span
          className="adp-timeline-playhead"
          style={{ left: `${toX(playhead)}px` }}
          aria-hidden="true"
        />
      </div>
      <div
        className="adp-timeline-track-scroll"
        style={{ maxHeight: `${Math.max(0, height - RULER_HEIGHT)}px` }}
        onScroll={handleScroll}
      >
        {visibleTracks.map((track) => {
          const rowHeight = track.kind === "video" ? VIDEO_HEIGHT : AUDIO_HEIGHT;
          const isActive = track.id === activeTrack;
          return (
            <div
              key={track.id}
              className={`adp-timeline-track${isActive ? " is-active" : ""}`}
              data-track-kind={track.kind}
              style={{ height: `${rowHeight}px` }}
              onFocus={() => props.onSelectTrack(track.id)}
            >
              <div className="adp-timeline-track-header" style={{ width: `${TRACK_HEADER}px` }}>
                <button
                  type="button"
                  className="adp-timeline-track-name"
                  aria-pressed={isActive}
                  onClick={() => props.onSelectTrack(track.id)}
                >
                  {track.name}
                </button>
                <div className="adp-timeline-track-buttons">
                  <button
                    type="button"
                    className="adp-timeline-icon-button"
                    aria-label={track.locked ? t("timeline.unlock") : t("timeline.lock")}
                    aria-pressed={track.locked}
                    onClick={() => props.onToggleLock(track)}
                  >
                    {track.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="adp-timeline-icon-button"
                    aria-label={track.visible ? t("timeline.hide") : t("timeline.show")}
                    aria-pressed={!track.visible}
                    onClick={() => props.onToggleVisible(track)}
                  >
                    {track.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="adp-timeline-icon-button"
                    aria-label={track.mute ? t("timeline.unmute") : t("timeline.mute")}
                    aria-pressed={track.mute}
                    onClick={() => props.onToggleMute(track)}
                  >
                    {track.mute ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                  </button>
                </div>
                <div className="adp-timeline-track-order">
                  <button
                    type="button"
                    className="adp-timeline-icon-button"
                    aria-label={t("timeline.moveEarlier")}
                    disabled={track.index === 0}
                    onClick={() => props.onMoveTrack(track, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="adp-timeline-icon-button"
                    aria-label={t("timeline.moveLater")}
                    disabled={track.index === project.tracks.length - 1}
                    onClick={() => props.onMoveTrack(track, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <div
                className="adp-timeline-lane"
                role="listbox"
                aria-multiselectable="true"
                aria-label={track.name}
                style={{ left: `${TRACK_HEADER}px`, width: `${Math.max(0, width - TRACK_HEADER)}px` }}
              >
                {track.clips.map((clip) => {
                  const end = clipEndUs(clip);
                  if (end <= windowStart || clip.start_us >= windowEnd) return null;
                  const previewClip =
                    props.drag_clip_id === clip.id && props.drag_start_us !== null && props.drag_start_us !== undefined
                      ? { ...clip, start_us: props.drag_start_us }
                      : clip;
                  const geometry = clipGeometry(previewClip, windowStart, zoom);
                  const source = project.sources.find((item) => item.id === clip.source_id);
                  const label = t("timeline.clipLabel", {
                    name: source ? baseName(source.path) : "",
                    start: formatTimecode(clip.start_us, i18n.language),
                    end: formatTimecode(end, i18n.language),
                  });
                  return (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      selected={selected.has(clip.id)}
                      left_px={geometry.left_px}
                      width_px={geometry.width_px}
                      track_kind={track.kind}
                      label={label}
                      onSelect={() => props.onSelectTrack(track.id)}
                      onPointerDown={(event, item) => props.onClipPointerDown(event, item, track)}
                    />
                  );
                })}
                {project.transitions
                  .filter((transition) => transition.track_id === track.id)
                  .map((transition) => {
                    const right = track.clips.find((clip) => clip.id === transition.right_clip_id);
                    if (!right) return null;
                    const x = toX(right.start_us);
                    if (x < -24 || x > width) return null;
                    return (
                      <button
                        key={transition.id}
                        type="button"
                        className="adp-timeline-transition"
                        data-transition-id={transition.id}
                        style={{ left: `${Math.round(x - 12)}px` }}
                        aria-label={t(`timelineEffects.${transition.kind}`)}
                        title={t(`timelineEffects.${transition.kind}`)}
                        onClick={() => props.onSelectTransition(transition.id)}
                      />
                    );
                  })}
                {project.titles
                  .filter((title) => title.track_id === track.id)
                  .map((title) => {
                    const start = Math.max(title.start_us, windowStart);
                    const end = Math.min(title.end_us, windowEnd);
                    if (end <= start) return null;
                    return (
                      <button
                        key={title.id}
                        type="button"
                        className="adp-timeline-title"
                        data-title-id={title.id}
                        style={{
                          left: `${Math.round(toX(start))}px`,
                          width: `${Math.max(2, Math.round(((end - start) * zoom) / 1_000_000))}px`,
                        }}
                        aria-label={title.text || t("timelineEffects.title")}
                        title={title.text}
                        onClick={() => props.onSelectTitle(title.id)}
                      >
                        {title.text}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
