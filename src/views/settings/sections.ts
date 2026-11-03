/** The Settings page's sections (Step 05d): search words and resets. Pure. */
import { defaultSettings, type AppSettings } from "../../services/settings";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "theme"
  | "layout"
  | "views"
  | "openingFiles"
  | "versions"
  | "background";

export interface SettingsSection {
  id: SettingsSectionId;
  titleKey: string;
  helpSlug: string;
  /** Labels inside the section that the search also matches. */
  keywordKeys: readonly string[];
}

/** Every section, in the order the page shows them. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    titleKey: "settings.general",
    helpSlug: "changing-language-and-theme",
    keywordKeys: [
      "settings.language",
      "settings.languageEnglish",
      "settings.languageSpanish",
      "settings.pastedImages",
    ],
  },
  {
    id: "appearance",
    titleKey: "settings.appearance",
    helpSlug: "themes-and-appearance",
    keywordKeys: ["settings.uiScale", "settings.density", "settings.cornerRadius", "settings.animations"],
  },
  {
    id: "theme",
    titleKey: "settings.theme",
    helpSlug: "themes-and-appearance",
    keywordKeys: [
      "settings.lightTheme",
      "settings.darkTheme",
      "settings.accent",
      "settings.customColor",
      "themes.light",
      "themes.bright",
      "themes.paper",
      "themes.dark",
      "themes.amoled",
      "themes.highContrast",
    ],
  },
  {
    id: "layout",
    titleKey: "settings.layout",
    helpSlug: "moving-toolbars-and-panels",
    keywordKeys: [
      "layout.toolbarPosition",
      "layout.toolbarStyle",
      "layout.preset",
      "settings.tabBarPosition",
      "settings.navPane",
      "settings.detailsPanePlace",
    ],
  },
  {
    id: "views",
    titleKey: "settings.views",
    helpSlug: "view-modes",
    keywordKeys: [
      "settings.viewsDefault",
      "settings.viewsRemember",
      "settings.viewsMenu",
      "settings.viewsColumns",
      "settings.columnWidth",
      "settings.columnPreview",
    ],
  },
  {
    id: "openingFiles",
    titleKey: "settings.openingFiles",
    helpSlug: "default-apps",
    keywordKeys: ["settings.protectedView", "settings.defaultApps"],
  },
  {
    id: "versions",
    titleKey: "settings.versions",
    helpSlug: "version-history",
    keywordKeys: [
      "settings.versionsEnabled",
      "settings.versionsKeep",
      "settings.versionsMax",
      "settings.versionsDeleteAll",
    ],
  },
  {
    id: "background",
    titleKey: "settings.background",
    helpSlug: "background-work",
    keywordKeys: [
      "settings.backgroundEnabled",
      "settings.backgroundThumbnails",
      "settings.backgroundIdle",
      "settings.backgroundAc",
      "settings.backgroundPaused",
      "settings.cacheLimit",
    ],
  },
];

/** Case and accents ignored, for the search box. */
export function plainSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** An empty query matches every section; otherwise the title or a label must contain it. */
export function sectionMatches(
  section: SettingsSection,
  query: string,
  t: (key: string) => string,
): boolean {
  const plain = plainSearchText(query);
  if (plain === "") return true;
  if (plainSearchText(t(section.titleKey)).includes(plain)) return true;
  return section.keywordKeys.some((key) => plainSearchText(t(key)).includes(plain));
}

/** One copy of the settings, with only that section back to its defaults. */
export function resetSection(id: SettingsSectionId, settings: AppSettings): AppSettings {
  const defaults = defaultSettings();
  if (id === "general") return { ...settings, files: defaults.files };
  if (id === "appearance") return { ...settings, appearance: defaults.appearance };
  if (id === "theme") return { ...settings, theme: defaults.theme };
  if (id === "layout") {
    return { ...settings, layout: { ...defaults.layout, saved_presets: settings.layout.saved_presets } };
  }
  if (id === "views") {
    return {
      ...settings,
      explorer: {
        ...settings.explorer,
        view_mode: defaults.explorer.view_mode,
        remember_view_per_folder: defaults.explorer.remember_view_per_folder,
        view_mode_order: defaults.explorer.view_mode_order,
        hidden_view_modes: defaults.explorer.hidden_view_modes,
        column_width: defaults.explorer.column_width,
        column_preview: defaults.explorer.column_preview,
      },
    };
  }
  if (id === "openingFiles") return { ...settings, open: defaults.open };
  if (id === "versions") return { ...settings, versions: defaults.versions };
  return { ...settings, background: defaults.background, cache: defaults.cache };
}

/** Every setting back to its default, except the language and the saved layouts. */
export function resetAllSettings(settings: AppSettings): AppSettings {
  const defaults = defaultSettings();
  return {
    ...defaults,
    language: settings.language,
    layout: { ...defaults.layout, saved_presets: settings.layout.saved_presets },
  };
}
