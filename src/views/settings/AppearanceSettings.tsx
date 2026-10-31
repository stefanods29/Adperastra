/** Settings > Appearance (Step 05d): scale, density, corners, animations. */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import {
  ANIMATION_LEVELS,
  CORNER_RADII,
  DENSITIES,
  UI_SCALES,
  type AnimationLevel,
  type AppSettings,
  type CornerRadius,
  type Density,
} from "../../services/settings";

export interface AppearanceSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

const DENSITY_KEYS: Record<Density, string> = {
  compact: "settings.densityCompact",
  comfortable: "settings.densityComfortable",
  spacious: "settings.densitySpacious",
};

const RADIUS_KEYS: Record<CornerRadius, string> = {
  square: "settings.radiusSquare",
  standard: "settings.radiusStandard",
  round: "settings.radiusRound",
};

const ANIMATION_KEYS: Record<AnimationLevel, string> = {
  full: "settings.animationsFull",
  reduced: "settings.animationsReduced",
  off: "settings.animationsOff",
};

export default function AppearanceSettings({ settings, onApply, onOpenHelp }: AppearanceSettingsProps) {
  const { t } = useTranslation();
  const appearance = settings.appearance;
  const update = (patch: Partial<AppSettings["appearance"]>) =>
    onApply({ ...settings, appearance: { ...appearance, ...patch } });

  const choiceRow = (
    labelKey: string,
    field: string,
    values: readonly string[],
    labels: Record<string, string>,
    chosen: string,
    onChoose: (value: string) => void,
  ) => (
    <div className="adp-setting-row">
      <span className="adp-setting-label">{t(labelKey)}</span>
      <div className="adp-button-row">
        {values.map((value) => (
          <Button
            key={value}
            variant={chosen === value ? "primary" : "default"}
            aria-pressed={chosen === value}
            {...{ [`data-appearance-${field}`]: value }}
            onClick={() => onChoose(value)}
          >
            {t(labels[value])}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="adp-settings-section" aria-labelledby="adp-appearance-title">
      <div className="adp-view-header">
        <h3 id="adp-appearance-title" className="adp-heading">
          {t("settings.appearance")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("themes-and-appearance")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.uiScale")}</span>
        <select
          className="adp-defaultapps-select"
          aria-label={t("settings.uiScale")}
          data-appearance-field="ui_scale"
          value={appearance.ui_scale}
          onChange={(event) => update({ ui_scale: Number(event.target.value) })}
        >
          {UI_SCALES.map((scale) => (
            <option key={scale} value={scale}>
              {t("settings.uiScaleValue", { value: scale })}
            </option>
          ))}
        </select>
      </div>
      {choiceRow("settings.density", "density", DENSITIES, DENSITY_KEYS, appearance.density, (value) =>
        update({ density: value as Density }),
      )}
      {choiceRow("settings.cornerRadius", "radius", CORNER_RADII, RADIUS_KEYS, appearance.corner_radius, (value) =>
        update({ corner_radius: value as CornerRadius }),
      )}
      {choiceRow("settings.animations", "animations", ANIMATION_LEVELS, ANIMATION_KEYS, appearance.animations, (value) =>
        update({ animations: value as AnimationLevel }),
      )}
      <p className="adp-note">{t("settings.animationsNote")}</p>
    </section>
  );
}
