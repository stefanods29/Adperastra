import { Plus } from "lucide-react";
import type { FocusEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { WavePage } from "../media-edit/types";
import { displayPath } from "../services/explorer";
import type { TimelineEffectOperation } from "./effectTypes";
import { formatTimecode } from "./format";
import type {
  TimelineClip,
  TimelineOperation,
  TimelineProject,
  Track,
} from "./types";
import { clipDurationUs, clipEndUs } from "./timing";
import AudioPanel from "./AudioPanel";
import SubtitlePanel from "./SubtitlePanel";
import TimelineEffectsPanel from "./TimelineEffectsPanel";
import TimelineTitlePanel from "./TimelineTitlePanel";
import TimelineTransitionPanel from "./TimelineTransitionPanel";
import WaveformTrack from "./WaveformTrack";

export type TimelinePanelTab =
  | "properties"
  | "effects"
  | "audio"
  | "titles"
  | "subtitles"
  | "transitions";

const TABS: readonly { id: TimelinePanelTab; labelKey: string }[] = [
  { id: "properties", labelKey: "timeline.properties" },
  { id: "effects", labelKey: "timelineEffects.color" },
  { id: "audio", labelKey: "timelineEffects.audio" },
  { id: "titles", labelKey: "timelineEffects.title" },
  { id: "subtitles", labelKey: "timelineEffects.subtitles" },
  { id: "transitions", labelKey: "timelineEffects.transitions" },
];

export interface TimelinePropertiesProps {
  project: Readonly<TimelineProject>;
  clip: TimelineClip | null;
  track: Track | null;
  playhead_us: number;
  duration_us: number;
  tab: TimelinePanelTab;
  onTab: (tab: TimelinePanelTab) => void;
  onSeek: (timeUs: number) => void;
  onOperation: (operation: TimelineOperation) => void;
  onApplyEffect: (operation: TimelineEffectOperation) => Promise<void>;
  onAddTrack: (kind: "video" | "audio") => void;
  onOpenHelp: (slug: string) => void;
  onRelink?: () => void;
  selectedTitleId?: string | null;
  selectedTransitionId?: string | null;
  clippingWarning: boolean;
  waveformPage: WavePage | null;
  waveformLoading: boolean;
  waveformLabel: string;
}

function number(
  event: KeyboardEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>,
): number | null {
  const value = Number(event.currentTarget.value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Right-hand inspector: numeric clip fields plus effects, audio, titles,
 * subtitles and transitions on one bounded 34 px tab row. */
export default function TimelineProperties(props: TimelinePropertiesProps) {
  const { t, i18n } = useTranslation();
  const { project, clip, track, playhead_us: playhead, duration_us: duration } = props;
  const source = clip
    ? project.sources.find((item) => item.id === clip.source_id) ?? null
    : null;
  const commit = (operation: TimelineOperation) => props.onOperation(operation);
  const trackOf = (value: TimelineClip): string =>
    project.tracks.find((item) => item.clips.some((entry) => entry.id === value.id))?.id ?? "";
  const start = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = number(event);
    if (value !== null && clip) commit({ kind: "move_clip", id: clip.id, track_id: trackOf(clip), start_us: value });
  };
  const trim = (event: KeyboardEvent<HTMLInputElement>, edge: "in" | "out") => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = number(event);
    if (value === null || !clip) return;
    commit({
      kind: "trim_clip",
      id: clip.id,
      in_us: edge === "in" ? value : clip.source_in_us,
      out_us: edge === "out" ? value : clip.source_out_us,
    });
  };

  return (
    <aside className="adp-timeline-properties" aria-label={t("timeline.properties")}>
      <h2 className="adp-timeline-properties-title">{t("timeline.properties")}</h2>
      <div className="adp-timeline-tabs" role="tablist" aria-label={t("timeline.properties")}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="adp-timeline-tab"
            aria-selected={props.tab === item.id}
            onClick={() => props.onTab(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="adp-timeline-tabpanel" role="tabpanel">
      {props.tab === "properties" ? (
        <>
      <label className="adp-timeline-field">
        <span>{t("timeline.playhead")}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, duration)}
          step={1}
          value={Math.min(playhead, Math.max(0, duration))}
          onChange={(event) => props.onSeek(Number(event.currentTarget.value))}
          aria-label={t("timeline.playhead")}
        />
        <output>{formatTimecode(playhead, i18n.language)}</output>
      </label>
      {clip ? (
        <>
          <label className="adp-timeline-field">
            <span>{t("timeline.start")}</span>
            <input
              key={`${clip.id}-start`}
              type="number"
              min={0}
              step={1}
              defaultValue={clip.start_us}
              onKeyDown={start}
              onBlur={(event) => {
                const value = number(event);
                if (value !== null && value !== clip.start_us) {
                  commit({ kind: "move_clip", id: clip.id, track_id: trackOf(clip), start_us: value });
                }
              }}
            />
            <output>{formatTimecode(clip.start_us, i18n.language)}</output>
          </label>
          <label className="adp-timeline-field">
            <span>{t("timeline.sourceIn")}</span>
            <input
              key={`${clip.id}-in`}
              type="number"
              min={0}
              step={1}
              defaultValue={clip.source_in_us}
              onKeyDown={(event) => trim(event, "in")}
            />
          </label>
          <label className="adp-timeline-field">
            <span>{t("timeline.sourceOut")}</span>
            <input
              key={`${clip.id}-out`}
              type="number"
              min={clip.source_in_us + 1}
              step={1}
              defaultValue={clip.source_out_us}
              onKeyDown={(event) => trim(event, "out")}
            />
            <output>{formatTimecode(clipEndUs(clip), i18n.language)}</output>
          </label>
          <p className="adp-timeline-readout">
            {t("timeline.clipLength", {
              length: formatTimecode(clipDurationUs(clip), i18n.language),
              speed: `${clip.speed.num}/${clip.speed.den}`,
            })}
          </p>
          {source ? (
            <p className="adp-timeline-source" title={displayPath(source.path)}>
              {displayPath(source.path)}
            </p>
          ) : (
            <p className="adp-timeline-source">{t("timeline.missing")}</p>
          )}
          {props.onRelink ? (
            <button type="button" className="adp-btn adp-btn--default" onClick={props.onRelink}>
              {t("timeline.relink")}
            </button>
          ) : null}
          {props.waveformPage || props.waveformLoading ? (
            <WaveformTrack
              page={props.waveformPage}
              loading={props.waveformLoading}
              channel={0}
              width={276}
              label={props.waveformLabel}
            />
          ) : null}
        </>
      ) : (
        <p className="adp-timeline-hint">{t("timeline.noSelection")}</p>
      )}
        </>
      ) : null}
      {props.tab === "effects" ? (
        <TimelineEffectsPanel
          project={project}
          clip={clip}
          onApply={props.onApplyEffect}
          onOpenHelp={props.onOpenHelp}
        />
      ) : null}
      {props.tab === "audio" ? (
        <>
          {clip ? (
            <AudioPanel
              key={`clip:${clip.id}`}
              id={clip.id}
              scope="clip"
              gain={clip.gain}
              mute={clip.mute}
              solo={clip.solo}
              fade_in_us={clip.fade_in_us}
              fade_out_us={clip.fade_out_us}
              peak={0}
              onApply={props.onApplyEffect}
              onOpenHelp={props.onOpenHelp}
            />
          ) : null}
          {track ? (
            <AudioPanel
              key={`track:${track.id}`}
              id={track.id}
              scope="track"
              gain={track.gain}
              mute={track.mute}
              solo={track.solo}
              peak={0}
              onApply={props.onApplyEffect}
              onOpenHelp={props.onOpenHelp}
            />
          ) : null}
          {!clip && !track ? (
            <p className="adp-timeline-hint">{t("timeline.noSelection")}</p>
          ) : null}
          {props.clippingWarning ? <p role="status">{t("timelineEffects.clipping")}</p> : null}
        </>
      ) : null}
      {props.tab === "titles" ? (
        <TimelineTitlePanel
          project={project}
          playhead_us={playhead}
          selectedId={props.selectedTitleId}
          onAddTrack={() => props.onAddTrack("video")}
          onApply={props.onApplyEffect}
          onOpenHelp={props.onOpenHelp}
        />
      ) : null}
      {props.tab === "subtitles" ? (
        <SubtitlePanel
          cues={project.subtitles}
          onApply={(cues) => props.onApplyEffect({ kind: "set_subtitles", cues })}
          onOpenHelp={props.onOpenHelp}
        />
      ) : null}
      {props.tab === "transitions" ? (
        <TimelineTransitionPanel
          project={project}
          selectedId={props.selectedTransitionId}
          onApply={props.onApplyEffect}
          onOpenHelp={props.onOpenHelp}
        />
      ) : null}
      </div>
      <div className="adp-timeline-add-tracks">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => props.onAddTrack("video")}>
          <Plus size={16} aria-hidden="true" /> {t("timeline.addVideo")}
        </button>
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => props.onAddTrack("audio")}>
          <Plus size={16} aria-hidden="true" /> {t("timeline.addAudio")}
        </button>
      </div>
      <p className="adp-timeline-notice">{t("timeline.projectNotice")}</p>
    </aside>
  );
}
