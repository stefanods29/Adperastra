import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import type { AppSettings } from "../services/settings";
import AppearanceSettings from "./settings/AppearanceSettings";
import GeneralSettings from "./settings/GeneralSettings";
import LayoutSettings from "./settings/LayoutSettings";
import OpeningFilesSettings from "./settings/OpeningFilesSettings";
import ThemeSettings from "./settings/ThemeSettings";
import ViewsSettings from "./settings/ViewsSettings";

export interface SettingsViewProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: () => void;
  /** Opens a help page by slug (the sections' own "?" buttons). */
  onOpenHelpPage: (slug: string) => void;
}

export default function SettingsView({ settings, onApply, onOpenHelp, onOpenHelpPage }: SettingsViewProps) {
  const { t } = useTranslation();

  return (
    <div className="adp-settings">
      <div className="adp-view-header">
        <h2 className="adp-heading">{t("settings.title")}</h2>
        <HelpButton onOpenHelp={onOpenHelp} />
      </div>
      <GeneralSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />
      <AppearanceSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />
      <ThemeSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />
      <LayoutSettings
        layout={settings.layout}
        detailsPane={settings.explorer.details_pane}
        onChange={(layout, detailsPane) =>
          onApply({ ...settings, layout, explorer: { ...settings.explorer, details_pane: detailsPane } })
        }
        onOpenHelp={onOpenHelpPage}
      />
      <ViewsSettings explorer={settings.explorer} onChange={(explorer) => onApply({ ...settings, explorer })} onOpenHelp={onOpenHelpPage} />
      <OpeningFilesSettings open={settings.open} onChange={(open) => onApply({ ...settings, open })} onOpenHelp={onOpenHelpPage} />
      <p className="adp-note">{t("settings.persistNote")}</p>
    </div>
  );
}
