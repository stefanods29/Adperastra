import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import type { MediaSubtitleCue } from "../media-edit/types";
import { validateTimelineSubtitles } from "./subtitleTimeline";

export interface SubtitlePanelProps {
  cues: readonly MediaSubtitleCue[];
  onApply(cues: MediaSubtitleCue[]): Promise<void>;
  onOpenHelp(slug: string): void;
}
const PAGE_SIZE = 32;

export default function SubtitlePanel({ cues, onApply, onOpenHelp }: SubtitlePanelProps) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<MediaSubtitleCue | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setDraft(null); setOffset((old) => Math.min(old, Math.max(0, Math.ceil(cues.length / PAGE_SIZE) - 1) * PAGE_SIZE)); }, [cues]);
  return <section className="adp-timeline-effect" aria-label={t("timelineEffects.subtitles")}>
    <header><h3>{t("timelineEffects.subtitles")}</h3><HelpButton onOpenHelp={() => onOpenHelp("timeline-audio")} /></header>
    <div className="adp-timeline-cue-grid" role="grid" aria-label={t("timelineEffects.subtitles")} aria-rowcount={cues.length}>
      {cues.slice(offset, offset + PAGE_SIZE).map((cue, index) => <div role="row" aria-rowindex={offset + index + 1} key={cue.id}>
        <div role="gridcell"><Button disabled={pending} aria-pressed={draft?.id === cue.id} onClick={() => { setDraft({ ...cue }); setFailed(false); }}>{cue.text}</Button></div>
      </div>)}
    </div>
    <nav aria-label={t("timelineEffects.subtitles")}>
      <Button disabled={pending || offset === 0} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setDraft(null); }}>{t("timelineEffects.previous")}</Button>
      <Button disabled={pending || offset + PAGE_SIZE >= cues.length} onClick={() => { setOffset(offset + PAGE_SIZE); setDraft(null); }}>{t("timelineEffects.next")}</Button>
    </nav>
    {draft && <form onSubmit={async (event) => {
      event.preventDefault(); if (pending) return; setPending(true); setFailed(false);
      try {
        const next = validateTimelineSubtitles(cues.map((cue) => cue.id === draft.id ? draft : cue));
        await onApply(next); setDraft(null);
      } catch { setFailed(true); } finally { setPending(false); }
    }}><fieldset disabled={pending}>
      <label>{t("timelineEffects.cueStartUs")}<input type="number" required min={0} step={1} value={draft.start_us}
        onChange={(e) => setDraft({ ...draft, start_us: e.currentTarget.valueAsNumber })} /></label>
      <label>{t("timelineEffects.cueEndUs")}<input type="number" required min={1} step={1} value={draft.end_us}
        onChange={(e) => setDraft({ ...draft, end_us: e.currentTarget.valueAsNumber })} /></label>
      <label>{t("timelineEffects.cueText")}<textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })} /></label>
      <Button type="submit">{t("timelineEffects.apply")}</Button>
      <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
    </fieldset></form>}
    {failed && <p role="alert">{t("errors.timeline_export.failed")}</p>}
  </section>;
}
