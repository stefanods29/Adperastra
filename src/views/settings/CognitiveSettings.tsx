/** Settings > Accessibility > Cognitive and learning (Step 10f T5). */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { AccessibilitySettings } from "../../services/accessibility";

export interface CognitiveSettingsProps {
  value: AccessibilitySettings;
  onChange: (next: AccessibilitySettings) => void;
  onOpenHelp: (slug: string) => void;
  /** Opens the current feature's help page ("Explain this"). */
  onExplain?: () => void;
}

export default function CognitiveSettings({
  value,
  onChange,
  onOpenHelp,
  onExplain,
}: CognitiveSettingsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<AccessibilitySettings>) => onChange({ ...value, ...patch });

  return (
    <section
      className="adp-settings-section adp-accessibility-section"
      aria-labelledby="adp-cognitive-title"
    >
      <div className="adp-view-header">
        <h3 id="adp-cognitive-title" className="adp-heading">
          {t("accessibility.cognitive")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("accessibility-cognitive")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.simple")}</span>
        <Switch
          checked={value.simple_mode}
          label={t("accessibility.simple")}
          onChange={(checked) => update({ simple_mode: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.persistent")}</span>
        <Switch
          checked={value.persistent_toasts}
          label={t("accessibility.persistent")}
          onChange={(checked) => update({ persistent_toasts: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("accessibility.explain")}</span>
        <Button disabled={!onExplain} onClick={onExplain}>
          {t("accessibility.explain")}
        </Button>
      </div>
    </section>
  );
}
