import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import type { TimelineEffectOperation } from "./effectTypes";
import { formatTimecode } from "./format";
import type {
  Rgba,
  TimelineProject,
  TimelineTitle,
  TitleAlign,
  TitleAnimation,
} from "./types";
import { newUuid } from "./types";

const FONT_ASSETS = [
  { id: "inter-regular", label: "Inter" },
  { id: "inter-bold", label: "Inter Bold" },
  { id: "inter-italic", label: "Inter Italic" },
  { id: "inter-bold-italic", label: "Inter Bold Italic" },
] as const;

const ALIGNS: readonly TitleAlign[] = ["left", "center", "right"];
const ANIMATIONS: readonly TitleAnimation[] = ["none", "fade", "slide"];

const ALIGN_KEYS: Record<TitleAlign, string> = {
  left: "officeDeck.alignLeft",
  center: "officeDeck.alignCenter",
  right: "officeDeck.alignRight",
};

const ANIMATION_KEYS: Record<TitleAnimation, string> = {
  none: "officeDeck.effect.none",
  fade: "officeDeck.effect.fade",
  // A slide is an entrance from the side; the deck's Fly label is the exact
  // translated word already available for that motion.
  slide: "officeDeck.effect.fly",
};

function cloneTitle(title: TimelineTitle): TimelineTitle {
  return structuredClone(title);
}

function rgbaHex(rgba: Rgba): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(rgba[0])}${part(rgba[1])}${part(rgba[2])}`;
}

function hexRgba(hex: string, alpha: number): Rgba {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return [255, 255, 255, alpha];
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
    alpha,
  ];
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emptyTitle(project: Readonly<TimelineProject>, playheadUs: number): TimelineTitle | null {
  const track = project.tracks.find((item) => item.kind === "video" && item.clips.length === 0);
  if (!track) return null;
  return {
    id: newUuid(),
    track_id: track.id,
    start_us: playheadUs,
    end_us: playheadUs + 2_000_000,
    text: "",
    style: {
      font_asset_id: "inter-regular",
      font_size: 48,
      rgba: [255, 255, 255, 255],
      align: "center",
      x: 0.5,
      y: 0.8,
    },
    animation: "none",
    animation_us: 0,
  };
}

export interface TimelineTitlePanelProps {
  project: Readonly<TimelineProject>;
  playhead_us: number;
  /** A title marker clicked in the track list. */
  selectedId?: string | null;
  onAddTrack: () => void;
  onApply: (operation: TimelineEffectOperation) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

/**
 * Plain title editor (19b D3). Text stays data; only the licensed Inter
 * inventory is offered and no HTML/SVG/filter text is accepted. The title
 * track must be a video track without picture clips, exactly as the shared
 * project validator requires.
 */
export default function TimelineTitlePanel(props: TimelineTitlePanelProps) {
  const { t, i18n } = useTranslation();
  const { project } = props;
  const [selectedId, setSelectedId] = useState<string | null>(props.selectedId ?? null);
  const [draft, setDraft] = useState<TimelineTitle | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!props.selectedId) return;
    const found = project.titles.find((title) => title.id === props.selectedId);
    if (!found) return;
    setSelectedId(found.id);
    setDraft(cloneTitle(found));
  }, [props.selectedId, project.titles]);

  const select = (title: TimelineTitle) => {
    setSelectedId(title.id);
    setDraft(cloneTitle(title));
    setFailed(false);
  };

  const create = () => {
    const next = emptyTitle(project, props.playhead_us);
    if (!next) return;
    setSelectedId(null);
    setDraft(next);
    setFailed(false);
  };

  const update = (patch: Partial<TimelineTitle>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const apply = async () => {
    if (!draft || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onApply({ kind: "set_title", title: draft });
      setSelectedId(draft.id);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!selectedId || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onApply({ kind: "remove_title", id: selectedId });
      setSelectedId(null);
      setDraft(null);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const emptyVideoTracks = project.tracks.filter(
    (track) => track.kind === "video" && track.clips.length === 0,
  );
  const hasEmptyTrack = emptyVideoTracks.length > 0;
  const selectedTrack = draft ? project.tracks.find((track) => track.id === draft.track_id) : null;
  const trackOptions =
    selectedTrack && !emptyVideoTracks.some((track) => track.id === draft?.track_id)
      ? [...emptyVideoTracks, selectedTrack]
      : emptyVideoTracks;

  return (
    <section className="adp-timeline-effect" aria-label={t("timelineEffects.title")}>
      <header>
        <h3>{t("timelineEffects.title")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("timeline-transitions")} />
      </header>
      <div className="adp-timeline-effect-list">
        {project.titles.map((title) => (
          <Button
            key={title.id}
            variant={title.id === selectedId ? "primary" : "subtle"}
            disabled={pending}
            onClick={() => select(title)}
          >
            {title.text || formatTimecode(title.start_us, i18n.language)}
          </Button>
        ))}
      </div>
      <div className="adp-timeline-effect-actions">
        <Button variant="subtle" disabled={pending || !hasEmptyTrack} onClick={create}>
          <Plus size={16} aria-hidden="true" /> {t("timelineEffects.title")}
        </Button>
        <Button variant="subtle" disabled={pending || !selectedId} onClick={() => void remove()}>
          <Trash2 size={16} aria-hidden="true" /> {t("commands.delete")}
        </Button>
      </div>
      {!hasEmptyTrack ? (
        <Button variant="subtle" onClick={props.onAddTrack}>
          <Plus size={16} aria-hidden="true" /> {t("timeline.addVideo")}
        </Button>
      ) : null}
      {draft ? (
        <>
          <label>
            {t("imageEdit.textLabel")}
            <textarea
              value={draft.text}
              maxLength={10_000}
              onChange={(event) => update({ text: event.currentTarget.value })}
            />
          </label>
          <label>
            {t("timelineEffects.title")}
            <select
              value={draft.track_id}
              aria-label={t("timelineEffects.title")}
              disabled={!hasEmptyTrack}
              onChange={(event) => update({ track_id: event.currentTarget.value })}
            >
              {trackOptions.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("timelineEffects.cueStartUs")}
            <input
              type="number"
              min={0}
              step={1}
              value={draft.start_us}
              onChange={(event) =>
                update({
                  start_us: Math.round(numberValue(event.currentTarget.value, draft.start_us)),
                })
              }
            />
          </label>
          <label>
            {t("timelineEffects.cueEndUs")}
            <input
              type="number"
              min={draft.start_us + 1}
              step={1}
              value={draft.end_us}
              onChange={(event) =>
                update({ end_us: Math.round(numberValue(event.currentTarget.value, draft.end_us)) })
              }
            />
          </label>
          <label>
            {t("officeDeck.font")}
            <select
              value={draft.style.font_asset_id}
              onChange={(event) =>
                update({
                  style: { ...draft.style, font_asset_id: event.currentTarget.value },
                })
              }
            >
              {FONT_ASSETS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("officeDeck.size")}
            <input
              type="number"
              min={1}
              max={512}
              step={1}
              value={draft.style.font_size}
              onChange={(event) =>
                update({
                  style: {
                    ...draft.style,
                    font_size: numberValue(event.currentTarget.value, draft.style.font_size),
                  },
                })
              }
            />
          </label>
          <label>
            {t("officeSheet.group.alignment")}
            <select
              value={draft.style.align}
              onChange={(event) =>
                update({
                  style: { ...draft.style, align: event.currentTarget.value as TitleAlign },
                })
              }
            >
              {ALIGNS.map((align) => (
                <option key={align} value={align}>
                  {t(ALIGN_KEYS[align])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("layers.positionX")}
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.style.x}
              onChange={(event) =>
                update({
                  style: { ...draft.style, x: numberValue(event.currentTarget.value, draft.style.x) },
                })
              }
            />
          </label>
          <label>
            {t("layers.positionY")}
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.style.y}
              onChange={(event) =>
                update({
                  style: { ...draft.style, y: numberValue(event.currentTarget.value, draft.style.y) },
                })
              }
            />
          </label>
          <label>
            {t("imageEdit.color")}
            <input
              type="color"
              value={rgbaHex(draft.style.rgba)}
              aria-label={t("imageEdit.color")}
              onChange={(event) =>
                update({
                  style: { ...draft.style, rgba: hexRgba(event.currentTarget.value, draft.style.rgba[3]) },
                })
              }
            />
          </label>
          <label>
            {t("officeDeck.animation")}
            <select
              value={draft.animation}
              onChange={(event) =>
                update({ animation: event.currentTarget.value as TitleAnimation })
              }
            >
              {ANIMATIONS.map((animation) => (
                <option key={animation} value={animation}>
                  {t(ANIMATION_KEYS[animation])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("officeDeck.animationDuration")}
            <input
              type="number"
              min={0}
              max={Math.max(0, draft.end_us - draft.start_us)}
              step={1}
              value={draft.animation_us}
              disabled={draft.animation === "none"}
              onChange={(event) =>
                update({
                  animation_us: Math.round(
                    numberValue(event.currentTarget.value, draft.animation_us),
                  ),
                })
              }
            />
          </label>
          <Button disabled={pending} onClick={() => void apply()}>
            {t("timelineEffects.apply")}
          </Button>
        </>
      ) : (
        <p>{t("timeline.noSelection")}</p>
      )}
      {failed ? <p role="alert">{t("errors.timeline.failed")}</p> : null}
    </section>
  );
}
