/** Settings > Accessibility > Motion and comfort (Step 10f T5). */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import {
  REDUCED_MOTION_SETTINGS,
  type AccessibilitySettings,
  type ReducedMotionSetting,
} from "../../services/accessibility";

export interface MotionSettingsProps {
  value: AccessibilitySettings;
  onChange: (next: AccessibilitySettings) => void;
  onOpenHelp: (slug: string) => void;
  /** Windows reduced motion cannot be overridden off (D10). */
  systemReducedMotion?: boolean;
  onFocusLayout?: () => void;
  focusLayoutActive?: boolean;
}

const MOTION_KEYS: Record<ReducedMotionSetting, string> = {
  system: "accessibility.system",
  on: "accessibility.on",
  off: "accessibility.off",
};

export default function MotionSettings({
  value,
  onChange,
  onOpenHelp,
  systemReducedMotion = false,
  onFocusLayout,
  focusLayoutActive = false,
}: MotionSettingsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<AccessibilitySettings>) => onChange({ ...value, ...patch });

  return (
    <section className="adp-settings-section adp-accessibility-section" aria-labelledby="adp-motion-title">
      <div className="adp-view-header">
        <h3 id="adp-motion-title" className="adp-heading">
          {t("accessibility.motion")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("accessibility-motion")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.reduce")}</span>
        <div className="adp-button-row" role="group" aria-label={t("accessibility.reduce")}>
          {REDUCED_MOTION_SETTINGS.map((mode) => (
            <Button
              key={mode}
              variant={value.reduced_motion === mode ? "primary" : "default"}
              aria-pressed={value.reduced_motion === mode}
              disabled={systemReducedMotion && mode === "off"}
              onClick={() => update({ reduced_motion: mode })}
            >
              {t(MOTION_KEYS[mode])}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.noAutoplay")}</span>
        <Switch
          checked={value.no_autoplay}
          label={t("accessibility.noAutoplay")}
          onChange={(checked) => update({ no_autoplay: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.focusLayout")}</span>
        <Button disabled={!onFocusLayout} aria-pressed={focusLayoutActive} onClick={onFocusLayout}>
          {t("accessibility.focusLayout")}
        </Button>
      </div>
    </section>
  );
}
