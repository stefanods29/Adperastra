import { useTranslation } from "react-i18next";
import type { SpeechLanguage } from "../services/speechTypes";
import type { CaptionState } from "./useAutomaticCaptions";
import HelpButton from "../components/HelpButton";

/**
 * Automatic-caption control and overlay for the active media player (D8).
 *
 * The switch is off until the user chooses it. While a window is preparing the
 * status says so; no invented words are shown. The overlay is a plain,
 * escaped text layer styled by the 10f accessibility settings.
 */

export interface AutomaticCaptionsProps {
  state: CaptionState;
  language: SpeechLanguage;
  positionUs: number;
  onChangeLanguage: (language: SpeechLanguage) => void;
  onToggle: (enabled: boolean) => void;
  onChooseSubtitleFile: () => void;
  onChooseAutomatic: () => void;
  onOpenHelp: (slug: string) => void;
}

export function AutomaticCaptions({
  state,
  language,
  positionUs,
  onChangeLanguage,
  onToggle,
  onChooseSubtitleFile,
  onChooseAutomatic,
  onOpenHelp,
}: AutomaticCaptionsProps) {
  const { t } = useTranslation();
  const current = state.cues.find((cue) => positionUs >= cue.start_us && positionUs < cue.end_us) ?? null;

  return (
    <section className="adp-captions" aria-label={t("speech.captions")}>
      <div className="adp-captions-controls" role="group">
        <label className="adp-captions-switch">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span>{t("speech.captions")}</span>
        </label>
        <label className="adp-captions-language">
          <span>{t("aiActions.targetLanguage")}</span>
          <select
            value={language}
            onChange={(event) => onChangeLanguage(event.target.value as SpeechLanguage)}
            aria-label={t("aiActions.targetLanguage")}
          >
            <option value="auto">{t("ai.auto")}</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <button type="button" onClick={onChooseSubtitleFile} aria-pressed={state.subtitleFileChosen}>
          {t("speech.srt")}
        </button>
        <button type="button" onClick={onChooseAutomatic} aria-pressed={!state.subtitleFileChosen}>
          {t("speech.captions")}
        </button>
        <HelpButton onOpenHelp={() => onOpenHelp("automatic-captions")} />
      </div>

      <div className="adp-captions-overlay" role="region" aria-live="polite" aria-atomic="true">
        {state.subtitleFileChosen ? null : current ? <span className="adp-captions-line">{current.text}</span> : null}
        {!state.subtitleFileChosen && state.status === "preparing" ? (
          <span className="adp-captions-status" role="status">
            {t("speech.preparing")}
          </span>
        ) : null}
        {state.status === "ready" && state.cues.length === 0 ? (
          <span className="adp-captions-status" role="status">
            {t("speech.noSpeech")}
          </span>
        ) : null}
        {state.status === "failed" ? (
          <span className="adp-captions-status" role="alert">
            {state.errorCode === "speech.pack_missing" ? t("errors.speech.pack_missing") : t("errors.speech.failed")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
