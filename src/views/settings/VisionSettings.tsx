/** Settings > Accessibility > Vision (Step 10f T5). */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import {
  COLOR_MODES,
  CURSOR_SIZES,
  type AccessibilitySettings,
  type ColorMode,
  type CursorSize,
  type FocusPx,
} from "../../services/accessibility";
import type { ReadVoice } from "../../services/readAloud";

export interface VisionSettingsProps {
  value: AccessibilitySettings;
  onChange: (next: AccessibilitySettings) => void;
  onOpenHelp: (slug: string) => void;
  voices?: readonly ReadVoice[];
  forcedColors?: boolean;
}

const FOCUS_VALUES: readonly FocusPx[] = [2, 3, 4];

export default function VisionSettings({
  value,
  onChange,
  onOpenHelp,
  voices = [],
  forcedColors = false,
}: VisionSettingsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<AccessibilitySettings>) => onChange({ ...value, ...patch });

  return (
    <section className="adp-settings-section adp-accessibility-section" aria-labelledby="adp-vision-title">
      <div className="adp-view-header">
        <h3 id="adp-vision-title" className="adp-heading">
          {t("accessibility.vision")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("accessibility-vision")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.largeTargets")}</span>
        <Switch
          checked={value.large_targets}
          label={t("accessibility.largeTargets")}
          onChange={(checked) => update({ large_targets: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.focus")}</span>
        <div className="adp-button-row" role="group" aria-label={t("accessibility.focus")}>
          {FOCUS_VALUES.map((px) => (
            <Button
              key={px}
              variant={value.focus_px === px ? "primary" : "default"}
              aria-pressed={value.focus_px === px}
              onClick={() => update({ focus_px: px })}
            >
              {px}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.cursor")}</span>
        <div className="adp-button-row" role="group" aria-label={t("accessibility.cursor")}>
          {CURSOR_SIZES.map((size) => (
            <Button
              key={size}
              variant={value.cursor === size ? "primary" : "default"}
              aria-pressed={value.cursor === size}
              onClick={() => update({ cursor: size as CursorSize })}
            >
              {t(`accessibility.${size}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.color")}</span>
        <div className="adp-button-row" role="group" aria-label={t("accessibility.color")}>
          {COLOR_MODES.map((mode) => (
            <Button
              key={mode}
              variant={value.color_mode === mode ? "primary" : "default"}
              aria-pressed={value.color_mode === mode}
              disabled={forcedColors}
              onClick={() => update({ color_mode: mode as ColorMode })}
            >
              {t(`accessibility.${mode}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.font")}</span>
        <Switch
          checked={value.dyslexic_font}
          label={t("accessibility.font")}
          onChange={(checked) => update({ dyslexic_font: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-letter-spacing">
          {t("accessibility.letters")}
        </label>
        <input
          id="adp-letter-spacing"
          type="number"
          min={0}
          max={0.2}
          step={0.01}
          value={value.letter_spacing_em}
          onChange={(event) => update({ letter_spacing_em: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-word-spacing">
          {t("accessibility.words")}
        </label>
        <input
          id="adp-word-spacing"
          type="number"
          min={0}
          max={0.5}
          step={0.01}
          value={value.word_spacing_em}
          onChange={(event) => update({ word_spacing_em: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-line-height">
          {t("accessibility.lines")}
        </label>
        <input
          id="adp-line-height"
          type="number"
          min={1}
          max={2}
          step={0.1}
          value={value.line_height}
          onChange={(event) => update({ line_height: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.voice")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("accessibility.voice")}
          value={value.read_voice_id ?? ""}
          onChange={(event) =>
            update({ read_voice_id: event.target.value === "" ? undefined : event.target.value })
          }
        >
          <option value="">{t("accessibility.none")}</option>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name} ({voice.language})
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-read-rate">
          {t("accessibility.rate")}
        </label>
        <input
          id="adp-read-rate"
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={value.read_rate}
          onChange={(event) => update({ read_rate: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-read-volume">
          {t("accessibility.volume")}
        </label>
        <input
          id="adp-read-volume"
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={value.read_volume}
          onChange={(event) => update({ read_volume: Number(event.target.value) })}
        />
      </div>
    </section>
  );
}
