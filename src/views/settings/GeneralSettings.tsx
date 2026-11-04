/** Settings > General (Step 05d): language, pasted images and the image
 * editor defaults added by Step 18a (schema 48). */
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Slider from "../../components/Slider";
import Switch from "../../components/Switch";
import type { AppSettings, LanguageSetting } from "../../services/settings";

export interface GeneralSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

const LANGUAGES: { id: LanguageSetting; labelKey: string }[] = [
  { id: "en", labelKey: "settings.languageEnglish" },
  { id: "es", labelKey: "settings.languageSpanish" },
  { id: "pseudo", labelKey: "settings.languagePseudo" },
];

export default function GeneralSettings({ settings, onApply, onOpenHelp }: GeneralSettingsProps) {
  const { t } = useTranslation();
  const imageEditor = settings.image_editor;
  const updateImageEditor = (patch: Partial<AppSettings["image_editor"]>) =>
    onApply({ ...settings, image_editor: { ...imageEditor, ...patch } });

  return (
    <section className="adp-settings-section" aria-labelledby="adp-general-title">
      <div className="adp-view-header">
        <h3 id="adp-general-title" className="adp-heading">
          {t("settings.general")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("changing-language-and-theme")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.language")}</span>
        <div className="adp-button-row">
          {LANGUAGES.map((lang) => (
            <Button
              key={lang.id}
              variant={settings.language === lang.id ? "primary" : "default"}
              aria-pressed={settings.language === lang.id}
              onClick={() => onApply({ ...settings, language: lang.id })}
            >
              {t(lang.labelKey)}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.pastedImages")}</span>
        <div className="adp-button-row">
          {(["png", "jpg"] as const).map((format) => (
            <Button
              key={format}
              variant={settings.files.paste_image_format === format ? "primary" : "default"}
              aria-pressed={settings.files.paste_image_format === format}
              onClick={() => onApply({ ...settings, files: { paste_image_format: format } })}
            >
              {t(format === "png" ? "settings.formatPng" : "settings.formatJpg")}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-settings-block" data-adp-image-editor-settings="true">
        <h4 className="adp-heading">{t("imageEdit.properties")}</h4>
        <div className="adp-setting-row">
          <Switch
            checked={imageEditor.advanced}
            label={t("layers.advanced")}
            onChange={(advanced) => updateImageEditor({ advanced })}
          />
        </div>
        <div className="adp-setting-row">
          <Switch
            checked={imageEditor.show_history}
            label={t("layers.history")}
            onChange={(show_history) => updateImageEditor({ show_history })}
          />
        </div>
        <div className="adp-setting-row">
          <span className="adp-setting-label">{t("selection.tolerance")}</span>
          <Slider
            value={imageEditor.selection_tolerance}
            min={0}
            max={100}
            label={t("selection.tolerance")}
            onChange={(selection_tolerance) => updateImageEditor({ selection_tolerance })}
          />
        </div>
      </div>
    </section>
  );
}
