/** Settings > Theme (Step 05d): the mode, the theme cards and the accent. */
import { useTranslation } from "react-i18next";
import { THEMES, type ThemeScheme } from "../../appearance/themes";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import type { AppSettings, DarkThemeId, LightThemeId, ThemeMode } from "../../services/settings";

export interface ThemeSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

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

export default function ThemeSettings({ settings, onApply, onOpenHelp }: ThemeSettingsProps) {
  const { t } = useTranslation();
  const chosen = (scheme: ThemeScheme) =>
    scheme === "light" ? settings.theme.light_theme : settings.theme.dark_theme;

  const chooseTheme = (scheme: ThemeScheme, id: string) => {
    const theme =
      scheme === "light"
        ? { ...settings.theme, light_theme: id as LightThemeId }
        : { ...settings.theme, dark_theme: id as DarkThemeId };
    onApply({ ...settings, theme });
  };

  const cards = (scheme: ThemeScheme, labelKey: string) => (
    <div className="adp-setting-row">
      <span className="adp-setting-label">{t(labelKey)}</span>
      <div className="adp-theme-cards">
        {THEMES.filter((entry) => entry.scheme === scheme).map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="adp-theme-card"
            aria-pressed={chosen(scheme) === entry.id}
            data-theme-id={entry.id}
            onClick={() => chooseTheme(scheme, entry.id)}
          >
            <div className="adp-theme-preview" data-theme-preview={entry.id} aria-hidden="true">
              <span className="adp-theme-preview-bar" />
              <span className="adp-theme-preview-side" />
              <span className="adp-theme-preview-main">
                <span className="adp-theme-preview-line" />
                <span className="adp-theme-preview-line adp-theme-preview-line--short" />
                <span className="adp-theme-preview-row" />
                <span className="adp-theme-preview-accent" />
              </span>
            </div>
            <span className="adp-theme-card-name">{t(entry.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="adp-settings-section" aria-labelledby="adp-theme-title">
      <div className="adp-view-header">
        <h3 id="adp-theme-title" className="adp-heading">
          {t("settings.theme")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("themes-and-appearance")} />
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.theme")}</span>
        <div className="adp-button-row">
          {MODES.map((mode) => (
            <Button
              key={mode.id}
              variant={settings.theme.mode === mode.id ? "primary" : "default"}
              aria-pressed={settings.theme.mode === mode.id}
              data-theme-mode={mode.id as ThemeMode}
              onClick={() => onApply({ ...settings, theme: { ...settings.theme, mode: mode.id } })}
            >
              {t(mode.labelKey)}
            </Button>
          ))}
        </div>
      </div>
      {cards("light", "settings.lightTheme")}
      {cards("dark", "settings.darkTheme")}
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.accent")}</span>
        <div className="adp-button-row">
          {ACCENTS.map((accent) => (
            <Button
              key={accent.id}
              variant={settings.theme.accent_source === accent.id ? "primary" : "default"}
              aria-pressed={settings.theme.accent_source === accent.id}
              onClick={() => onApply({ ...settings, theme: { ...settings.theme, accent_source: accent.id } })}
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
                onChange={(event) =>
                  onApply({ ...settings, theme: { ...settings.theme, accent_custom: event.target.value } })
                }
              />
            </label>
          ) : null}
        </div>
      </div>
    </section>
  );
}
