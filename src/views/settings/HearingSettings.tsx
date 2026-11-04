/** Settings > Accessibility > Hearing (Step 10f T5). */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { AccessibilitySettings, SubtitlePosition } from "../../services/accessibility";

export interface HearingSettingsProps {
  value: AccessibilitySettings;
  onChange: (next: AccessibilitySettings) => void;
  onOpenHelp: (slug: string) => void;
  /** True only when the 17b speech provider is registered and ready. */
  captionsProviderReady?: boolean;
  onOpenCaptionSetup?: () => void;
}

const POSITIONS: readonly SubtitlePosition[] = ["bottom", "top"];

export default function HearingSettings({
  value,
  onChange,
  onOpenHelp,
  captionsProviderReady = false,
  onOpenCaptionSetup,
}: HearingSettingsProps) {
  const { t } = useTranslation();
  const subtitle = value.subtitle;
  const update = (patch: Partial<AccessibilitySettings>) => onChange({ ...value, ...patch });
  const updateSubtitle = (patch: Partial<AccessibilitySettings["subtitle"]>) =>
    update({ subtitle: { ...subtitle, ...patch } });

  return (
    <section className="adp-settings-section adp-accessibility-section" aria-labelledby="adp-hearing-title">
      <div className="adp-view-header">
        <h3 id="adp-hearing-title" className="adp-heading">
          {t("accessibility.hearing")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("accessibility-hearing")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.visual")}</span>
        <Switch checked label={t("accessibility.visual")} disabled onChange={() => undefined} />
      </div>
      <p className="adp-note">{t("accessibility.subtitles")}</p>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-subtitle-size">
          {t("accessibility.subtitles")}
        </label>
        <input
          id="adp-subtitle-size"
          type="number"
          min={75}
          max={300}
          step={5}
          value={subtitle.font_percent}
          onChange={(event) => updateSubtitle({ font_percent: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-subtitle-color">
          {t("accessibility.subtitles")}
        </label>
        <input
          id="adp-subtitle-color"
          type="color"
          value={subtitle.text_color}
          onChange={(event) => updateSubtitle({ text_color: event.target.value.toUpperCase() })}
        />
        <input
          type="color"
          aria-label={t("accessibility.subtitles")}
          value={subtitle.background_color}
          onChange={(event) => updateSubtitle({ background_color: event.target.value.toUpperCase() })}
        />
        <input
          type="number"
          aria-label={t("accessibility.subtitles")}
          min={0}
          max={1}
          step={0.05}
          value={subtitle.background_opacity}
          onChange={(event) => updateSubtitle({ background_opacity: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.subtitles")}</span>
        <div className="adp-button-row" role="group" aria-label={t("accessibility.subtitles")}>
          {POSITIONS.map((position) => (
            <Button
              key={position}
              variant={subtitle.position === position ? "primary" : "default"}
              aria-pressed={subtitle.position === position}
              onClick={() => updateSubtitle({ position })}
            >
              {t(`accessibility.${position}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.autoCaptions")}</span>
        <Switch
          checked={value.auto_captions && captionsProviderReady}
          label={t("accessibility.autoCaptions")}
          disabled={!captionsProviderReady}
          onChange={(checked) => update({ auto_captions: checked })}
        />
      </div>
      {!captionsProviderReady ? (
        <p className="adp-note">
          {t("accessibility.captionsUnavailable")}{" "}
          {onOpenCaptionSetup ? (
            <Button variant="subtle" onClick={onOpenCaptionSetup}>
              {t("accessibility.autoCaptions")}
            </Button>
          ) : null}
        </p>
      ) : null}
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.sound")}</span>
        <Switch
          checked={value.completion_sound}
          label={t("accessibility.sound")}
          onChange={(checked) => update({ completion_sound: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-sound-volume">
          {t("accessibility.volume")}
        </label>
        <input
          id="adp-sound-volume"
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={value.sound_volume}
          onChange={(event) => update({ sound_volume: Number(event.target.value) })}
        />
      </div>
    </section>
  );
}
