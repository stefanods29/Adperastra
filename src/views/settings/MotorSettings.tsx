/** Settings > Accessibility > Motor and dexterity (Step 10f T5). */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { AccessibilitySettings } from "../../services/accessibility";

export interface MotorSettingsProps {
  value: AccessibilitySettings;
  onChange: (next: AccessibilitySettings) => void;
  onOpenHelp: (slug: string) => void;
  /** Runs the `app.pickSelection` command flow. */
  onPick?: () => void;
  onCancelPick?: () => void;
  picked?: boolean;
}

export default function MotorSettings({
  value,
  onChange,
  onOpenHelp,
  onPick,
  onCancelPick,
  picked = false,
}: MotorSettingsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<AccessibilitySettings>) => onChange({ ...value, ...patch });

  return (
    <section className="adp-settings-section adp-accessibility-section" aria-labelledby="adp-motor-title">
      <div className="adp-view-header">
        <h3 id="adp-motor-title" className="adp-heading">
          {t("accessibility.motor")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("accessibility-motor")} />
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
        <label className="adp-setting-label" htmlFor="adp-double-click">
          {t("accessibility.doubleClick")}
        </label>
        <input
          id="adp-double-click"
          type="number"
          min={100}
          max={1000}
          step={50}
          value={value.double_click_ms ?? ""}
          placeholder={t("accessibility.system")}
          onChange={(event) =>
            update({
              double_click_ms: event.target.value === "" ? undefined : Number(event.target.value),
            })
          }
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-hover-delay">
          {t("accessibility.hover")}
        </label>
        <input
          id="adp-hover-delay"
          type="number"
          min={200}
          max={2000}
          step={50}
          value={value.hover_ms}
          onChange={(event) => update({ hover_ms: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-drag-distance">
          {t("accessibility.drag")}
        </label>
        <input
          id="adp-drag-distance"
          type="number"
          min={2}
          max={32}
          step={1}
          value={value.drag_threshold_px}
          onChange={(event) => update({ drag_threshold_px: Number(event.target.value) })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.pick")}</span>
        <div className="adp-button-row">
          <Button disabled={!onPick || picked} onClick={onPick}>
            {t("accessibility.pick")}
          </Button>
          <Button disabled={!onCancelPick || !picked} onClick={onCancelPick}>
            {t("accessibility.cancelPick")}
          </Button>
        </div>
      </div>
    </section>
  );
}
