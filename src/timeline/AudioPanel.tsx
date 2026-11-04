import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import { formatNumber } from "./format";
import type { TimelineEffectOperation } from "./effectTypes";

export interface AudioPanelProps {
  id: string;
  scope: "track" | "clip";
  gain: number;
  mute: boolean;
  solo: boolean;
  fade_in_us?: number;
  fade_out_us?: number;
  peak: number;
  onApply(operation: TimelineEffectOperation): Promise<void>;
  onOpenHelp(slug: string): void;
}

export default function AudioPanel(props: AudioPanelProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState({ gain: props.gain, mute: props.mute, solo: props.solo,
    fade_in_us: props.fade_in_us ?? 0, fade_out_us: props.fade_out_us ?? 0 });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setDraft({ gain: props.gain, mute: props.mute, solo: props.solo,
      fade_in_us: props.fade_in_us ?? 0, fade_out_us: props.fade_out_us ?? 0 });
  }, [props.id, props.gain, props.mute, props.solo, props.fade_in_us, props.fade_out_us]);
  return <section className="adp-timeline-effect" aria-label={t("timelineEffects.audio")}>
    <header><h3>{t("timelineEffects.audio")}</h3><HelpButton onOpenHelp={() => props.onOpenHelp("timeline-audio")} /></header>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (pending) return; setPending(true); setFailed(false);
      try {
        await props.onApply(props.scope === "clip"
          ? { kind: "set_clip_audio", id: props.id, ...draft }
          : { kind: "set_track_audio", id: props.id, gain: draft.gain, mute: draft.mute, solo: draft.solo });
      } catch { setFailed(true); } finally { setPending(false); }
    }}>
      <fieldset disabled={pending}>
        <label>{t("mediaEdit.volume")}<input type="number" min={0} max={4} step={0.01} required value={draft.gain}
          onChange={(e) => setDraft({ ...draft, gain: e.currentTarget.valueAsNumber })} /></label>
        <label><input type="checkbox" checked={draft.mute} onChange={(e) => setDraft({ ...draft, mute: e.currentTarget.checked })} />{t("mediaEdit.mute")}</label>
        <label><input type="checkbox" checked={draft.solo} onChange={(e) => setDraft({ ...draft, solo: e.currentTarget.checked })} />{t("timelineEffects.solo")}</label>
        {props.scope === "clip" && (["fade_in_us", "fade_out_us"] as const).map((key) => <label key={key}>
          {t(key === "fade_in_us" ? "timelineEffects.fadeInUs" : "timelineEffects.fadeOutUs")}
          <input type="number" min={0} step={1} required value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.currentTarget.valueAsNumber })} />
        </label>)}
        <Button type="submit">{t("timelineEffects.apply")}</Button>
      </fieldset>
    </form>
    <output>{t("timelineEffects.level", { gain: formatNumber(props.gain, i18n.language), peak: formatNumber(props.peak, i18n.language) })}</output>
    {props.peak > 1 && <p role="status">{t("timelineEffects.clipping")}</p>}
    {failed && <p role="alert">{t("errors.timeline_export.failed")}</p>}
  </section>;
}
