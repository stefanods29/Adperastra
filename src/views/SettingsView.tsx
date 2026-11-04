import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import SearchBox from "../components/SearchBox";
import Switch from "../components/Switch";
import { errorText } from "../services/errors";
import {
  isTauriRuntime,
  SHELF_HEIGHT_DEFAULT,
  SHELF_SIDES,
  SHELF_WIDTH_DEFAULT,
  type AppSettings,
  type ShelfSide,
} from "../services/settings";
import { exportSettings, importSettings, isoDate } from "../services/settingsFile";
import { listReadVoices, type ReadVoice } from "../services/readAloud";
import { isBuiltinMapId, type KeyboardMap, type ShortcutBinding } from "../keyboard/types";
import { validateKeyboardMap } from "../services/keyboardMaps";
import {
  validateToolbarCustomSettings,
  type ToolbarCustomSettings,
  type ToolbarDescriptor,
} from "../services/commandLayout";
import { TOOLBAR_DESCRIPTORS } from "../layout/toolbarDescriptors";
import type { CustomThemeSummary } from "../services/customThemes";
import WallpaperAccentPicker from "../appearance/WallpaperAccentPicker";
import AppearanceSettings from "./settings/AppearanceSettings";
import DayNightSettings from "./settings/DayNightSettings";
import CognitiveSettings from "./settings/CognitiveSettings";
import DateSizeSettings from "./settings/DateSizeSettings";
import ClipboardHistorySettings from "./settings/ClipboardHistorySettings";
import GeneralSettings from "./settings/GeneralSettings";
import HearingSettings from "./settings/HearingSettings";
import LayoutSettings from "./settings/LayoutSettings";
import LockedFoldersSettings from "./settings/LockedFoldersSettings";
import MotionSettings from "./settings/MotionSettings";
import MotorSettings from "./settings/MotorSettings";
import OpeningFilesSettings from "./settings/OpeningFilesSettings";
import RecoverySettingsSection from "./settings/RecoverySettingsSection";
import ProfilesSection from "../preferences/ProfilesSection";
import TabOptionsSettings, { BehaviorSettings } from "./settings/TabOptionsSettings";
import KeyboardSettings from "./settings/KeyboardSettings";
import ThemeSettings from "./settings/ThemeSettings";
import ToolbarSettings from "./settings/ToolbarSettings";
import VersionsSettings from "./settings/VersionsSettings";
import BackgroundWorkSettings from "./settings/BackgroundWorkSettings";
import AppStorageSettings from "./settings/AppStorageSettings";
import LocalAiSettings from "./settings/LocalAiSettings";
import UpdateSettings from "./settings/UpdateSettings";
import {
  AiSearchSettingsBody,
  AssistantSettingsBody,
  StartupResidentSettingsBody,
  WindowsIntegrationSettingsBody,
} from "./settings/SettingsBodies";
import VisionSettings from "./settings/VisionSettings";
import {
  SETTINGS_SECTIONS,
  resetAllSettings,
  resetSection,
  sectionMatches,
  type SettingsSection,
  type SettingsSectionId,
} from "./settings/sections";
import ViewsSettings from "./settings/ViewsSettings";
import {
  HomeSettingsBody,
  MenuSettingsBody,
  NavigationSettingsBody,
  SetupsSettingsBody,
  StatusSettingsBody,
} from "./settings/ShellCustomizationSettings";
import type { Command } from "../commands/registry";

export interface SettingsViewProps {
  active?: boolean;
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: () => void;
  /** Opens a help page by slug (the sections' own "?" buttons). */
  onOpenHelpPage: (slug: string) => void;
  /** Windows snapshot for the accessibility sections (Step 10f). */
  systemReducedMotion?: boolean;
  forcedColors?: boolean;
  /** Saved custom themes for the day/night pickers (Step 10a). */
  customThemes?: readonly CustomThemeSummary[];
  /** Opens the custom theme editor (Step 10a). */
  onEditTheme?: () => void;
  /** Runs the full dirty-safe profile switch. Omit while the host has no
   * active-job/sensitive-lock guard: switching then fails closed. */
  onSwitchProfile?: (targetId: string) => Promise<boolean>;
  /** Optional folder picker for the portable-copy destination. */
  onChoosePortableDestination?: () => Promise<string | null>;
  /** Registered bars the toolbar editor may customize (Step 10b E1). */
  toolbarDescriptors?: readonly ToolbarDescriptor[];
  /** Localized command labels by command id, from the live registry. */
  commandLabels?: Readonly<Record<string, string>>;
  /** Registered command defaults (Windows preset) for the keyboard editor. */
  keyboardDefaults?: readonly ShortcutBinding[];
  /** One undoable history entry each; defaults change settings only. */
  onApplyToolbarCustom?: (value: ToolbarCustomSettings) => Promise<void>;
  onApplyKeyboardCustom?: (map: KeyboardMap) => Promise<void>;
  /** Live registered commands for the Step 10e menu editor preview. */
  commands?: readonly Command[];
  /** Accessibility hosts (Step 10f T5). A missing host keeps the button
   * disabled instead of showing an action that cannot run. */
  onPickSelection?: () => void;
  onCancelPick?: () => void;
  pickActive?: boolean;
  onExplain?: () => void;
  onFocusLayout?: () => void;
  focusLayoutActive?: boolean;
}

interface UndoState {
  previous: AppSettings;
  message: string;
}

/** The active window, chrome and sidebar colours the accent must survive. */
function accentBackgrounds(): string[] {
  const fallback = ["#FFFFFF", "#F3F3F3", "#202020"];
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
  const style = getComputedStyle(document.documentElement);
  const colors = [
    "--adp-color-surface-window",
    "--adp-color-surface-chrome",
    "--adp-color-surface-sidebar",
  ]
    .map((name) => style.getPropertyValue(name).trim())
    .filter((value) => /^#[0-9a-f]{6}$/i.test(value));
  return colors.length > 0 ? colors : fallback;
}

export default function SettingsView({
  settings,
  onApply,
  onOpenHelp,
  onOpenHelpPage,
  systemReducedMotion = false,
  forcedColors = false,
  customThemes = [],
  onEditTheme,
  onSwitchProfile,
  onChoosePortableDestination,
  toolbarDescriptors = TOOLBAR_DESCRIPTORS,
  commandLabels,
  keyboardDefaults = [],
  onApplyToolbarCustom,
  onApplyKeyboardCustom,
  commands = [],
  onPickSelection,
  onCancelPick,
  pickActive = false,
  onExplain,
  onFocusLayout,
  focusLayoutActive = false,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<AppSettings | null>(null);
  // Installed Windows voices for the Vision section (Step 10f): loaded once by
  // the Settings host, never inside the section component. A failure leaves
  // the list empty and the stored voice untouched.
  const [readVoices, setReadVoices] = useState<readonly ReadVoice[]>([]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void listReadVoices()
      .then((voices) => {
        if (!cancelled) setReadVoices(voices);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Without an app-level undoable callback, the editors still apply the
  // validated data; the history record stays with the coordinator.
  const applyToolbarCustom = async (value: ToolbarCustomSettings) => {
    if (onApplyToolbarCustom) {
      await onApplyToolbarCustom(value);
      return;
    }
    onApply({ ...settings, toolbar_custom: validateToolbarCustomSettings(value) });
  };

  const applyKeyboardCustom = async (map: KeyboardMap) => {
    if (onApplyKeyboardCustom) {
      await onApplyKeyboardCustom(map);
      return;
    }
    const validated = validateKeyboardMap(map);
    const current = settings.keyboard_custom;
    const keyboard_custom = isBuiltinMapId(validated.id)
      ? { ...current, active_map: validated.id }
      : {
          ...current,
          active_map: validated.id,
          custom_maps: [...current.custom_maps.filter((entry) => entry.id !== validated.id), validated],
        };
    onApply({ ...settings, keyboard_custom });
  };

  const sectionBody = (section: SettingsSection) => {
    if (section.id === "general") return <GeneralSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    if (section.id === "clipboardHistory") {
      return (
        <ClipboardHistorySettings
          value={settings.clipboard_history}
          onChange={(clipboard_history) => onApply({ ...settings, clipboard_history })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "appearance") return <AppearanceSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    if (section.id === "theme") {
      return (
        <ThemeSettings
          settings={settings}
          onApply={onApply}
          onOpenHelp={onOpenHelpPage}
          onEditTheme={onEditTheme}
        />
      );
    }
    if (section.id === "dayNight") {
      return (
        <DayNightSettings
          value={settings.theme_custom}
          customThemes={customThemes}
          onChange={(theme_custom) => onApply({ ...settings, theme_custom })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "accents") {
      return (
        <WallpaperAccentPicker
          theme={settings.theme}
          value={settings.theme_custom}
          backgrounds={accentBackgrounds()}
          onChangeTheme={(theme) => onApply({ ...settings, theme })}
          onChange={(theme_custom) => onApply({ ...settings, theme_custom })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
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
    if (section.id === "toolbars") {
      return (
        <ToolbarSettings
          descriptors={toolbarDescriptors}
          value={settings.toolbar_custom}
          labels={commandLabels}
          onApply={applyToolbarCustom}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "menus") {
      return (
        <MenuSettingsBody
          settings={settings}
          onApply={onApply}
          onOpenHelp={onOpenHelpPage}
          commands={commands}
        />
      );
    }
    if (section.id === "home") {
      return <HomeSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "navigation") {
      return <NavigationSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "status") {
      return <StatusSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "keyboard") {
      return (
        <KeyboardSettings
          keyboard={settings.keyboard_custom}
          defaults={keyboardDefaults}
          labels={commandLabels}
          onApplyMap={applyKeyboardCustom}
          onBareNavigationChange={(allow_bare_navigation) =>
            onApply({
              ...settings,
              keyboard_custom: { ...settings.keyboard_custom, allow_bare_navigation },
            })
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
    if (section.id === "tabs") {
      return <TabOptionsSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "behavior") {
      return (
        <BehaviorSettings
          behavior={settings.behavior}
          onChange={(behavior) => onApply({ ...settings, behavior })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "formats") {
      return <DateSizeSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
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
    if (section.id === "profiles") {
      return (
        <ProfilesSection
          switchTo={onSwitchProfile}
          onOpenHelp={onOpenHelpPage}
          onChoosePortableDestination={onChoosePortableDestination}
        />
      );
    }
    if (section.id === "versions") {
      return <VersionsSettings settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "recovery") {
      return (
        <RecoverySettingsSection
          recovery={settings.recovery}
          onChange={(recovery) => onApply({ ...settings, recovery })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "locked") {
      return (
        <LockedFoldersSettings
          settings={settings.locked}
          onChange={(locked) => onApply({ ...settings, locked })}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "accessibility") {
      const accessibility = settings.accessibility;
      const update = (next: AppSettings["accessibility"]) => onApply({ ...settings, accessibility: next });
      return (
        <>
          <VisionSettings
            value={accessibility}
            onChange={update}
            onOpenHelp={onOpenHelpPage}
            forcedColors={forcedColors}
            voices={readVoices}
          />
          <HearingSettings
            value={accessibility}
            onChange={update}
            onOpenHelp={onOpenHelpPage}
            onOpenCaptionSetup={() => scrollToSection("appStorage")}
          />
          <MotorSettings
            value={accessibility}
            onChange={update}
            onOpenHelp={onOpenHelpPage}
            onPick={onPickSelection}
            onCancelPick={onCancelPick}
            picked={pickActive}
          />
          <CognitiveSettings
            value={accessibility}
            onChange={update}
            onOpenHelp={onOpenHelpPage}
            onExplain={onExplain ?? (() => onOpenHelpPage("accessibility-cognitive"))}
          />
          <MotionSettings
            value={accessibility}
            onChange={update}
            onOpenHelp={onOpenHelpPage}
            systemReducedMotion={systemReducedMotion}
            onFocusLayout={onFocusLayout}
            focusLayoutActive={focusLayoutActive}
          />
        </>
      );
    }
    if (section.id === "shelf") {
      return (
        <section className="adp-settings-section" aria-labelledby="adp-shelf-settings-title">
          <div className="adp-settings-section-header">
            <h3 id="adp-shelf-settings-title">{t("settings.shelf")}</h3>
            <HelpButton onOpenHelp={() => onOpenHelpPage("the-shelf")} />
          </div>
          <div className="adp-setting-row">
            <Switch
              checked={settings.shelf.visible}
              label={t("settings.shelfVisible")}
              onChange={(visible) => onApply({ ...settings, shelf: { ...settings.shelf, visible } })}
            />
          </div>
          <div className="adp-setting-row">
            <label className="adp-setting-label" htmlFor="adp-shelf-side">
              {t("settings.shelfSide")}
            </label>
            <select
              id="adp-shelf-side"
              className="adp-defaultapps-select"
              value={settings.shelf.side}
              onChange={(event) => {
                const side = event.target.value as ShelfSide;
                onApply({
                  ...settings,
                  shelf: {
                    ...settings.shelf,
                    side,
                    size: side === "bottom" ? SHELF_HEIGHT_DEFAULT : SHELF_WIDTH_DEFAULT,
                  },
                });
              }}
            >
              {SHELF_SIDES.map((side) => (
                <option key={side} value={side}>
                  {t(
                    side === "bottom"
                      ? "accessibility.bottom"
                      : side === "left"
                        ? "keys.left"
                        : "keys.right",
                  )}
                </option>
              ))}
            </select>
          </div>
        </section>
      );
    }
    if (section.id === "backgroundWork") {
      return (
        <BackgroundWorkSettings
          controls={settings.background}
          onChange={(patch) => onApply({ ...settings, background: { ...settings.background, ...patch } })}
          cacheLimit={settings.cache.max_mb}
          ocrLanguage={settings.ocr.language}
          onCacheLimitChange={(max_mb) =>
            onApply({ ...settings, cache: { ...settings.cache, max_mb } })
          }
          onOcrLanguageChange={(language) =>
            onApply({ ...settings, ocr: { ...settings.ocr, language } })
          }
          folderSizes={settings.folder_sizes}
          onFolderSizesChange={(folder_sizes) =>
            onApply({ ...settings, folder_sizes })
          }
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "startup") {
      return <StartupResidentSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "updates") {
      return (
        <UpdateSettings
          enabled={settings.updates.enabled}
          onEnabledChange={(enabled) =>
            onApply({ ...settings, updates: { ...settings.updates, enabled } })
          }
          onChecked={(info) =>
            onApply({
              ...settings,
              updates: { ...settings.updates, last_check_unix: info.checked_unix },
            })
          }
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "windowsIntegration") {
      return (
        <WindowsIntegrationSettingsBody
          settings={settings}
          onApply={onApply}
          onOpenHelp={onOpenHelpPage}
        />
      );
    }
    if (section.id === "aiSearch") {
      return <AiSearchSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "assistant") {
      return <AssistantSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "localAi") {
      return (
        <LocalAiSettings
          settings={settings}
          onApply={onApply}
          onOpenHelp={onOpenHelpPage}
          onOpenStorage={() => scrollToSection("appStorage")}
        />
      );
    }
    if (section.id === "appStorage") {
      return <AppStorageSettings onOpenHelp={onOpenHelpPage} />;
    }
    if (section.id === "setups") {
      return <SetupsSettingsBody settings={settings} onApply={onApply} onOpenHelp={onOpenHelpPage} />;
    }
    return null;
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
              {section.resettable === false ? null : (
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
              )}
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
