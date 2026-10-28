import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import type { AppSettings, LanguageSetting } from "../services/settings";

export interface SettingsViewProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: () => void;
}

const LANGUAGES: { id: LanguageSetting; labelKey: string }[] = [
  { id: "en", labelKey: "settings.languageEnglish" },
  { id: "es", labelKey: "settings.languageSpanish" },
  { id: "pseudo", labelKey: "settings.languagePseudo" },
];
const MODES = [
  { id: "system", labelKey: "settings.themeSystem" },
  { id: "light", labelKey: "settings.themeLight" },
  { id: "dark", labelKey: "settings.themeDark" },
] as const;
const ACCENTS = [
  { id: "design", labelKey: "settings.accentDesign" },
  { id: "windows", labelKey: "settings.accentWindows" },
  { id: "custom", labelKey: "settings.accentCustom" },
] as const;

export default function SettingsView({ settings, onApply, onOpenHelp }: SettingsViewProps) {
  const { t } = useTranslation();
  const patch = (partial: Partial<AppSettings>) => onApply({ ...settings, ...partial });
  const patchTheme = (partial: Partial<AppSettings["theme"]>) =>
    onApply({ ...settings, theme: { ...settings.theme, ...partial } });

  return (
    <div className="adp-settings">
      <div className="adp-view-header">
        <h2 className="adp-heading">{t("settings.title")}</h2>
        <HelpButton onOpenHelp={onOpenHelp} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.language")}</span>
        <div className="adp-button-row">
          {LANGUAGES.map((lang) => (
            <Button
              key={lang.id}
              variant={settings.language === lang.id ? "primary" : "default"}
              aria-pressed={settings.language === lang.id}
              onClick={() => patch({ language: lang.id })}
            >
              {t(lang.labelKey)}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.theme")}</span>
        <div className="adp-button-row">
          {MODES.map((mode) => (
            <Button
              key={mode.id}
              variant={settings.theme.mode === mode.id ? "primary" : "default"}
              aria-pressed={settings.theme.mode === mode.id}
              onClick={() => patchTheme({ mode: mode.id })}
            >
              {t(mode.labelKey)}
            </Button>
          ))}
        </div>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.accent")}</span>
        <div className="adp-button-row">
          {ACCENTS.map((accent) => (
            <Button
              key={accent.id}
              variant={settings.theme.accent_source === accent.id ? "primary" : "default"}
              aria-pressed={settings.theme.accent_source === accent.id}
              onClick={() => patchTheme({ accent_source: accent.id })}
            >
              {t(accent.labelKey)}
            </Button>
          ))}
          {settings.theme.accent_source === "custom" ? (
            <label className="adp-button-row">
              <span>{t("settings.customColor")}</span>
              <input
                className="adp-color-input"
                type="color"
                value={settings.theme.accent_custom ?? "#0067C0"}
                aria-label={t("settings.customColor")}
                onChange={(event) => patchTheme({ accent_custom: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      </div>
      <p className="adp-note">{t("settings.persistNote")}</p>
    </div>
  );
}
