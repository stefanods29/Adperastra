import { invoke } from "@tauri-apps/api/core";
import type { MetadataCategory } from "../convert/types";
import type { GroupBy } from "./grouping";
import {
  BACKGROUND_TASK_DEFAULTS, BACKGROUND_TASKS, CACHE_LIMITS_MB,
  type BackgroundSettings, type BackgroundTaskKind, type CacheLimitMb, type CacheSettings,
} from "./background";
import {
  defaultGallerySettings,
  normalizeGallerySettings,
  type GallerySettings,
} from "./gallery";
import {
  IMAGE_PRIVACY_CATEGORIES,
  PDF_PRIVACY_CATEGORIES,
  type PrivacyMode,
  type PrivacySettings,
} from "./privacy";
import {
  DEFAULT_CLIPBOARD_HISTORY_SETTINGS,
  validateSettings as validateClipboardHistorySettings,
  type ClipboardHistorySettings,
} from "./clipboardHistory";
import type { LockedSettings } from "./lockedFolders";
import {
  defaultThemeCustomSettings,
  normalizeThemeCustom,
  type ThemeCustomSettings,
} from "./customThemes";
import {
  defaultToolbarCustomSettings,
  validateToolbarCustomSettings,
  type ToolbarCustomSettings,
} from "./commandLayout";
import {
  defaultKeyboardCustomSettings,
  validateKeyboardCustomSettings,
} from "./keyboardMaps";
import type { KeyboardCustomSettings } from "../keyboard/types";
import {
  defaultBehaviorSettings,
  defaultTabOptions,
  normalizeBehaviorSettings,
  normalizeTabOptions,
  type BehaviorSettings,
  type TabOptions,
} from "./tabOptions";
import {
  defaultFormatOptions,
  normalizeFormatOptions,
  type FormatOptions,
} from "./displayFormats";
import { defaultShellCustomization, normalizeShellCustomization } from "../shell/registries";
import type { ShellCustomization } from "../shell/types";
import {
  defaultAccessibilitySettings,
  isValidAccessibilitySettings,
  type AccessibilitySettings,
} from "./accessibility";
import {
  DEFAULT_SEARCH_SETTINGS,
  normalizeSearchSettings,
} from "../search/searchSettings";
import { configureImageEditorSettings } from "../image-edit/editorSettings";
import type { SearchSettings } from "./search";
import {
  DEFAULT_ENABLED_VIEWS,
  DEFAULT_VIEWS_SETTINGS,
  normalizeViewsSettings,
  type ViewsSettings,
} from "./smartViews";
import {
  defaultLocalAiSettings,
  normalizeLocalAiSettings,
  type LocalAiSettings,
} from "./localAiTypes";
import {
  defaultAssistantSettings,
  normalizeAssistantSettings,
  type AssistantSettings,
} from "../assistant/types";
import {
  defaultAiActionsSettings,
  normalizeAiActionsSettings,
  type AiActionsSettings,
} from "./aiActionTypes";
import {
  defaultAiSearchSettings,
  normalizeAiSearchSettings,
  type AiSearchSettings,
} from "./aiSearchTypes";
import {
  defaultAiInlineSettings,
  normalizeAiInlineSettings,
  type AiInlineSettings,
} from "../editor/aiInlineTypes";
import {
  defaultDocumentAiSettings,
  normalizeDocumentAiSettings,
} from "../office/document/ai/documentAiSettings";
import type { DocumentAiSettings } from "../office/document/ai/documentAiTypes";
import { defaultSheetAiSettings, type SheetAiSettings } from "../office/sheet/ai/sheetAiSettings";
import type { SheetAiAction } from "../office/sheet/ai/sheetAiTypes";
import { defaultDeckAiSettings, normalizeDeckAiSettings } from "./deckAiSettings";
import type { DeckAiSettings } from "../office/deck/ai/deckAiTypes";
import {
  DECK_EDITOR_DEFAULTS,
  normalizeDeckEditorSettings,
  type DeckEditorSettings,
} from "../office/deck/deckController";
import { defaultResidentStartup, normalizeResidentStartup } from "./resident";

export type { BackgroundSettings, CacheLimitMb, CacheSettings, GallerySettings };
export type { PrivacySettings };
export type { LockedSettings };

export const SETTINGS_SCHEMA_VERSION = 56;
export const SETTINGS_STORAGE_KEY = "adperastra-settings";

export type LanguageSetting = "en" | "es" | "pseudo";
export type ThemeMode = "light" | "dark" | "system";
export type AccentSource = "design" | "windows" | "custom";

/** The built-in themes of light mode (schema 9, Step 05d). */
export type LightThemeId = "light" | "bright" | "paper";
/** The built-in themes of dark mode (schema 9, Step 05d). */
export type DarkThemeId = "dark" | "amoled" | "highContrast";
export type ThemeId = LightThemeId | DarkThemeId;

export const LIGHT_THEME_IDS: readonly LightThemeId[] = ["light", "bright", "paper"];
export const DARK_THEME_IDS: readonly DarkThemeId[] = ["dark", "amoled", "highContrast"];

export interface ThemeSettings {
  mode: ThemeMode;
  accent_source: AccentSource;
  /** A `#RRGGBB` colour; the design accent when the user never picked one. */
  accent_custom: string;
  /** The theme light mode uses (schema 9). */
  light_theme: LightThemeId;
  /** The theme dark mode uses (schema 9). */
  dark_theme: DarkThemeId;
}

/** How a folder shows its items (Step 05a D1), in Windows' View-menu order.
 * Step 05b D1 adds Column view as the ninth id. */
export type ViewModeId =
  | "extraLargeIcons"
  | "largeIcons"
  | "mediumIcons"
  | "smallIcons"
  | "list"
  | "details"
  | "tiles"
  | "content"
  | "columns";

/** Same ids and order as Rust `fs_service::VIEW_MODES`. */
export const VIEW_MODE_IDS: readonly ViewModeId[] = [
  "extraLargeIcons",
  "largeIcons",
  "mediumIcons",
  "smallIcons",
  "list",
  "details",
  "tiles",
  "content",
  "columns",
];

export function isViewModeId(value: unknown): value is ViewModeId {
  return typeof value === "string" && (VIEW_MODE_IDS as readonly string[]).includes(value);
}

/** All nine ids: the given order first, then the missing ids in default order. */
export function normalizeViewModeOrder(value: unknown): ViewModeId[] {
  if (!Array.isArray(value)) return [...VIEW_MODE_IDS];
  const result: ViewModeId[] = [];
  for (const entry of value) {
    if (isViewModeId(entry) && !result.includes(entry)) result.push(entry);
  }
  for (const id of VIEW_MODE_IDS) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

/** Valid hidden views, first occurrence only; `details` can never be hidden. */
export function normalizeHiddenViewModes(value: unknown): ViewModeId[] {
  if (!Array.isArray(value)) return [];
  const result: ViewModeId[] = [];
  for (const entry of value) {
    if (isViewModeId(entry) && entry !== "details" && !result.includes(entry)) result.push(entry);
  }
  return result;
}

/** Column view's standard column width in pixels (Step 05b D13). */
export const COLUMN_WIDTH_DEFAULT = 240;
/** Column view's narrowest column in pixels. */
export const COLUMN_WIDTH_MIN = 160;
/** Column view's widest column in pixels. */
export const COLUMN_WIDTH_MAX = 480;

export function clampColumnWidth(width: number): number {
  return Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, Math.round(width)));
}

export function normalizeColumnWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clampColumnWidth(value) : COLUMN_WIDTH_DEFAULT;
}

/** Explorer view options (schema 3): the View menu's toggles and the Sort
 * menu's grouping. Schema 6 (Step 05a) adds the view mode, per-folder
 * memory, and the View menu's order and hidden views. Schema 7 (Step 05b)
 * adds the Column view's column width and preview column. Schema 31
 * (Step 10d) adds folder backgrounds and column sets. */
export interface ExplorerViewSettings {
  show_hidden: boolean;
  show_extensions: boolean;
  item_checkboxes: boolean;
  details_pane: boolean;
  group_by: GroupBy;
  /** The view folders without their own use, and the default view. */
  view_mode: ViewModeId;
  /** Remember a view per folder when this is on. */
  remember_view_per_folder: boolean;
  /** The View menu's order: all nine ids, each once. */
  view_mode_order: ViewModeId[];
  /** Views left out of the View menu; never "details". */
  hidden_view_modes: ViewModeId[];
  /** Column view's column width in pixels (schema 7). */
  column_width: number;
  /** Column view shows a preview of the selected file (schema 7). */
  column_preview: boolean;
  /** Folder backgrounds are drawn (schema 31). */
  folder_backgrounds: boolean;
  /** Custom column sets are offered (schema 31). */
  column_sets_enabled: boolean;
}

export type PasteImageFormat = "png" | "jpg";

/** File-operation choices (schema 4): what Paste as file saves images as. */
export interface FileSettings {
  paste_image_format: PasteImageFormat;
}

export type OpenWith = "builtin" | "windows";

/** How files open (schema 5, Step 04c): Settings > Opening files. */
export interface OpenSettings {
  /** Files from the internet open in protected view. */
  protected_view: boolean;
  /** Extension (lower case, no dot) to where it opens. An extension that
   * is not listed opens in the built-in viewer when there is one. */
  open_with: Record<string, OpenWith>;
}

/** Where the toolbar sits (schema 8, Step 05c). */
export type ToolbarPosition = "top" | "bottom" | "left" | "right";

/** How the toolbar is drawn (schema 8, Step 05c). */
export type ToolbarMode = "full" | "compact" | "iconsOnly" | "autoHide";

/** Where the tabs sit (schema 8, Step 05c). */
export type TabBarPosition = "top" | "bottom" | "left" | "right";

/** Where the navigation pane sits (schema 8, Step 05c). */
export type NavPanePosition = "left" | "right" | "hidden";

/** Where the Details pane sits, when it is shown (schema 8, Step 05c). */
export type DetailsPanePosition = "right" | "bottom";

/** The six layout values a preset stores (schema 8, Step 05c). */
export interface LayoutValues {
  toolbar_position: ToolbarPosition;
  toolbar_mode: ToolbarMode;
  tab_bar_position: TabBarPosition;
  tab_bar_collapsed: boolean;
  nav_pane_position: NavPanePosition;
  details_pane_position: DetailsPanePosition;
}

/** One saved layout preset (schema 8, Step 05c). */
export interface SavedLayout extends LayoutValues {
  name: string;
}

/** Where the toolbar, tabs and panes go (schema 8, Step 05c). The Details
 * pane's visibility stays `explorer.details_pane`. */
export interface LayoutSettings extends LayoutValues {
  saved_presets: SavedLayout[];
}

/** Every toolbar position, in the order the menu shows them. */
export const TOOLBAR_POSITIONS: readonly ToolbarPosition[] = ["top", "bottom", "left", "right"];
/** Every toolbar look, in the order the menu shows them. */
export const TOOLBAR_MODES: readonly ToolbarMode[] = ["full", "compact", "iconsOnly", "autoHide"];
/** Every navigation pane position. */
export const NAV_PANE_POSITIONS: readonly NavPanePosition[] = ["left", "right", "hidden"];
/** Every Details pane position. */
export const DETAILS_PANE_POSITIONS: readonly DetailsPanePosition[] = ["right", "bottom"];
/** Most saved layout presets (Step 05c). */
export const MAX_SAVED_LAYOUTS = 20;
/** Longest saved layout preset name, in characters (Step 05c). */
export const MAX_LAYOUT_NAME = 60;

/** The layout section's defaults, before any saved preset. */
const LAYOUT_DEFAULTS: LayoutValues = {
  toolbar_position: "top",
  toolbar_mode: "full",
  tab_bar_position: "top",
  tab_bar_collapsed: false,
  nav_pane_position: "left",
  details_pane_position: "right",
};

/** The webview's page zoom, in percent (schema 9, Step 05d; schema 33 adds
 * the accessibility scales). */
export type UiScale = number;
/** Every UI scale, in the order the settings select shows them. */
export const UI_SCALES: readonly UiScale[] = [
  75, 90, 100, 110, 125, 150, 175, 200, 225, 250, 275, 300,
];

/** How much space the app leaves around things (schema 9, Step 05d). */
export type Density = "compact" | "comfortable" | "spacious";
export const DENSITIES: readonly Density[] = ["compact", "comfortable", "spacious"];

/** How round the corners are (schema 9, Step 05d). */
export type CornerRadius = "square" | "standard" | "round";
export const CORNER_RADII: readonly CornerRadius[] = ["square", "standard", "round"];

/** How much motion the app shows (schema 9, Step 05d). */
export type AnimationLevel = "full" | "reduced" | "off";
export const ANIMATION_LEVELS: readonly AnimationLevel[] = ["full", "reduced", "off"];

/** UI scale, density, corner radius and animations (schema 9, Step 05d). */
export interface AppearanceSettings {
  ui_scale: UiScale;
  density: Density;
  corner_radius: CornerRadius;
  animations: AnimationLevel;
}

/** How long versions are kept, in days (schema 10, Step 06b). */
export type KeepDays = 7 | 30 | 90 | 365;
/** Every keep length, in the order the settings select shows it. */
export const KEEP_DAYS: readonly KeepDays[] = [7, 30, 90, 365];

/** How much space versions may use, in megabytes (schema 10, Step 06b). */
export type MaxVersionsMb = 256 | 512 | 1024 | 2048 | 5120;
/** Every space choice, in the order the settings select shows it. */
export const MAX_VERSIONS_MB: readonly MaxVersionsMb[] = [256, 512, 1024, 2048, 5120];

/** The versions kept of files the app changes (schema 10, Step 06b). */
export interface VersionSettings {
  enabled: boolean;
  keep_days: KeepDays;
  max_mb: MaxVersionsMb;
}

/** Longest My templates folder path, in characters (schema 11, Step 06c). */
export const MAX_TEMPLATE_FOLDER_CHARS = 1024;

/** The folder the user keeps their own file templates in (schema 11,
 * Step 06c). */
export interface TemplateSettings {
  /** Empty when no folder is chosen. */
  my_folder: string;
}

/** Reading settings of the e-book viewer (schema 15, Step 07f). */
export type ReadingTheme = "app" | "light" | "dark";

export interface ReadingSettings {
  /** Whole pixels, 12-32, default 18. */
  font_px: number;
  /** App follows the app theme; light/dark force the reading page. */
  theme: ReadingTheme;
}

/** OCR settings (schema 14, Step 07e). */
export interface OcrSettings {
  /** `auto` or an installed BCP47 tag. */
  language: string;
  enabled: boolean;
}

const OCR_LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** Same rule as Rust `ocr_types::validate_language_preference`. */
function normalizeOcrLanguage(value: unknown): string {
  return typeof value === "string" &&
    value.length <= 64 &&
    OCR_LANGUAGE_TAG.test(value)
    ? value
    : "auto";
}

/** Conversion preferences (schema 16, Step 08a; schema 17, Step 08b). */
export interface ConversionSettings {
  default_destination: "source" | "ask";
  default_quality: number;
  preserve_metadata: boolean;
  concurrent_jobs: 1 | 2;
  /** UUID of the last used preset, or null (schema 17). */
  last_preset: string | null;
  /** Always true; the loss review cannot be hidden (schema 17). */
  prompt_for_losses: boolean;
}

/** Update preferences (schema 19, Step 08d). */
export interface UpdateSettings {
  enabled: boolean;
  last_seen_version: string;
  last_check_unix: number;
}

export type StartupMode = "home" | "restore" | "folder";

/** Startup behavior (schema 20, Step 09a; schema 43, Step 16). */
export interface StartupSettings {
  mode: StartupMode;
  /** Empty unless mode is "folder"; otherwise an absolute path. */
  folder: string;
  stay_in_background: boolean;
  start_with_windows: boolean;
}

/** Tabs behavior (schema 21, Step 09c D2). */
export interface TabsSettings {
  /** Delay before a file drag over a tab activates it; 200..2000 ms. */
  drag_hover_ms: number;
}

/** Command palette state (schema 22, Step 09d). Only ids are stored. */
export const PALETTE_MAX_RECENT_IDS = 50;
export const PALETTE_MAX_ID_CHARS = 32_768;

export interface PaletteSettings {
  recent_ids: string[];
  show_disabled: boolean;
}

/** Copy and move safety (schema 23, Step 09f). */
export interface TransferSettings {
  verify_copies: boolean;
  /** Always true: one transfer per destination volume. */
  queue_per_volume: boolean;
  max_parallel: 1 | 2;
}

/** The dockable shelf (schema 24, Step 09g). */
export type ShelfSide = "left" | "right" | "bottom";
export const SHELF_SIDES: readonly ShelfSide[] = ["left", "right", "bottom"];
export const SHELF_WIDTH_DEFAULT = 320;
export const SHELF_WIDTH_MIN = 240;
export const SHELF_WIDTH_MAX = 600;
export const SHELF_HEIGHT_DEFAULT = 180;
export const SHELF_HEIGHT_MIN = 120;
export const SHELF_HEIGHT_MAX = 400;

export interface ShelfSettings {
  visible: boolean;
  side: ShelfSide;
  size: number;
}

/** Crash recovery and diagnostics (schema 25, Step 09h). */
export interface RecoverySettings {
  enabled: boolean;
  /** 10..300 seconds. */
  interval_seconds: number;
  /** 128..4096 MiB for the whole store. */
  max_mib: number;
  diagnostics_include_dumps: boolean;
}

/** PDF annotation author (schema 39, Step 14a). */
export interface PdfToolsSettings {
  author: string;
}

export type ImageEditorMode = "edit" | "draw";

/** Image editor preferences (schema 40, Step 14b; schema 48, Step 18a). */
export interface ImageEditorSettings {
  default_mode: ImageEditorMode;
  background_rgba: [number, number, number, number];
  history_limit_mb: number;
  advanced: boolean;
  selection_tolerance: number;
  show_history: boolean;
}

export type MediaPreviewQualitySetting = "source" | "960" | "512";

/** Media editor preferences (schema 42, Step 15). */
export interface MediaEditorSettings {
  preview_quality: MediaPreviewQualitySetting;
  waveform: boolean;
  keep_pitch: boolean;
}

/** Timeline preview quality (schema 49, Step 19a). */
export type TimelinePreviewQuality = "source" | "512" | "960";

export interface TimelineSettings {
  preview_quality: TimelinePreviewQuality;
  snap_enabled: boolean;
  proxy_enabled: boolean;
}

/** Office editing (schema 50, Step 20a). */
export interface OfficeEditSettings {
  enabled: boolean;
  autosave_default: boolean;
  /** Fixed at 5 minutes; not a user-adjustable timer. */
  idle_minutes: number;
}

/** Document editor preferences (schema 51, Step 20b). */
export interface DocumentEditorSettings {
  autosave_default: boolean;
  show_ruler: boolean;
  show_navigation: boolean;
  spelling: boolean;
}

/** Sheet editor preferences (schema 53, Step 21a). */
export interface SheetEditorSettings {
  show_formula_bar: boolean;
  show_gridlines: boolean;
  show_headings: boolean;
  /** Finite 25..400; the zoom need not be an integer. */
  default_zoom: number;
}

/** Nested AI preferences (writing 47, documents 52, sheets 54, decks 56). */
export interface AiSettings {
  writing: AiInlineSettings;
  documents: DocumentAiSettings;
  sheets: SheetAiSettings;
  decks: DeckAiSettings;
}

/** Office viewer preferences (schema 38, Step 13). */
export interface OfficeViewSettings {
  prefer_accurate: boolean;
  show_comments: boolean;
  keep_engine_warm: boolean;
  /** Fixed at 60; not a user control. */
  idle_seconds: number;
}

/** Folder size measurement (schema 36, Step 11c). */
export interface FolderSizeSettings {
  enabled: boolean;
  network: boolean;
  details: boolean;
}

/** Pack catalog state (schema 37, Step 12a). */
export interface PackCatalogSettings {
  last_checked_unix: number | null;
}

export interface AppSettings {
  schema_version: number;
  language: LanguageSetting;
  theme: ThemeSettings;
  explorer: ExplorerViewSettings;
  files: FileSettings;
  open: OpenSettings;
  layout: LayoutSettings;
  appearance: AppearanceSettings;
  versions: VersionSettings;
  templates: TemplateSettings;
  background: BackgroundSettings;
  cache: CacheSettings;
  gallery: GallerySettings;
  ocr: OcrSettings;
  reading: ReadingSettings;
  conversion: ConversionSettings;
  privacy: PrivacySettings;
  updates: UpdateSettings;
  startup: StartupSettings;
  tabs: TabsSettings;
  palette: PaletteSettings;
  transfers: TransferSettings;
  shelf: ShelfSettings;
  recovery: RecoverySettings;
  clipboard_history: ClipboardHistorySettings;
  locked: LockedSettings;
  theme_custom: ThemeCustomSettings;
  toolbar_custom: ToolbarCustomSettings;
  keyboard_custom: KeyboardCustomSettings;
  tab_options: TabOptions;
  format_options: FormatOptions;
  behavior: BehaviorSettings;
  shell_custom: ShellCustomization;
  accessibility: AccessibilitySettings;
  search: SearchSettings;
  views: ViewsSettings;
  folder_sizes: FolderSizeSettings;
  pack_catalog: PackCatalogSettings;
  office_view: OfficeViewSettings;
  pdf_tools: PdfToolsSettings;
  image_editor: ImageEditorSettings;
  local_ai: LocalAiSettings;
  media_editor: MediaEditorSettings;
  assistant: AssistantSettings;
  ai_actions: AiActionsSettings;
  ai_search: AiSearchSettings;
  ai: AiSettings;
  timeline: TimelineSettings;
  office_edit: OfficeEditSettings;
  document_editor: DocumentEditorSettings;
  sheet_editor: SheetEditorSettings;
  deck_editor: DeckEditorSettings;
}

const LANGUAGES: readonly LanguageSetting[] = ["en", "es", "pseudo"];
const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];
const ACCENT_SOURCES: readonly AccentSource[] = ["design", "windows", "custom"];
const GROUP_BY: readonly GroupBy[] = ["none", "name", "modified", "type", "size"];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVACY_MODES: readonly PrivacyMode[] = ["keep", "ask", "remove"];
const STARTUP_MODES: readonly StartupMode[] = ["home", "restore", "folder"];
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

const DEFAULT_UPDATES: UpdateSettings = {
  enabled: false,
  last_seen_version: "",
  last_check_unix: 0,
};

const DEFAULT_RECOVERY: RecoverySettings = {
  enabled: true,
  interval_seconds: 10,
  max_mib: 1024,
  diagnostics_include_dumps: false,
};

const DEFAULT_OFFICE_VIEW: OfficeViewSettings = {
  prefer_accurate: true,
  show_comments: false,
  keep_engine_warm: true,
  idle_seconds: 60,
};

const DEFAULT_IMAGE_EDITOR: ImageEditorSettings = {
  default_mode: "edit",
  background_rgba: [255, 255, 255, 255],
  history_limit_mb: 256,
  advanced: false,
  selection_tolerance: 15,
  show_history: false,
};

const DEFAULT_MEDIA_EDITOR: MediaEditorSettings = {
  preview_quality: "960",
  waveform: true,
  keep_pitch: true,
};

const DEFAULT_TIMELINE: TimelineSettings = {
  preview_quality: "960",
  snap_enabled: true,
  proxy_enabled: false,
};

const DEFAULT_OFFICE_EDIT: OfficeEditSettings = {
  enabled: false,
  autosave_default: false,
  idle_minutes: 5,
};

const DEFAULT_DOCUMENT_EDITOR: DocumentEditorSettings = {
  autosave_default: false,
  show_ruler: true,
  show_navigation: false,
  spelling: true,
};

const DEFAULT_SHEET_EDITOR: SheetEditorSettings = {
  show_formula_bar: true,
  show_gridlines: true,
  show_headings: true,
  default_zoom: 100,
};

export function defaultFolderSizeSettings(): FolderSizeSettings {
  return { enabled: false, network: false, details: false };
}

export function defaultSettings(): AppSettings {
  const language: LanguageSetting = "en";
  return {
    schema_version: SETTINGS_SCHEMA_VERSION,
    language,
    theme: {
      mode: "system",
      accent_source: "design",
      accent_custom: "#0067C0",
      light_theme: "light",
      dark_theme: "dark",
    },
    explorer: {
      show_hidden: false,
      show_extensions: true,
      item_checkboxes: false,
      details_pane: false,
      group_by: "none",
      view_mode: "details",
      remember_view_per_folder: true,
      view_mode_order: [...VIEW_MODE_IDS],
      hidden_view_modes: [],
      column_width: COLUMN_WIDTH_DEFAULT,
      column_preview: true,
      folder_backgrounds: false,
      column_sets_enabled: false,
    },
    files: {
      paste_image_format: "png",
    },
    open: {
      protected_view: true,
      open_with: {},
    },
    layout: {
      ...LAYOUT_DEFAULTS,
      saved_presets: [],
    },
    appearance: {
      ui_scale: 100,
      density: "comfortable",
      corner_radius: "standard",
      animations: "full",
    },
    versions: {
      enabled: true,
      keep_days: 30,
      max_mb: 1024,
    },
    templates: {
      my_folder: "",
    },
    background: {
      enabled: true,
      only_idle: false,
      only_ac: false,
      paused: false,
      tasks: { ...BACKGROUND_TASK_DEFAULTS },
      pause_fullscreen: true,
      quiet_hours: { enabled: false, start_minute: 1320, end_minute: 420 },
      cpu_percent: 25,
    },
    cache: { max_mb: 512 },
    gallery: defaultGallerySettings(),
    ocr: { language: "auto", enabled: true },
    reading: {
      font_px: 18,
      theme: "app",
    },
    conversion: {
      default_destination: "source",
      default_quality: 90,
      preserve_metadata: true,
      concurrent_jobs: 2,
      last_preset: null,
      prompt_for_losses: true,
    },
    privacy: {
      mode: "keep",
      image_mode: "keep",
      pdf_mode: "keep",
      image_categories: [],
      pdf_categories: [],
      location_warning: false,
      sharing_prompt: false,
    },
    updates: { ...DEFAULT_UPDATES },
    startup: {
      mode: "home",
      folder: "",
      ...defaultResidentStartup(),
    },
    tabs: { drag_hover_ms: 600 },
    palette: { recent_ids: [], show_disabled: true },
    transfers: { verify_copies: false, queue_per_volume: true, max_parallel: 2 },
    shelf: { visible: false, side: "bottom", size: SHELF_HEIGHT_DEFAULT },
    recovery: { ...DEFAULT_RECOVERY },
    clipboard_history: { ...DEFAULT_CLIPBOARD_HISTORY_SETTINGS },
    locked: { auto_lock_minutes: 5, lock_on_workstation: true },
    theme_custom: defaultThemeCustomSettings(),
    toolbar_custom: defaultToolbarCustomSettings(),
    keyboard_custom: defaultKeyboardCustomSettings(),
    tab_options: defaultTabOptions(),
    format_options: defaultFormatOptions(),
    behavior: defaultBehaviorSettings(),
    shell_custom: defaultShellCustomization(),
    accessibility: defaultAccessibilitySettings(),
    search: { ...DEFAULT_SEARCH_SETTINGS, roots: [] },
    views: { ...DEFAULT_VIEWS_SETTINGS, enabled_views: { ...DEFAULT_ENABLED_VIEWS } },
    folder_sizes: defaultFolderSizeSettings(),
    pack_catalog: { last_checked_unix: null },
    office_view: { ...DEFAULT_OFFICE_VIEW },
    pdf_tools: { author: "" },
    image_editor: { ...DEFAULT_IMAGE_EDITOR, background_rgba: [...DEFAULT_IMAGE_EDITOR.background_rgba] },
    local_ai: defaultLocalAiSettings(),
    media_editor: { ...DEFAULT_MEDIA_EDITOR },
    assistant: defaultAssistantSettings(),
    ai_actions: defaultAiActionsSettings(language),
    ai_search: defaultAiSearchSettings(),
    ai: {
      writing: defaultAiInlineSettings(),
      documents: defaultDocumentAiSettings(),
      sheets: defaultSheetAiSettings(),
      decks: defaultDeckAiSettings(),
    },
    timeline: { ...DEFAULT_TIMELINE },
    office_edit: { ...DEFAULT_OFFICE_EDIT },
    document_editor: { ...DEFAULT_DOCUMENT_EDITOR },
    sheet_editor: { ...DEFAULT_SHEET_EDITOR },
    deck_editor: { ...DECK_EDITOR_DEFAULTS },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickNumber<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "number" && (allowed as readonly number[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Same rule as Rust `is_valid_extension_key`. */
const EXTENSION_KEY_RE = /^[a-z0-9_+-]{1,16}$/;
/** Same limit as Rust `MAX_OPEN_WITH`. */
export const MAX_OPEN_WITH = 500;

/** Keep only valid `open_with` entries, at most `MAX_OPEN_WITH`. */
function normalizeOpenWith(value: unknown): Record<string, OpenWith> {
  const result: Record<string, OpenWith> = {};
  if (!isRecord(value)) return result;
  let count = 0;
  for (const [ext, choice] of Object.entries(value)) {
    if (count >= MAX_OPEN_WITH) break;
    if (EXTENSION_KEY_RE.test(ext) && (choice === "builtin" || choice === "windows")) {
      result[ext] = choice;
      count += 1;
    }
  }
  return result;
}

/** A drive path (`C:\`) or a UNC path (`\\server`), like the Rust check. */
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:\\|\\\\)/;

/** An empty folder or an absolute Windows path of at most
 * `MAX_TEMPLATE_FOLDER_CHARS` characters; anything else is no folder. */
function normalizeTemplateFolder(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (Array.from(value).length > MAX_TEMPLATE_FOLDER_CHARS) return "";
  return ABSOLUTE_PATH_RE.test(value) ? value : "";
}

/** The first `MAX_LAYOUT_NAME` code points of a name, trimmed at both ends. */
function layoutName(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_LAYOUT_NAME).join("").trim();
}

/** The layout section, repaired field by field (schema 8, Step 05c). */
function normalizeLayout(value: unknown): LayoutSettings {
  const input = isRecord(value) ? value : {};
  const values: LayoutValues = {
    toolbar_position: pick(input.toolbar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.toolbar_position),
    toolbar_mode: pick(input.toolbar_mode, TOOLBAR_MODES, LAYOUT_DEFAULTS.toolbar_mode),
    tab_bar_position: pick(input.tab_bar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.tab_bar_position),
    tab_bar_collapsed: typeof input.tab_bar_collapsed === "boolean" ? input.tab_bar_collapsed : LAYOUT_DEFAULTS.tab_bar_collapsed,
    nav_pane_position: pick(input.nav_pane_position, NAV_PANE_POSITIONS, LAYOUT_DEFAULTS.nav_pane_position),
    details_pane_position: pick(input.details_pane_position, DETAILS_PANE_POSITIONS, LAYOUT_DEFAULTS.details_pane_position),
  };
  const savedPresets: SavedLayout[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.saved_presets)) {
    for (const entry of input.saved_presets) {
      if (savedPresets.length >= MAX_SAVED_LAYOUTS) break;
      if (!isRecord(entry) || typeof entry.name !== "string") continue;
      const name = layoutName(entry.name);
      if (name === "") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      savedPresets.push({
        name,
        toolbar_position: pick(entry.toolbar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.toolbar_position),
        toolbar_mode: pick(entry.toolbar_mode, TOOLBAR_MODES, LAYOUT_DEFAULTS.toolbar_mode),
        tab_bar_position: pick(entry.tab_bar_position, TOOLBAR_POSITIONS, LAYOUT_DEFAULTS.tab_bar_position),
        tab_bar_collapsed: typeof entry.tab_bar_collapsed === "boolean" ? entry.tab_bar_collapsed : LAYOUT_DEFAULTS.tab_bar_collapsed,
        nav_pane_position: pick(entry.nav_pane_position, NAV_PANE_POSITIONS, LAYOUT_DEFAULTS.nav_pane_position),
        details_pane_position: pick(entry.details_pane_position, DETAILS_PANE_POSITIONS, LAYOUT_DEFAULTS.details_pane_position),
      });
    }
  }
  return { ...values, saved_presets: savedPresets };
}

/** Schema 12: every known task gets a boolean; unknown keys are dropped.
 * Schema 37 (Step 12a) adds pause-on-fullscreen, quiet hours and CPU. */
function normalizeBackground(value: unknown): BackgroundSettings {
  const input = isRecord(value) ? value : {};
  const tasksInput = isRecord(input.tasks) ? input.tasks : {};
  const tasks = {} as Record<BackgroundTaskKind, boolean>;
  for (const kind of BACKGROUND_TASKS) {
    const entry = tasksInput[kind];
    tasks[kind] = typeof entry === "boolean" ? entry : BACKGROUND_TASK_DEFAULTS[kind];
  }
  const quietInput = isRecord(input.quiet_hours) ? input.quiet_hours : {};
  const minute = (entry: unknown, fallback: number) =>
    typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry < 1440
      ? entry
      : fallback;
  const cpu =
    typeof input.cpu_percent === "number" &&
    Number.isInteger(input.cpu_percent) &&
    input.cpu_percent >= 5 &&
    input.cpu_percent <= 100
      ? input.cpu_percent
      : 25;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    only_idle: typeof input.only_idle === "boolean" ? input.only_idle : false,
    only_ac: typeof input.only_ac === "boolean" ? input.only_ac : false,
    paused: typeof input.paused === "boolean" ? input.paused : false,
    tasks,
    pause_fullscreen: typeof input.pause_fullscreen === "boolean" ? input.pause_fullscreen : true,
    quiet_hours: {
      enabled: typeof quietInput.enabled === "boolean" ? quietInput.enabled : false,
      start_minute: minute(quietInput.start_minute, 1320),
      end_minute: minute(quietInput.end_minute, 420),
    },
    cpu_percent: cpu,
  };
}

/** Schema 12: one of CACHE_LIMITS_MB, else the 512 MB default. */
function normalizeCache(value: unknown): CacheSettings {
  const input = isRecord(value) ? value : {};
  const max = input.max_mb;
  return {
    max_mb:
      typeof max === "number" && (CACHE_LIMITS_MB as readonly number[]).includes(max)
        ? (max as CacheLimitMb)
        : 512,
  };
}

function normalizeConversion(value: unknown): ConversionSettings {
  const input = isRecord(value) ? value : {};
  return {
    default_destination: input.default_destination === "ask" ? "ask" : "source",
    default_quality:
      typeof input.default_quality === "number" && Number.isInteger(input.default_quality)
        ? Math.min(100, Math.max(1, input.default_quality))
        : 90,
    preserve_metadata: typeof input.preserve_metadata === "boolean" ? input.preserve_metadata : true,
    concurrent_jobs: input.concurrent_jobs === 1 ? 1 : 2,
    last_preset:
      typeof input.last_preset === "string" && UUID_RE.test(input.last_preset)
        ? input.last_preset
        : null,
    prompt_for_losses: true,
  };
}

function normalizePrivacyCategories(value: unknown, allowed: readonly MetadataCategory[]): MetadataCategory[] {
  if (!Array.isArray(value)) return [];
  const result: MetadataCategory[] = [];
  for (const entry of value) {
    if (result.length >= 16) break;
    if (
      typeof entry === "string" &&
      (allowed as readonly string[]).includes(entry) &&
      !result.includes(entry as MetadataCategory)
    ) {
      result.push(entry as MetadataCategory);
    }
  }
  return result;
}

/** Schema 18: missing fields never become "remove". */
function normalizePrivacy(value: unknown): PrivacySettings {
  const input = isRecord(value) ? value : {};
  return {
    mode: pick(input.mode, PRIVACY_MODES, "keep"),
    image_mode: pick(input.image_mode, PRIVACY_MODES, "keep"),
    pdf_mode: pick(input.pdf_mode, PRIVACY_MODES, "keep"),
    image_categories: normalizePrivacyCategories(input.image_categories, IMAGE_PRIVACY_CATEGORIES),
    pdf_categories: normalizePrivacyCategories(input.pdf_categories, PDF_PRIVACY_CATEGORIES),
    location_warning: input.location_warning === true,
    sharing_prompt: input.sharing_prompt === true,
  };
}

function normalizeUpdates(value: unknown): UpdateSettings {
  const input = isRecord(value) ? value : {};
  const lastSeen =
    typeof input.last_seen_version === "string"
      ? Array.from(input.last_seen_version).slice(0, 128).join("")
      : DEFAULT_UPDATES.last_seen_version;
  const lastCheck =
    typeof input.last_check_unix === "number" &&
    Number.isInteger(input.last_check_unix) &&
    input.last_check_unix >= 0 &&
    input.last_check_unix <= MAX_SAFE_INTEGER
      ? input.last_check_unix
      : DEFAULT_UPDATES.last_check_unix;
  return {
    enabled: input.enabled === true,
    last_seen_version: lastSeen,
    last_check_unix: lastCheck,
  };
}

function normalizeStartup(value: unknown): StartupSettings {
  const input = isRecord(value) ? value : {};
  const resident = normalizeResidentStartup(input);
  const folder =
    typeof input.folder === "string" && ABSOLUTE_PATH_RE.test(input.folder)
      ? input.folder
      : "";
  return {
    mode: pick(input.mode, STARTUP_MODES, "home"),
    folder,
    ...resident,
  };
}

function normalizeTabs(value: unknown): TabsSettings {
  const input = isRecord(value) ? value : {};
  return {
    drag_hover_ms:
      typeof input.drag_hover_ms === "number" &&
      Number.isInteger(input.drag_hover_ms) &&
      input.drag_hover_ms >= 200 &&
      input.drag_hover_ms <= 2000
        ? input.drag_hover_ms
        : 600,
  };
}

function normalizePalette(value: unknown): PaletteSettings {
  const input = isRecord(value) ? value : {};
  const ids: string[] = [];
  if (Array.isArray(input.recent_ids)) {
    for (const entry of input.recent_ids) {
      if (ids.length >= PALETTE_MAX_RECENT_IDS) break;
      if (
        typeof entry === "string" &&
        entry.length > 0 &&
        Array.from(entry).length <= PALETTE_MAX_ID_CHARS &&
        !entry.includes("\0") &&
        !ids.includes(entry)
      ) {
        ids.push(entry);
      }
    }
  }
  return {
    recent_ids: ids,
    show_disabled: typeof input.show_disabled === "boolean" ? input.show_disabled : true,
  };
}

function normalizeTransfers(value: unknown): TransferSettings {
  const input = isRecord(value) ? value : {};
  return {
    verify_copies: input.verify_copies === true,
    queue_per_volume: true,
    max_parallel: input.max_parallel === 1 ? 1 : 2,
  };
}

function normalizeShelf(value: unknown): ShelfSettings {
  if (value === null || typeof value !== "object") {
    return { visible: false, side: "bottom", size: SHELF_HEIGHT_DEFAULT };
  }
  const raw = value as Record<string, unknown>;
  const side = (SHELF_SIDES as readonly string[]).includes(raw.side as string)
    ? (raw.side as ShelfSide)
    : "bottom";
  const min = side === "bottom" ? SHELF_HEIGHT_MIN : SHELF_WIDTH_MIN;
  const max = side === "bottom" ? SHELF_HEIGHT_MAX : SHELF_WIDTH_MAX;
  const fallback = side === "bottom" ? SHELF_HEIGHT_DEFAULT : SHELF_WIDTH_DEFAULT;
  const size =
    typeof raw.size === "number" && Number.isFinite(raw.size)
      ? Math.min(max, Math.max(min, Math.round(raw.size)))
      : fallback;
  return { visible: raw.visible === true, side, size };
}

function normalizeRecovery(value: unknown): RecoverySettings {
  const input = isRecord(value) ? value : {};
  const interval =
    typeof input.interval_seconds === "number" &&
    Number.isInteger(input.interval_seconds) &&
    input.interval_seconds >= 10 &&
    input.interval_seconds <= 300
      ? input.interval_seconds
      : DEFAULT_RECOVERY.interval_seconds;
  const maxMib =
    typeof input.max_mib === "number" &&
    Number.isInteger(input.max_mib) &&
    input.max_mib >= 128 &&
    input.max_mib <= 4096
      ? input.max_mib
      : DEFAULT_RECOVERY.max_mib;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    interval_seconds: interval,
    max_mib: maxMib,
    diagnostics_include_dumps: input.diagnostics_include_dumps === true,
  };
}

function normalizeLocked(value: unknown): LockedSettings {
  const input = isRecord(value) ? value : {};
  return {
    auto_lock_minutes: pickNumber(input.auto_lock_minutes, [0, 1, 5, 15, 30] as const, 5),
    lock_on_workstation: typeof input.lock_on_workstation === "boolean" ? input.lock_on_workstation : true,
  };
}

function normalizeToolbarCustom(value: unknown): ToolbarCustomSettings {
  try {
    return validateToolbarCustomSettings(value);
  } catch {
    return defaultToolbarCustomSettings();
  }
}

function normalizeKeyboardCustom(value: unknown): KeyboardCustomSettings {
  try {
    return validateKeyboardCustomSettings(value);
  } catch {
    return defaultKeyboardCustomSettings();
  }
}

function normalizeAccessibility(value: unknown): AccessibilitySettings {
  return isValidAccessibilitySettings(value) ? value : defaultAccessibilitySettings();
}

function normalizeOfficeView(value: unknown): OfficeViewSettings {
  const input = isRecord(value) ? value : {};
  return {
    prefer_accurate: typeof input.prefer_accurate === "boolean" ? input.prefer_accurate : true,
    show_comments: input.show_comments === true,
    keep_engine_warm: typeof input.keep_engine_warm === "boolean" ? input.keep_engine_warm : true,
    idle_seconds: 60,
  };
}

function normalizePdfTools(value: unknown): PdfToolsSettings {
  const input = isRecord(value) ? value : {};
  const author =
    typeof input.author === "string"
      ? Array.from(input.author.replace(/[\u0000-\u001F\u007F]/g, ""))
          .slice(0, 128)
          .join("")
      : "";
  return { author };
}

function normalizeRgba(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return [255, 255, 255, 255];
  const channel = (entry: unknown, fallback: number) =>
    typeof entry === "number" && Number.isFinite(entry)
      ? Math.min(255, Math.max(0, Math.round(entry)))
      : fallback;
  return [channel(value[0], 255), channel(value[1], 255), channel(value[2], 255), channel(value[3], 255)];
}

function normalizeImageEditor(value: unknown): ImageEditorSettings {
  const input = isRecord(value) ? value : {};
  const history =
    typeof input.history_limit_mb === "number" && Number.isFinite(input.history_limit_mb)
      ? Math.min(256, Math.max(64, Math.round(input.history_limit_mb)))
      : 256;
  const tolerance =
    typeof input.selection_tolerance === "number" && Number.isFinite(input.selection_tolerance)
      ? Math.min(100, Math.max(0, Math.round(input.selection_tolerance)))
      : 15;
  return {
    default_mode: input.default_mode === "draw" ? "draw" : "edit",
    background_rgba: normalizeRgba(input.background_rgba),
    history_limit_mb: history,
    advanced: input.advanced === true,
    selection_tolerance: tolerance,
    show_history: input.show_history === true,
  };
}

function normalizeMediaEditor(value: unknown): MediaEditorSettings {
  const input = isRecord(value) ? value : {};
  return {
    preview_quality: pick(
      input.preview_quality,
      ["source", "960", "512"] as const,
      DEFAULT_MEDIA_EDITOR.preview_quality,
    ),
    waveform: typeof input.waveform === "boolean" ? input.waveform : true,
    keep_pitch: typeof input.keep_pitch === "boolean" ? input.keep_pitch : true,
  };
}

function normalizeTimeline(value: unknown): TimelineSettings {
  const input = isRecord(value) ? value : {};
  return {
    preview_quality: pick(
      input.preview_quality,
      ["source", "512", "960"] as const,
      DEFAULT_TIMELINE.preview_quality,
    ),
    snap_enabled: typeof input.snap_enabled === "boolean" ? input.snap_enabled : true,
    proxy_enabled: input.proxy_enabled === true,
  };
}

function normalizeOfficeEdit(value: unknown): OfficeEditSettings {
  const input = isRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    autosave_default: input.autosave_default === true,
    idle_minutes: 5,
  };
}

function normalizeDocumentEditor(value: unknown): DocumentEditorSettings {
  const input = isRecord(value) ? value : {};
  return {
    autosave_default: input.autosave_default === true,
    show_ruler: typeof input.show_ruler === "boolean" ? input.show_ruler : true,
    show_navigation: input.show_navigation === true,
    spelling: typeof input.spelling === "boolean" ? input.spelling : true,
  };
}

function normalizeSheetEditor(value: unknown): SheetEditorSettings {
  const input = isRecord(value) ? value : {};
  const zoom =
    typeof input.default_zoom === "number" &&
    Number.isFinite(input.default_zoom) &&
    input.default_zoom >= 25 &&
    input.default_zoom <= 400
      ? input.default_zoom
      : 100;
  return {
    show_formula_bar: typeof input.show_formula_bar === "boolean" ? input.show_formula_bar : true,
    show_gridlines: typeof input.show_gridlines === "boolean" ? input.show_gridlines : true,
    show_headings: typeof input.show_headings === "boolean" ? input.show_headings : true,
    default_zoom: zoom,
  };
}

const SHEET_AI_ACTIONS: readonly SheetAiAction[] = ["formula", "explain", "clean", "chart", "describe"];

function normalizeSheetAi(value: unknown): SheetAiSettings {
  const input = isRecord(value) ? value : {};
  const actions: SheetAiAction[] = [];
  if (Array.isArray(input.experimental_actions)) {
    for (const entry of input.experimental_actions) {
      if (
        typeof entry === "string" &&
        (SHEET_AI_ACTIONS as readonly string[]).includes(entry) &&
        !actions.includes(entry as SheetAiAction)
      ) {
        actions.push(entry as SheetAiAction);
      }
    }
  }
  return { enabled: input.enabled === true, experimental_actions: actions };
}

export function normalizeSettings(input: unknown): AppSettings {
  const defaults = defaultSettings();
  if (!isRecord(input)) return defaults;

  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(input, "schema_version");
  const knownSchemaVersion =
    typeof input.schema_version === "number" &&
    Number.isInteger(input.schema_version) &&
    input.schema_version >= 1
      ? input.schema_version
      : null;
  // A missing version is repaired as the current one; a present but unknown,
  // invalid or newer version is not guessed at, like the Rust migration.
  if (hasSchemaVersion && knownSchemaVersion === null) return defaults;
  if (knownSchemaVersion !== null && knownSchemaVersion > SETTINGS_SCHEMA_VERSION) {
    return defaults;
  }
  const inputSchemaVersion = knownSchemaVersion ?? defaults.schema_version;

  const themeInput = isRecord(input.theme) ? input.theme : {};
  const explorerInput = isRecord(input.explorer) ? input.explorer : {};
  const filesInput = isRecord(input.files) ? input.files : {};
  const openInput = isRecord(input.open) ? input.open : {};
  const appearanceInput = isRecord(input.appearance) ? input.appearance : {};
  const versionsInput = isRecord(input.versions) ? input.versions : {};
  const templatesInput = isRecord(input.templates) ? input.templates : {};
  const ocrInput = isRecord(input.ocr) ? input.ocr : {};
  const readingInput = isRecord(input.reading) ? input.reading : {};
  const aiInput = isRecord(input.ai) ? input.ai : {};
  const folderSizesInput = isRecord(input.folder_sizes) ? input.folder_sizes : {};
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const accentCustom =
    typeof themeInput.accent_custom === "string" && HEX_COLOR_RE.test(themeInput.accent_custom)
      ? themeInput.accent_custom
      : defaults.theme.accent_custom;
  const hiddenViewModes = normalizeHiddenViewModes(explorerInput.hidden_view_modes);
  const viewModeCandidate = isViewModeId(explorerInput.view_mode)
    ? explorerInput.view_mode
    : defaults.explorer.view_mode;
  const viewMode = hiddenViewModes.includes(viewModeCandidate) ? "details" : viewModeCandidate;
  const language = pick(input.language, LANGUAGES, defaults.language);
  const theme: ThemeSettings = {
    mode: pick(themeInput.mode, THEME_MODES, defaults.theme.mode),
    accent_source: pick(themeInput.accent_source, ACCENT_SOURCES, defaults.theme.accent_source),
    accent_custom: accentCustom,
    light_theme: pick(themeInput.light_theme, LIGHT_THEME_IDS, defaults.theme.light_theme),
    dark_theme: pick(themeInput.dark_theme, DARK_THEME_IDS, defaults.theme.dark_theme),
  };
  const catalogInput = isRecord(input.pack_catalog) ? input.pack_catalog : {};
  const lastChecked =
    typeof catalogInput.last_checked_unix === "number" &&
    Number.isInteger(catalogInput.last_checked_unix) &&
    catalogInput.last_checked_unix >= 0 &&
    catalogInput.last_checked_unix <= MAX_SAFE_INTEGER
      ? catalogInput.last_checked_unix
      : null;

  return {
    schema_version: SETTINGS_SCHEMA_VERSION,
    language,
    theme,
    explorer: {
      show_hidden: flag(explorerInput.show_hidden, defaults.explorer.show_hidden),
      show_extensions: flag(explorerInput.show_extensions, defaults.explorer.show_extensions),
      item_checkboxes: flag(explorerInput.item_checkboxes, defaults.explorer.item_checkboxes),
      details_pane: flag(explorerInput.details_pane, defaults.explorer.details_pane),
      group_by: pick(explorerInput.group_by, GROUP_BY, defaults.explorer.group_by),
      view_mode: viewMode,
      remember_view_per_folder: flag(explorerInput.remember_view_per_folder, defaults.explorer.remember_view_per_folder),
      view_mode_order: normalizeViewModeOrder(explorerInput.view_mode_order),
      hidden_view_modes: hiddenViewModes,
      column_width: normalizeColumnWidth(explorerInput.column_width),
      column_preview: flag(explorerInput.column_preview, defaults.explorer.column_preview),
      folder_backgrounds: flag(explorerInput.folder_backgrounds, false),
      column_sets_enabled: flag(explorerInput.column_sets_enabled, false),
    },
    files: {
      paste_image_format: pick(filesInput.paste_image_format, ["png", "jpg"] as const, defaults.files.paste_image_format),
    },
    open: {
      protected_view: flag(openInput.protected_view, defaults.open.protected_view),
      open_with: normalizeOpenWith(openInput.open_with),
    },
    layout: normalizeLayout(input.layout),
    appearance: {
      ui_scale:
        typeof appearanceInput.ui_scale === "number" &&
        (UI_SCALES as readonly number[]).includes(appearanceInput.ui_scale)
          ? appearanceInput.ui_scale
          : defaults.appearance.ui_scale,
      density: pick(appearanceInput.density, DENSITIES, defaults.appearance.density),
      corner_radius: pick(appearanceInput.corner_radius, CORNER_RADII, defaults.appearance.corner_radius),
      animations: pick(appearanceInput.animations, ANIMATION_LEVELS, defaults.appearance.animations),
    },
    versions: {
      enabled: flag(versionsInput.enabled, defaults.versions.enabled),
      keep_days: pickNumber(versionsInput.keep_days, KEEP_DAYS, defaults.versions.keep_days),
      max_mb: pickNumber(versionsInput.max_mb, MAX_VERSIONS_MB, defaults.versions.max_mb),
    },
    templates: {
      my_folder: normalizeTemplateFolder(templatesInput.my_folder),
    },
    background: normalizeBackground(input.background),
    cache: normalizeCache(input.cache),
    gallery: normalizeGallerySettings(input.gallery),
    ocr: {
      language: normalizeOcrLanguage(ocrInput.language),
      enabled: flag(ocrInput.enabled, defaults.ocr.enabled),
    },
    reading: {
      font_px:
        typeof readingInput.font_px === "number" &&
        Number.isInteger(readingInput.font_px) &&
        readingInput.font_px >= 12 &&
        readingInput.font_px <= 32
          ? readingInput.font_px
          : defaults.reading.font_px,
      theme: pick(readingInput.theme, ["app", "light", "dark"] as const, defaults.reading.theme),
    },
    conversion: normalizeConversion(input.conversion),
    privacy: normalizePrivacy(input.privacy),
    updates: normalizeUpdates(input.updates),
    startup: normalizeStartup(input.startup),
    tabs: normalizeTabs(input.tabs),
    palette: normalizePalette(input.palette),
    transfers: normalizeTransfers(input.transfers),
    shelf: normalizeShelf(input.shelf),
    recovery: normalizeRecovery(input.recovery),
    clipboard_history: validateClipboardHistorySettings(input.clipboard_history),
    locked: normalizeLocked(input.locked),
    theme_custom: normalizeThemeCustom(input.theme_custom, theme),
    toolbar_custom: normalizeToolbarCustom(input.toolbar_custom),
    keyboard_custom: normalizeKeyboardCustom(input.keyboard_custom),
    tab_options: normalizeTabOptions(input.tab_options),
    format_options: normalizeFormatOptions(input.format_options, inputSchemaVersion < 30),
    behavior: normalizeBehaviorSettings(input.behavior),
    shell_custom: normalizeShellCustomization(input.shell_custom),
    accessibility: normalizeAccessibility(input.accessibility),
    search: normalizeSearchSettings(input.search),
    views: normalizeViewsSettings(input.views),
    folder_sizes: {
      enabled: folderSizesInput.enabled === true,
      network: folderSizesInput.network === true,
      details: folderSizesInput.details === true,
    },
    pack_catalog: { last_checked_unix: lastChecked },
    office_view: normalizeOfficeView(input.office_view),
    pdf_tools: normalizePdfTools(input.pdf_tools),
    image_editor: normalizeImageEditor(input.image_editor),
    local_ai: normalizeLocalAiSettings(input.local_ai),
    media_editor: normalizeMediaEditor(input.media_editor),
    assistant: normalizeAssistantSettings(input.assistant),
    ai_actions: normalizeAiActionsSettings(input.ai_actions, language),
    ai_search:
      inputSchemaVersion < 46 ? defaultAiSearchSettings() : normalizeAiSearchSettings(input.ai_search),
    ai: {
      writing: normalizeAiInlineSettings(aiInput.writing),
      documents: normalizeDocumentAiSettings(aiInput.documents),
      sheets: normalizeSheetAi(aiInput.sheets),
      decks: normalizeDeckAiSettings(aiInput.decks),
    },
    timeline: normalizeTimeline(input.timeline),
    office_edit: normalizeOfficeEdit(input.office_edit),
    document_editor: normalizeDocumentEditor(input.document_editor),
    sheet_editor: normalizeSheetEditor(input.sheet_editor),
    deck_editor: normalizeDeckEditorSettings(input.deck_editor),
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<AppSettings> {
  let loaded: AppSettings;
  if (isTauriRuntime()) {
    try {
      loaded = normalizeSettings(await invoke<unknown>("get_settings"));
    } catch {
      loaded = defaultSettings();
    }
  } else {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      loaded = raw ? normalizeSettings(JSON.parse(raw)) : defaultSettings();
    } catch {
      loaded = defaultSettings();
    }
  }
  // App applies the loaded settings through this path; the image editor keeps
  // its own defaults, so the section must reach it here even before a view
  // mounts.
  configureImageEditorSettings(loaded.image_editor);
  return loaded;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  // Settings > Save calls this path; apply the editor section immediately
  // without waiting for the next load or a new editor.
  configureImageEditorSettings(normalized.image_editor);
  if (isTauriRuntime()) {
    await invoke("save_settings", { settings: normalized });
    return normalized;
  }
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable (private mode, quota); settings stay in memory for callers.
  }
  return normalized;
}
