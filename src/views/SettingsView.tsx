import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import SearchBox from "../components/SearchBox";
import { errorText } from "../services/errors";
import type { AppSettings } from "../services/settings";
import { exportSettings, importSettings, isoDate } from "../services/settingsFile";
import AppearanceSettings from "./settings/AppearanceSettings";
import GeneralSettings from "./settings/GeneralSettings";
import LayoutSettings from "./settings/LayoutSettings";
import OpeningFilesSettings from "./settings/OpeningFilesSettings";
import ThemeSettings from "./settings/ThemeSettings";
import VersionsSettings from "./settings/VersionsSettings";
import {
  SETTINGS_SECTIONS,
  resetAllSettings,
  resetSection,
  sectionMatches,
  type SettingsSection,
  type SettingsSectionId,
} from "./settings/sections";
import ViewsSettings from "./settings/ViewsSettings";

export interface SettingsViewProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: () => void;
  /** Opens a help page by slug (the sections' own "?" buttons). */
  onOpenHelpPage: (slug: string) => void;
}

interface UndoState {
  previous: AppSettings;
  message: string;
}

export default function SettingsView({ settings, onApply, onOpenHelp, onOpenHelpPage }: SettingsViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<AppSettings | null>(null);

  const applyWithUndo = (next: AppSettings, undoMessage: string) => {
    setMessage(null);
    setUndo({ previous: settings, message: undoMessage });
    onApply(next);
  };

  const showMessage = (text: string) => {
    setUndo(null);
    setMessage(text);
  };

  const exportToFile = async () => {
    try {
      const path = await exportSettings(
        t("settings.exportTitle"),
        t("settings.exportFileName", { date: isoDate(new Date()) }),
        t("settings.fileFilter"),
      );
      if (path !== null) showMessage(t("settings.exported", { path }));
    } catch (error) {
      showMessage(errorText(t, error, "settingsFile"));
    }
  };

  const importFromFile = async () => {
    try {
      const imported = await importSettings(t("settings.importTitle"), t("settings.fileFilter"));
      if (imported !== null) setPendingImport(imported);
    } catch (error) {
      showMessage(errorText(t, error, "settingsFile"));
    }
  };

  const shown = SETTINGS_SECTIONS.filter((section) => sectionMatches(section, query, (key) => t(key)));

  const scrollToSection = (id: SettingsSectionId) => {
    document.getElementById(`adp-settings-${id}`)?.scrollIntoView?.({ block: "start" });
  };

  const sectionBody = (section: SettingsSection) => {
    if (section.id === "general") return <GeneralSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    if (section.id === "appearance") return <AppearanceSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    if (section.id === "theme") return <ThemeSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    if (section.id === "layout") {
      return (
        <LayoutSettings
          layout={settings.layout}
          detailsPane={settings.explorer.details_pane}
          onChange={(layout, detailsPane) =>
            onApply({ ...settings, layout, explorer: { ...settings.explorer, details_pane: detailsPane } })
          }
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "views") {
      return (
        <ViewsSettings
          explorer={settings.explorer}
          onChange={(explorer) => onApply({ ...settings, explorer })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "openingFiles") {
      return (
        <OpeningFilesSettings
          open={settings.open}
          onChange={(open) => onApply({ ...settings, open })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    return <VersionsSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
  };

  return (
    <div className="adp-settings">
      <div className="adp-view-header">
        <h2 className="adp-heading">{t("settings.title")}</h2>
        <HelpButton onOpenHelp={onOpenHelp} />
      </div>
      {undo ? (
        <div className="adp-settings-notice" role="status">
          <span>{undo.message}</span>
          <Button
            variant="subtle"
            onClick={() => {
              onApply(undo.previous);
              setUndo(null);
            }}
          >
            {t("common.undo")}
          </Button>
          <Button variant="subtle" onClick={() => setUndo(null)}>
            {t("common.dismiss")}
          </Button>
        </div>
      ) : null}
      {!undo && message !== null ? (
        <div className="adp-settings-notice" role="status">
          <span>{message}</span>
          <Button variant="subtle" onClick={() => setMessage(null)}>
            {t("common.dismiss")}
          </Button>
        </div>
      ) : null}
      <div className="adp-settings-search">
        <SearchBox value={query} onChange={setQuery} placeholder={t("settings.search")} />
      </div>
      <div className="adp-settings-body">
        <nav className="adp-settings-nav" aria-label={t("settings.sections")}>
          {shown.map((section) => (
            <button
              key={section.id}
              type="button"
              className="adp-settings-nav-item"
              onClick={() => scrollToSection(section.id)}
            >
              {t(section.titleKey)}
            </button>
          ))}
        </nav>
        <div className="adp-settings-content">
          {shown.map((section) => (
            <div key={section.id} className="adp-settings-block" id={`adp-settings-${section.id}`}>
              {sectionBody(section)}
              <div className="adp-settings-block-actions">
                <Button
                  variant="subtle"
                  onClick={() =>
                    applyWithUndo(
                      resetSection(section.id, settings),
                      t("settings.sectionWasReset", { name: t(section.titleKey) }),
                    )
                  }
                >
                  {t("settings.resetSection")}
                </Button>
              </div>
            </div>
          ))}
          {shown.length === 0 ? <p className="adp-empty-note">{t("settings.noResults")}</p> : null}
        </div>
      </div>
      <div className="adp-settings-footer">
        <h3 className="adp-heading">{t("settings.backup")}</h3>
        <div className="adp-button-row">
          <Button onClick={() => void exportToFile()}>{t("settings.export")}</Button>
          <Button onClick={() => void importFromFile()}>{t("settings.import")}</Button>
        </div>
        <Button onClick={() => setConfirmReset(true)}>{t("settings.resetAll")}</Button>
        <p className="adp-note">{t("settings.persistNote")}</p>
      </div>
      {confirmReset ? (
        <Dialog title={t("settings.resetAllTitle")} onClose={() => setConfirmReset(false)}>
          <p>{t("settings.resetAllBody")}</p>
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              onClick={() => {
                applyWithUndo(resetAllSettings(settings), t("settings.allWereReset"));
                setConfirmReset(false);
              }}
            >
              {t("settings.resetConfirm")}
            </Button>
            <Button onClick={() => setConfirmReset(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
      {pendingImport ? (
        <Dialog title={t("settings.importConfirmTitle")} onClose={() => setPendingImport(null)}>
          <p>{t("settings.importConfirmBody")}</p>
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              onClick={() => {
                applyWithUndo(pendingImport, t("settings.imported"));
                setPendingImport(null);
              }}
            >
              {t("settings.importConfirm")}
            </Button>
            <Button onClick={() => setPendingImport(null)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
