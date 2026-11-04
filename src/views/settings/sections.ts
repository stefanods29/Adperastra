/** The Settings page's sections (Step 05d): search words and resets. Pure. */
import { defaultSettings, type AppSettings } from "../../services/settings";

export type SettingsSectionId =
  | "general"
  | "clipboardHistory"
  | "appearance"
  | "theme"
  | "dayNight"
  | "accents"
  | "layout"
  | "toolbars"
  | "menus"
  | "home"
  | "navigation"
  | "status"
  | "keyboard"
  | "views"
  | "tabs"
  | "behavior"
  | "formats"
  | "openingFiles"
  | "profiles"
  | "versions"
  | "recovery"
  | "locked"
  | "accessibility"
  | "shelf"
  | "backgroundWork"
  | "startup"
  | "updates"
  | "windowsIntegration"
  | "aiSearch"
  | "assistant"
  | "localAi"
  | "appStorage"
  | "setups";

export interface SettingsSection {
  id: SettingsSectionId;
  titleKey: string;
  helpSlug: string;
  /** Labels inside the section that the search also matches. */
  keywordKeys: readonly string[];
  /** False for pages whose actions are not backed by an app setting. */
  resettable?: boolean;
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
      "imageEdit.properties",
      "layers.advanced",
      "layers.history",
      "selection.tolerance",
    ],
  },
  {
    id: "clipboardHistory",
    titleKey: "clipboardHistory.title",
    helpSlug: "clipboard-history",
    keywordKeys: ["clipboardHistory.windows", "clipboardHistory.persist", "clipboardHistory.persistWarning"],
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
    id: "dayNight",
    titleKey: "themeSchedule.title",
    helpSlug: "day-and-night-themes",
    keywordKeys: [
      "themeSchedule.day",
      "themeSchedule.night",
      "themeSchedule.windows",
      "themeSchedule.clock",
      "themeSchedule.manual",
      "themeSchedule.dayStart",
      "themeSchedule.nightStart",
      "themeSchedule.override",
      "themeSchedule.sunUnavailable",
    ],
  },
  {
    id: "accents",
    titleKey: "themeAccent.title",
    helpSlug: "accent-colors",
    keywordKeys: [
      "themeAccent.wallpaper",
      "themeAccent.follow",
      "themeAccent.adjusted",
      "themeAccent.fallback",
      "themeAccent.typeExplorer",
      "themeAccent.typeExcel",
      "themeAccent.typeWord",
      "themeAccent.typePdf",
      "themeAccent.typeImage",
      "themeAccent.typePowerpoint",
      "themeAccent.typeGroup",
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
    id: "toolbars",
    titleKey: "toolbarCustom.title",
    helpSlug: "customizing-toolbars",
    keywordKeys: [
      "toolbarCustom.available",
      "toolbarCustom.current",
      "toolbarCustom.quick",
      "toolbarCustom.classic",
      "toolbarCustom.add",
      "toolbarCustom.remove",
      "toolbarCustom.up",
      "toolbarCustom.down",
      "toolbarCustom.reset",
    ],
  },
  {
    id: "menus",
    titleKey: "shellCustom.menus",
    helpSlug: "editing-menus",
    keywordKeys: [
      "shellCustom.targetFile",
      "shellCustom.targetFolder",
      "shellCustom.targetBackground",
      "shellCustom.preview",
      "shellCustom.submenu",
      "shellCustom.separator",
      "shellCustom.more",
      "shellCustom.hide",
      "shellCustom.show",
      "shellCustom.reset",
    ],
    resettable: false,
  },
  {
    id: "home",
    titleKey: "shellCustom.home",
    helpSlug: "customizing-home-navigation-status",
    keywordKeys: [
      "shellCustom.section",
      "shellCustom.count",
      "shellCustom.cardSize",
      "shellCustom.quickAccess",
      "shellCustom.recent",
      "shellCustom.favorites",
      "shellCustom.savedGroups",
    ],
    resettable: false,
  },
  {
    id: "navigation",
    titleKey: "shellCustom.navigation",
    helpSlug: "customizing-home-navigation-status",
    keywordKeys: [
      "shellCustom.rowHeight",
      "shellCustom.iconSize",
      "shellCustom.width",
      "shellCustom.autoCollapse",
      "shellCustom.displayName",
      "shellCustom.folderPath",
      "shellCustom.addFolder",
      "shellCustom.missingFolder",
    ],
    resettable: false,
  },
  {
    id: "status",
    titleKey: "shellCustom.status",
    helpSlug: "customizing-home-navigation-status",
    keywordKeys: [
      "shellCustom.kindExplorer",
      "shellCustom.kindText",
      "shellCustom.kindPdf",
      "shellCustom.kindImage",
      "shellCustom.kindMedia",
      "shellCustom.kindOffice",
      "statusFields.itemCount",
      "statusFields.selectionCount",
      "statusFields.selectionSize",
      "statusFields.freeSpace",
      "statusFields.viewButtons",
    ],
    resettable: false,
  },
  {
    id: "keyboard",
    titleKey: "keyboard.title",
    helpSlug: "keyboard-styles",
    keywordKeys: [
      "keyboard.style",
      "keyboard.windows",
      "keyboard.finder",
      "keyboard.commander",
      "keyboard.vim",
      "keyboard.capture",
      "keyboard.physical",
      "keyboard.logical",
      "keyboard.scope",
      "keyboard.conflict",
      "keyboard.reassign",
      "keyboard.bare",
      "keyboard.sequence",
      "keyboard.reserved",
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
    id: "tabs",
    titleKey: "tabOptions.title",
    helpSlug: "tab-options",
    keywordKeys: [
      "tabOptions.width",
      "tabOptions.close",
      "tabOptions.newPosition",
      "tabOptions.closeActivation",
      "tabOptions.preview",
      "tabOptions.icons",
      "tabOptions.underline",
      "tabOptions.titleLimit",
      "tabOptions.overflow",
    ],
  },
  {
    id: "behavior",
    titleKey: "behavior.title",
    helpSlug: "opening-files",
    keywordKeys: [
      "behavior.openClick",
      "behavior.confirm",
      "behavior.confirmRecycle",
      "behavior.confirmMove",
      "behavior.confirmRename",
      "behavior.confirmConvert",
      "behavior.confirmClean",
      "behavior.confirmSave",
    ],
  },
  {
    id: "formats",
    titleKey: "formats.title",
    helpSlug: "date-and-size-formats",
    keywordKeys: [
      "formats.locale",
      "formats.dates",
      "formats.custom",
      "formats.time",
      "formats.week",
      "formats.sizes",
      "formats.decimals",
      "formats.truncate",
      "formats.extensions",
    ],
  },
  {
    id: "openingFiles",
    titleKey: "settings.openingFiles",
    helpSlug: "default-apps",
    keywordKeys: ["settings.protectedView", "settings.defaultApps"],
  },
  {
    id: "profiles",
    titleKey: "profiles.title",
    helpSlug: "profiles-and-portable-data",
    keywordKeys: [
      "profiles.current",
      "profiles.baseFolder",
      "profiles.portable",
      "profiles.create",
      "profiles.switch",
      "profiles.copy",
      "profiles.keepOriginal",
    ],
    // The catalog is separate from settings.json; reset never touches it.
    resettable: false,
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
    id: "recovery",
    titleKey: "recovery.title",
    helpSlug: "recovering-after-a-crash",
    keywordKeys: [
      "recovery.enabled",
      "recovery.interval",
      "diagnostics.dumps",
      "diagnostics.redact",
    ],
  },
  {
    id: "locked",
    titleKey: "locked.title",
    helpSlug: "locking-protection",
    keywordKeys: ["locked.autoLock", "locked.lockOnWorkstation", "locked.inMemory"],
  },
  {
    id: "accessibility",
    titleKey: "accessibility.title",
    helpSlug: "accessibility-overview",
    keywordKeys: [
      "accessibility.largeTargets",
      "accessibility.focus",
      "accessibility.cursor",
      "accessibility.color",
      "accessibility.font",
      "accessibility.read",
      "accessibility.subtitles",
      "accessibility.simple",
      "accessibility.reduce",
    ],
  },
  {
    id: "shelf",
    titleKey: "settings.shelf",
    helpSlug: "the-shelf",
    keywordKeys: ["settings.shelfVisible", "settings.shelfSide", "settings.shelfSize"],
  },
  {
    id: "backgroundWork",
    titleKey: "background.title",
    helpSlug: "background-work",
    keywordKeys: [
      "background.tasks",
      "background.rules",
      "background.quiet",
      "background.cpu",
      "folderSizes.title",
      "folderSizes.enable",
      "folderSizes.network",
      "folderSizes.details",
    ],
  },
  {
    id: "startup",
    titleKey: "startup.title",
    helpSlug: "the-settings-page",
    keywordKeys: ["resident.enable", "resident.startWindows", "resident.explain"],
    // The resident switches also change native mode, outside a pure reset.
    resettable: false,
  },
  {
    id: "updates",
    titleKey: "updates.enable",
    helpSlug: "installing-and-updating",
    keywordKeys: ["updates.checkNow", "updates.available", "updates.current"],
  },
  {
    id: "windowsIntegration",
    titleKey: "windowsIntegration.title",
    helpSlug: "windows-integration",
    keywordKeys: [
      "windowsIntegration.classic",
      "windowsIntegration.modern",
      "windowsIntegration.associations",
      "windowsIntegration.defaults",
    ],
    resettable: false,
  },
  {
    id: "aiSearch",
    titleKey: "aiSearch.title",
    helpSlug: "indexing-and-privacy",
    keywordKeys: [
      "aiSearch.meaning",
      "aiSearch.photos",
      "aiSearch.natural",
      "aiSearch.textOptIn",
      "aiSearch.photoOptIn",
      "aiSearch.sort",
    ],
  },
  {
    id: "assistant",
    titleKey: "assistant.title",
    helpSlug: "assistant-preferences",
    keywordKeys: ["assistant.local", "assistant.api", "assistant.provider", "assistant.automaticTools"],
  },
  {
    id: "localAi",
    titleKey: "ai.settings",
    helpSlug: "ai-packs-hardware",
    keywordKeys: ["ai.enabled", "ai.device", "ai.tier", "ai.tasks", "ai.memory"],
  },
  {
    id: "appStorage",
    titleKey: "storage.title",
    helpSlug: "app-storage",
    keywordKeys: ["packs.title", "storage.storedData", "storage.limit"],
    resettable: false,
  },
  {
    id: "setups",
    titleKey: "setups.title",
    helpSlug: "shareable-setups",
    keywordKeys: [
      "setups.export",
      "setups.import",
      "setups.contents",
      "setups.apply",
      "setups.personal",
      "setups.personalWarning",
    ],
    resettable: false,
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
  if (id === "general") {
    return { ...settings, files: defaults.files, image_editor: defaults.image_editor };
  }
  if (id === "clipboardHistory") {
    return { ...settings, clipboard_history: defaults.clipboard_history };
  }
  if (id === "appearance") return { ...settings, appearance: defaults.appearance };
  if (id === "theme") {
    return {
      ...settings,
      theme: defaults.theme,
      theme_custom: {
        ...settings.theme_custom,
        day: defaults.theme_custom.day,
        night: defaults.theme_custom.night,
      },
    };
  }
  if (id === "dayNight") {
    const themeCustom = defaults.theme_custom;
    return {
      ...settings,
      theme_custom: {
        ...settings.theme_custom,
        day: themeCustom.day,
        night: themeCustom.night,
        mode: themeCustom.mode,
        manual_scheme: themeCustom.manual_scheme,
        day_start_minute: themeCustom.day_start_minute,
        night_start_minute: themeCustom.night_start_minute,
      },
    };
  }
  if (id === "accents") {
    return {
      ...settings,
      theme: {
        ...settings.theme,
        accent_source: defaults.theme.accent_source,
        accent_custom: defaults.theme.accent_custom,
      },
      theme_custom: { ...settings.theme_custom, follow_wallpaper: false, type_accents: {} },
    };
  }
  if (id === "layout") {
    return { ...settings, layout: { ...defaults.layout, saved_presets: settings.layout.saved_presets } };
  }
  if (id === "toolbars") return { ...settings, toolbar_custom: defaults.toolbar_custom };
  if (id === "keyboard") return { ...settings, keyboard_custom: defaults.keyboard_custom };
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
  if (id === "recovery") return { ...settings, recovery: defaults.recovery };
  if (id === "tabs") {
    return { ...settings, tab_options: defaults.tab_options, behavior: defaults.behavior };
  }
  if (id === "behavior") return { ...settings, behavior: defaults.behavior };
  if (id === "formats") return { ...settings, format_options: defaults.format_options };
  if (id === "locked") return { ...settings, locked: defaults.locked };
  if (id === "accessibility") return { ...settings, accessibility: defaults.accessibility };
  if (id === "shelf") return { ...settings, shelf: defaults.shelf };
  if (id === "backgroundWork") {
    return {
      ...settings,
      background: defaults.background,
      folder_sizes: defaults.folder_sizes,
    };
  }
  if (id === "startup") {
    return {
      ...settings,
      startup: {
        ...settings.startup,
        stay_in_background: defaults.startup.stay_in_background,
        start_with_windows: defaults.startup.start_with_windows,
      },
    };
  }
  if (id === "updates") return { ...settings, updates: defaults.updates };
  if (id === "aiSearch") return { ...settings, ai_search: defaults.ai_search };
  if (id === "assistant") return { ...settings, assistant: defaults.assistant };
  if (id === "localAi") return { ...settings, local_ai: defaults.local_ai };
  if (id === "windowsIntegration" || id === "appStorage" || id === "profiles") return settings;
  return settings;
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
