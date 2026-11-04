import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import type { TimelineEffectOperation } from "./effectTypes";
import type { TimelineEffect, TimelineProject, TimelineClip } from "./types";

const EFFECT_LABEL_KEYS = {
  brightness: "imageEdit.brightness",
  contrast: "imageEdit.contrast",
  saturation: "imageEdit.saturation",
  color: "imageEdit.color",
  crop: "imageEdit.crop",
} as const;

type OfferedEffect = keyof typeof EFFECT_LABEL_KEYS;
const OFFERED_EFFECTS: readonly OfferedEffect[] = [
  "brightness",
  "contrast",
  "saturation",
  "color",
  "crop",
];

function cloneEffects(effects: readonly TimelineEffect[]): TimelineEffect[] {
  return effects.map((effect) => structuredClone(effect));
}

function effectLabelKey(tag: TimelineEffect["tag"]): string {
  // A project may still carry stabilization; it stays visible and removable
  // but cannot be applied until an audited capability exists.
  return tag === "stabilize" ? "imageEdit.filters" : EFFECT_LABEL_KEYS[tag];
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultEffect(tag: OfferedEffect, project: Readonly<TimelineProject>): TimelineEffect {
  switch (tag) {
    case "brightness":
      return { tag: "brightness", value: 0 };
    case "contrast":
      return { tag: "contrast", value: 0 };
    case "saturation":
      return { tag: "saturation", value: 0 };
    case "color":
      return { tag: "color", gamma: [1, 1, 1] as [number, number, number] };
    case "crop":
      return {
        tag: "crop",
        rect: { x: 0, y: 0, width: project.width, height: project.height },
      };
    default:
      return { tag: "brightness", value: 0 };
  }
}

export interface TimelineEffectsPanelProps {
  project: Readonly<TimelineProject>;
  clip: TimelineClip | null;
  onApply: (operation: TimelineEffectOperation) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

/**
 * Ordered clip effect editor (19b D4). Only effects the current build can
 * validate and apply are offered: brightness, contrast, saturation, color and
 * crop. Stabilization is never advertised because no audited non-AI capability
 * exists, and gamma/crop stay plain numbers, never filter text.
 */
export default function TimelineEffectsPanel(props: TimelineEffectsPanelProps) {
  const { t } = useTranslation();
  const { project, clip } = props;
  const [draft, setDraft] = useState<TimelineEffect[]>(() => (clip ? cloneEffects(clip.effects) : []));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDraft(clip ? cloneEffects(clip.effects) : []);
    setFailed(false);
  }, [clip?.id, clip?.effects]);

  const update = (index: number, next: TimelineEffect) => {
    setDraft((current) => current.map((effect, at) => (at === index ? next : effect)));
  };

  const add = (tag: OfferedEffect) => {
    setDraft((current) => [...current, defaultEffect(tag, project)]);
  };

  const remove = (index: number) => {
    setDraft((current) => current.filter((_, at) => at !== index));
  };

  const apply = async () => {
    if (!clip || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onApply({ kind: "set_effects", clip_id: clip.id, effects: draft });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="adp-timeline-effect" aria-label={t("timelineEffects.color")}>
      <header>
        <h3>{t("timelineEffects.color")}</h3>
        <HelpButton onOpenHelp={() => props.onOpenHelp("timeline-effects")} />
      </header>
      {!clip ? (
        <p>{t("timeline.noSelection")}</p>
      ) : (
        <>
          <div className="adp-timeline-effect-list">
            {draft.map((effect, index) => (
              <div className="adp-timeline-effect-row" key={`${effect.tag}-${index}`}>
                <span>{t(effectLabelKey(effect.tag))}</span>
                {effect.tag === "brightness" ||
                effect.tag === "contrast" ||
                effect.tag === "saturation" ? (
                  <input
                    type="number"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={effect.value}
                    aria-label={t(effectLabelKey(effect.tag))}
                    onChange={(event) =>
                      update(index, {
                        tag: effect.tag,
                        value: numberValue(event.currentTarget.value, effect.value),
                      } as TimelineEffect)
                    }
                  />
                ) : null}
                {effect.tag === "color"
                  ? effect.gamma.map((gamma, channel) => (
                      <input
                        key={channel}
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={gamma}
                        aria-label={`${t("imageEdit.color")} ${channel + 1}`}
                        onChange={(event) => {
                          const next = [...effect.gamma] as [number, number, number];
                          next[channel] = numberValue(event.currentTarget.value, gamma);
                          update(index, { tag: "color", gamma: next });
                        }}
                      />
                    ))
                  : null}
                {effect.tag === "crop" ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={effect.rect.x}
                      aria-label={t("imageEdit.cropX")}
                      onChange={(event) =>
                        update(index, {
                          tag: "crop",
                          rect: {
                            ...effect.rect,
                            x: Math.round(numberValue(event.currentTarget.value, effect.rect.x)),
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={effect.rect.y}
                      aria-label={t("imageEdit.cropY")}
                      onChange={(event) =>
                        update(index, {
                          tag: "crop",
                          rect: {
                            ...effect.rect,
                            y: Math.round(numberValue(event.currentTarget.value, effect.rect.y)),
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={effect.rect.width}
                      aria-label={t("imageEdit.cropWidth")}
                      onChange={(event) =>
                        update(index, {
                          tag: "crop",
                          rect: {
                            ...effect.rect,
                            width: Math.round(
                              numberValue(event.currentTarget.value, effect.rect.width),
                            ),
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={effect.rect.height}
                      aria-label={t("imageEdit.cropHeight")}
                      onChange={(event) =>
                        update(index, {
                          tag: "crop",
                          rect: {
                            ...effect.rect,
                            height: Math.round(
                              numberValue(event.currentTarget.value, effect.rect.height),
                            ),
                          },
                        })
                      }
                    />
                  </>
                ) : null}
                <IconButton
                  icon={Trash2}
                  labelKey="commands.delete"
                  onClick={() => remove(index)}
                />
              </div>
            ))}
          </div>
          <label className="adp-timeline-effect-add">
            <Plus size={16} aria-hidden="true" />
            <select
              value=""
              aria-label={t("imageEdit.adjust")}
              onChange={(event) => {
                const tag = event.currentTarget.value as OfferedEffect;
                if (OFFERED_EFFECTS.includes(tag)) add(tag);
                event.currentTarget.value = "";
              }}
            >
              <option value="">{t("imageEdit.adjust")}</option>
              {OFFERED_EFFECTS.map((tag) => (
                <option key={tag} value={tag}>
                  {t(EFFECT_LABEL_KEYS[tag])}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={pending} onClick={() => void apply()}>
            {t("timelineEffects.apply")}
          </Button>
        </>
      )}
      {failed ? <p role="alert">{t("errors.timeline.failed")}</p> : null}
    </section>
  );
}
