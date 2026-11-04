import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import type { TimelineEffectOperation } from "./effectTypes";
import { formatTimecode } from "./format";
import type {
  Rgba,
  TimelineClip,
  TimelineProject,
  TimelineTransition,
  Track,
  TransitionDirection,
  TransitionKind,
} from "./types";
import { newUuid, TIMELINE_MAX_TRANSITION_US } from "./types";
import { clipDurationUs, clipEndUs } from "./timing";

const KINDS: readonly TransitionKind[] = ["crossfade", "dip", "wipe"];
const DIRECTIONS: readonly TransitionDirection[] = ["left", "right", "up", "down"];

const KIND_KEYS: Record<TransitionKind, string> = {
  crossfade: "timelineEffects.crossfade",
  dip: "timelineEffects.dip",
  wipe: "timelineEffects.wipe",
};

const DIRECTION_KEYS: Record<TransitionDirection, string> = {
  left: "officeDeck.direction.left",
  right: "officeDeck.direction.right",
  up: "officeDeck.direction.up",
  down: "officeDeck.direction.down",
};

interface TransitionPair {
  key: string;
  track: Track;
  left: TimelineClip;
  right: TimelineClip;
  existing: TimelineTransition | null;
  maxDuration: number;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function nameOf(project: Readonly<TimelineProject>, clip: TimelineClip): string {
  const source = project.sources.find((item) => item.id === clip.source_id);
  return source ? baseName(source.path) : formatTimecode(clip.start_us, "en");
}

function rgbaHex(rgba: Rgba): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(rgba[0])}${part(rgba[1])}${part(rgba[2])}`;
}

function hexRgba(hex: string, alpha: number): Rgba {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return [0, 0, 0, alpha];
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

function buildPairs(project: Readonly<TimelineProject>): TransitionPair[] {
  const pairs: TransitionPair[] = [];
  const byPair = new Map<string, TimelineTransition>(
    project.transitions.map((transition): [string, TimelineTransition] => [
      `${transition.left_clip_id}:${transition.right_clip_id}`,
      transition,
    ]),
  );
  for (const track of project.tracks) {
    if (track.kind !== "video") continue;
    const ordered = [...track.clips].sort(
      (left, right) => left.start_us - right.start_us || left.id.localeCompare(right.id),
    );
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const left = ordered[index];
      const right = ordered[index + 1];
      const existing = byPair.get(`${left.id}:${right.id}`) ?? null;
      // A pair is adjacent when the right clip starts exactly where the left
      // one ends, minus any transition overlap already applied (19b D2).
      if (right.start_us !== clipEndUs(left) - (existing?.duration_us ?? 0)) continue;
      const maxDuration = Math.min(
        Math.floor(clipDurationUs(left) / 2),
        Math.floor(clipDurationUs(right) / 2),
        TIMELINE_MAX_TRANSITION_US,
      );
      if (maxDuration < 1) continue;
      pairs.push({
        key: `${track.id}:${left.id}:${right.id}`,
        track,
        left,
        right,
        existing,
        maxDuration,
      });
    }
  }
  return pairs;
}

export interface TimelineTransitionPanelProps {
  project: Readonly<TimelineProject>;
  /** A transition marker clicked in the track list. */
  selectedId?: string | null;
  onApply: (operation: TimelineEffectOperation) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

/**
 * Transition editor (19b D2). It only lists adjacent video clips; applying a
 * duration shifts later clips on that track through the shared transition
 * operation, never through ad-hoc start edits. Source in/out stay unchanged.
 */
export default function TimelineTransitionPanel(props: TimelineTransitionPanelProps) {
  const { t } = useTranslation();
  const { project } = props;
  const pairs = useMemo(() => buildPairs(project), [project]);
  const [pairKey, setPairKey] = useState<string | null>(() => {
    const selected = props.selectedId
      ? project.transitions.find((transition) => transition.id === props.selectedId)
      : null;
    if (selected) return `${selected.track_id}:${selected.left_clip_id}:${selected.right_clip_id}`;
    return null;
  });
  const [draft, setDraft] = useState<TimelineTransition | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!props.selectedId) return;
    const found = project.transitions.find((transition) => transition.id === props.selectedId);
    if (!found) return;
    setPairKey(`${found.track_id}:${found.left_clip_id}:${found.right_clip_id}`);
  }, [props.selectedId, project.transitions]);

  useEffect(() => {
    const pair = pairs.find((item) => item.key === pairKey) ?? pairs[0];
    if (!pair) {
      setDraft(null);
      return;
    }
    if (pair.key !== pairKey) {
      setPairKey(pair.key);
      return;
    }
    const existing = pair.existing;
    setDraft({
      id: existing?.id ?? newUuid(),
      track_id: pair.track.id,
      left_clip_id: pair.left.id,
      right_clip_id: pair.right.id,
      kind: existing?.kind ?? "crossfade",
      duration_us: existing?.duration_us ?? Math.min(1_000_000, pair.maxDuration),
      direction: existing?.direction ?? "left",
      rgba: existing?.rgba ? ([...existing.rgba] as Rgba) : ([0, 0, 0, 255] as Rgba),
      enabled: true,
    });
    // The draft is intentionally reset when the pair or committed project
    // changes; typing does not change either dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey, pairs]);

  const pair = pairs.find((item) => item.key === pairKey) ?? null;
  const update = (patch: Partial<TimelineTransition>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const apply = async () => {
    if (!draft || !pair || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onApply({
        kind: "set_transition",
        transition: draft,
        left_id: pair.left.id,
        right_id: pair.right.id,
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!pair || !pair.existing || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onApply({
        kind: "set_transition",
        transition: null,
        left_id: pair.left.id,
        right_id: pair.right.id,
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="adp-timeline-effect" aria-label={t("timelineEffects.transitions")}>
      <header>
        <h3>{t("timelineEffects.transitions")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("timeline-transitions")} />
      </header>
      {pairs.length === 0 ? <p>{t("timeline.noSelection")}</p> : null}
      {pairs.length > 0 ? (
        <label>
          {t("timelineEffects.transitions")}
          <select
            value={pairKey ?? ""}
            aria-label={t("timelineEffects.transitions")}
            onChange={(event) => setPairKey(event.currentTarget.value)}
          >
            {pairs.map((item) => (
              <option key={item.key} value={item.key}>
                {item.track.name}: {nameOf(project, item.left)} → {nameOf(project, item.right)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {draft && pair ? (
        <>
          <label>
            {t("timelineEffects.transitions")}
            <select
              value={draft.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value as TransitionKind;
                update({
                  kind,
                  duration_us: Math.min(draft.duration_us, pair.maxDuration),
                });
              }}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(KIND_KEYS[kind])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("officeDeck.transitionDuration")}
            <input
              type="number"
              min={1}
              max={pair.maxDuration}
              step={1}
              value={draft.duration_us}
              onChange={(event) =>
                update({
                  duration_us: Math.min(
                    pair.maxDuration,
                    Math.max(
                      1,
                      Math.round(numberValue(event.currentTarget.value, draft.duration_us)),
                    ),
                  ),
                })
              }
            />
          </label>
          <label>
            {t("officeDeck.direction.left")}
            <select
              value={draft.direction}
              disabled={draft.kind !== "wipe"}
              onChange={(event) =>
                update({ direction: event.currentTarget.value as TransitionDirection })
              }
            >
              {DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {t(DIRECTION_KEYS[direction])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("imageEdit.color")}
            <input
              type="color"
              value={rgbaHex(draft.rgba)}
              aria-label={t("imageEdit.color")}
              disabled={draft.kind !== "dip"}
              onChange={(event) =>
                update({ rgba: hexRgba(event.currentTarget.value, draft.rgba[3]) })
              }
            />
          </label>
          <Button disabled={pending} onClick={() => void apply()}>
            {t("officeDeck.applyTransition")}
          </Button>
          <Button
            variant="subtle"
            disabled={pending || !pair.existing}
            onClick={() => void remove()}
          >
            <Trash2 size={16} aria-hidden="true" /> {t("commands.delete")}
          </Button>
        </>
      ) : null}
      {failed ? <p role="alert">{t("errors.timeline.failed")}</p> : null}
    </section>
  );
}
