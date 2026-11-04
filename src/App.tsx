import type { ConversionInput, ConversionOpenRequest } from "./convert/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeftRight,
  CircleHelp,
  Columns2,
  Copy,
  Folder,
  FolderMinus,
  FolderPlus,
  Home,
  LayoutGrid,
  Link2,
  List,
  MessageSquare,
  Minus,
  PanelsTopLeft,
  Pin,
  PinOff,
  Rows2,
  Save,
  Search,
  Settings as SettingsIcon,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityProvider } from "./accessibility/AccessibilityContext";
import AnnouncementContext from "./accessibility/AnnouncementContext";
import { ClickPickDropController, PICK_DROP_TARGET_ID } from "./accessibility/ClickPickDrop";
import TransferChoiceDialog from "./transfer/TransferChoiceDialog";
import { ReadNamesAloud } from "./accessibility/readNamesAloud";
import { AnnouncementQueue } from "./accessibility/announcements";
import { AnnouncementRegion } from "./accessibility/AccessibleFileAnnouncement";
import { applyAppearanceAttributes, applyThemeAttributes } from "./appearance/applyAppearance";
import { AppearanceContext } from "./appearance/density";
import { resolveReadableAccent } from "./appearance/themeMath";
import {
  applyCustomThemeAttributes,
  clearCustomThemeAttributes,
  customThemeCss,
  resolveTheme,
} from "./appearance/themeResolver";
import { THEMES } from "./appearance/themes";
import ThemeEditor from "./appearance/ThemeEditor";
import { useThemeSchedule } from "./appearance/useThemeSchedule";
import { createThemePaletteProvider } from "./commands/themeCommands";
import {
  THEME_CANONICAL_TYPE_IDS,
  applyThemeMaterial,
  createCustomTheme,
  leaseThemeBackground,
  listCustomThemes,
  readCustomTheme,
  revokeThemeBackground,
  saveCustomTheme,
  type CustomTheme,
  type CustomThemeSummary,
  type ThemeCustomSettings,
  type ThemeRuntime,
} from "./services/customThemes";
import { fileUrl } from "./services/files";
import {
  defaultAccessibilitySettings,
  effectiveDoubleClickMs,
  getSystemAccessibility,
  onSystemAccessibility,
  resolveAccessibility,
  systemFromMedia,
  type SystemAccessibility,
} from "./services/accessibility";
import { BUILT_IN_PRESETS, applyLayoutValues, layoutValues } from "./layout/presets";
import { appTransferRegistry } from "./transfer/TransferRegistry";
import { setUiZoom } from "./services/appearance";
import { archiveCreate } from "./services/archiveCreate";
import { errorCode, errorText } from "./services/errors";
import { closeExtraView, openExtraView } from "./services/extraViews";
import { probeMedia } from "./services/mediaEngine";
import { createMediaRecipeDraft } from "./media-edit/MediaDraft";
import { newRecipeProjectId } from "./media-edit/recipeCodec";
import { mediaSourceForProbe } from "./media-edit/sources";
import { importAllMediaSubtitles } from "./media-edit/subtitles";
import { newMediaId, newMediaRecipe } from "./media-edit/types";
import { projectFromMediaSource, timelineFileName } from "./timeline/projectCodec";
import { emptyTimelineProject, encodeTimelineProject } from "./timeline/projectValidation";
import { newUuid, TIMELINE_HANDLER_ID } from "./timeline/types";
import RecoveryDialog from "./recovery/RecoveryDialog";
import SafeModeBanner from "./recovery/SafeModeBanner";
import DiagnosticsDialog from "./diagnostics/DiagnosticsDialog";
import ToastStack, { type ToastData } from "./components/Toast";
import {
  createDiagnostics,
  editDiagnostics,
  closeDiagnostics,
  openProblemPage,
  saveDiagnostics,
  type DiagnosticsSession,
} from "./services/diagnostics";
import {
  discardReviewedRecovery,
  loadRecoveryAtStartup,
  openReviewedRecovery,
  shouldShowRecovery,
  type StartupRecovery,
} from "./services/recoveryRestore";
import { importLegacyRecovery } from "./services/recovery";
import {
  registerRestartGuard,
  restartNormally,
  safeModeStatus,
  type SafeModeStatus,
} from "./services/safeMode";
import { pickSavePath, saveText } from "./services/textFiles";
import { getShelf, patchShelf, type ShelfCatalog, type ShelfPatch } from "./services/shelf";
import { runShelfAction, type ShelfActionHost } from "./shelf/shelfActions";
import { isShelfToggleShortcut } from "./shelf/shelfValidation";
import ShelfPanel from "./shelf/ShelfPanel";
import AssistantPanel from "./assistant/AssistantPanel";
import FilesInUseDialog from "./locks/FilesInUseDialog";
import CompressDialog from "./archive/CompressDialog";
import QuickConvertDialog from "./convert/QuickConvertDialog";
import { convertersForInputs } from "./convert/convertOptions";
import { QUICK_CONVERT_CONVERTERS, registerEngineConverters } from "./convert/registry";
import { engineCapabilities } from "./services/engines";
import PrivacyDialog from "./privacy/PrivacyDialog";
import TransferHost, { startHostedTransfer } from "./transfers/TransferHost";
import { LayoutContext } from "./layout/LayoutContext";
import TabStrip from "./layout/TabStrip";
import { useTitlebarDragRegion } from "./layout/useTitlebarDragRegion";
import TabContextMenu from "./layout/TabContextMenu";
import {
  COMMAND_LAYOUT_ADAPTER,
  applyKeyboardWithHistory,
  applyToolbarWithHistory,
  customizeHistoryRegistry,
  registerCustomizeHistory,
  type CustomizeHistoryHost,
} from "./layout/customizeHistory";
import { TOOLBAR_DESCRIPTORS } from "./layout/toolbarDescriptors";
import { ToolbarCustomSettingsProvider } from "./layout/ToolbarCustomContext";
import { homeSections, statusFields } from "./shell/registries";
import { registerBuiltInHomeProviders } from "./shell/homeProviders";
import StatusFieldHost from "./shell/StatusFieldHost";
import {
  validateToolbarCustomSettings,
  type ToolbarCustomSettings,
} from "./services/commandLayout";
import { defaultShortcutBindings, keyboardPreset, type KeyboardPresetId } from "./keyboard/presets";
import {
  COPY_TO_FOLDER_COMMAND,
  FOCUS_FILTER_COMMAND,
  MOVE_TO_FOLDER_COMMAND,
  NAVIGATION_DIRECTIONS,
  isBuiltinMapId,
  type KeyboardCustomSettings,
  type KeyboardHost,
  type KeyboardMap,
  type ShortcutBinding,
  type ShortcutScope,
} from "./keyboard/types";
import { KeyboardRouter } from "./keyboard/KeyboardRouter";
import { ShortcutResolutionProvider } from "./keyboard/shortcutDisplay";
import { saveKeyboardMap, validateKeyboardMap } from "./services/keyboardMaps";
import { CommandRegistry, isCommandEnabled, type Command } from "./commands/registry";
import { CommandPalette } from "./palette/CommandPalette";
import { PaletteRegistry } from "./palette/PaletteRegistry";
import {
  commandPaletteProvider,
  descriptorPaletteProvider,
  helpPaletteProvider,
  settingsPaletteProvider,
} from "./palette/paletteEntries";
import type { PaletteHost } from "./palette/types";
import { KeyTipsContext } from "./ribbon/keyTips";
import IconButton from "./components/IconButton";
import Button from "./components/Button";
import Dialog from "./components/Dialog";
import TextInput from "./components/TextInput";
import { applyLanguage } from "./i18n";
import {
  defaultSettings,
  isTauriRuntime,
  loadSettings,
  saveSettings,
  type AppSettings,
  type ThemeSettings,
} from "./services/settings";
import { formatSize } from "./services/format";
import { handlers } from "./handlers";
import { setDocumentEditorAppHost } from "./office/document/documentCommands";
import { planOpen, type OpenDecision } from "./handlers/openPipeline";
import {
  displayPath,
  explorerStateGet,
  fsStat,
  listRecentItems,
  openItem,
  parentPathOf,
  pathsForClipboard,
  shareItems,
} from "./services/explorer";
import { folderViewKey } from "./services/folderViews";
import {
  ensureDefaultTags,
  reconcileTagMirrors,
  registerTagHistory,
  registerTagIdentityBridge,
} from "./services/tags";
import { listHelp } from "./services/help";
import {
  buildSavedGroup,
  exportSavedGroups,
  importSavedGroups,
  listSavedGroups,
  pickSavedGroupsImport,
  removeSavedGroup,
  savedGroupHistory,
  savedGroupHistoryEntry,
  writeSavedGroup,
  type SavedGroupCatalog,
  type SavedTabDescriptor,
} from "./services/savedGroups";
import {
  activateTab,
  closeTab as closeTabState,
  initialTabs,
  mountedFileTabs,
  newTabId,
  openFileTab,
  openFileTabResult,
  openSingleTab,
  sessionFromTabs,
  setTabPath,
  setTabView,
  tabsFromSession,
  type FolderTabState,
  type TabKind,
  type TabState,
  type TabsState,
} from "./services/tabs";
import {
  MAX_TABS,
  closeTabRecording,
  closedTabsOf,
  duplicateTab,
  mruCycleTarget,
  openFolderTab,
  pinTab,
  reopenClosedTab,
} from "./services/tabActions";
import {
  GROUP_COLORS,
  addTabsToGroup,
  createTabGroup,
  normalizeTabGroups,
  patchTabGroup,
  removeTabsFromGroup,
  ungroupTabGroup,
  type GroupColor,
  type TabGroup,
} from "./services/tabGroups";
import { closeTabGroup, saveAndCloseTabGroup } from "./services/tabGroupActions";
import { recordGroupChange } from "./services/tabGroupHistory";
import { MAX_TOTAL_TABS, isEligibleGroupMember } from "./services/tabGroupValidation";
import { TAB_HISTORY_ADAPTER_ID, TabHistory } from "./services/tabHistory";
import { UiHistoryRegistry } from "./services/uiHistory";
import { appUndoStack, type FileAction } from "./services/undo";
import { decodeViewState } from "./services/viewState";
import { restoreSplitTab, SplitOpenBudget } from "./services/splitRestore";
import {
  activeSplitLeaf,
  closeSplitSide as closeSplitSideInState,
  isSplitTab,
  newSplitViewId,
  restoreSplit,
  serializeSplit,
  setSplitDirection,
  setSplitLeaf,
  setSplitState,
  setSplitSyncScroll,
  splitLeafOf,
  splitTabTitle,
  swapSplitSides,
  viewIdentityOf,
  type SplitLeaf,
  type SplitSide,
} from "./services/splitViews";
import { createSplit } from "./services/splitActions";
import SplitTabView, {
  splitLeafTab,
  splitPartnerFor,
  withSplitLeafFolder,
  withSplitLeafPath,
  withSplitLeafView,
} from "./tabs/SplitTabView";
import { defaultFolderTabState } from "./services/folderState";
import { activationReady, onOpenRequest, type ActivationRequest } from "./services/activation";
import {
  confirmResidentClose,
  residentStatus,
  setTrayLabels,
  showResidentWindow,
  type ResidentCloseReason,
} from "./services/resident";
import { createSessionSaver, loadSession, startupReady } from "./services/sessions";
import { resolveTabKey } from "./services/tabKeyRouting";
import { VIEW_MODE_COMMANDS, viewModeShortcut } from "./commands/explorerCommands";
import { routeFileDrop, type DropDestination } from "./transfer/tabDropRouting";
import type { ArchiveExtractRequest } from "./services/archive";
import TabGroupMenu from "./tabs/TabGroupMenu";
import SavedGroupsPanel from "./tabs/SavedGroupsPanel";
import { restoreSavedGroup } from "./tabs/restoreSavedGroup";
import ExplorerHome, {
  type ExplorerNavigateRequest,
  type ExplorerPaletteBridge,
  type ExplorerStats,
  type ExplorerViewModeRequest,
} from "./views/ExplorerHome";
import type { ExplorerExtractRequest } from "./views/explorer/useArchiveExtract";
import FileTabView from "./views/FileTabView";
import FolderTabView from "./views/folders/FolderTabView";
import { useUnsavedChanges } from "./views/useUnsavedChanges";
import { useLockedFolderHost } from "./locked/useLockedFolderHost";
import { LOCKED_TEXT_HANDLER_ID } from "./documents/LockedDocumentProvider";
import { DocumentRegistry } from "./documents/DocumentRegistry";
import type { DocumentHandle, DocumentRef } from "./documents/types";
import type { LockedSession } from "./services/lockedFolders";
import { setDeckEditorHost } from "./office/deck/deckCommands";
import { registerOfficeEditorControllers } from "./office/officeHost";
const GalleryView = lazy(() => import("./views/GalleryView"));
const HelpCenter = lazy(() => import("./views/HelpCenter"));
const SettingsView = lazy(() => import("./views/SettingsView"));

const SESSION_KEY = "adperastra-session";
// Office editing factories are trusted static registrations (Steps 20a/21a/
// 22a), registered once when the app module loads, never by a mounted view.
registerOfficeEditorControllers();
const DEFAULT_SYSTEM_ACCESSIBILITY: SystemAccessibility = {
  forced_colors: false,
  reduced_motion: false,
  text_scale: 1,
  double_click_ms: 500,
  generation: 0,
};
const HELP_SLUGS: Record<TabKind, string> = {
  explorer: "browsing-folders",
  settings: "the-settings-page",
  help: "using-help",
  gallery: "using-help",
  file: "opening-files",
  folder: "browsing-folders",
  split: "split-view",
};

/** The view ids a whole-tab close must decide: both leaves of a split,
 * otherwise the tab's stable view identity (a promoted survivor keeps its
 * leaf view id). */
function viewIdsOf(tab: TabState): string[] {
  return isSplitTab(tab) ? [tab.split.first.view_id, tab.split.second.view_id] : [viewIdentityOf(tab)];
}

/** F1 and the title bar's Help button follow the active side of a split
 * (Step 09i D4); every other tab keeps its 09a rule. */
function helpSlugForTab(tab: TabState | undefined, explorerSlug: string): string {
  if (!tab) return explorerSlug;
  if (tab.kind === "file") {
    return (tab.handler ? handlers.get(tab.handler)?.helpSlug : undefined) ?? "opening-files";
  }
  if (tab.kind === "split") {
    const leaf = activeSplitLeaf(tab);
    const handler = leaf?.kind === "file" && leaf.handler ? handlers.get(leaf.handler) : undefined;
    return handler?.helpSlug ?? HELP_SLUGS.split;
  }
  if (tab.kind === "explorer") return explorerSlug;
  return HELP_SLUGS[tab.kind];
}

/** The palette's only registry: disabled entries stay in the catalog only
 * while Settings > Command palette says to show them. */
class VisiblePaletteRegistry extends PaletteRegistry {
  constructor(private readonly showDisabled: () => boolean) { super(); }
  async collect() {
    const entries = await super.collect();
    return this.showDisabled() ? entries : entries.filter((entry) => entry.enabled);
  }
}

interface PaletteLocation { id: string; title: string; description: string }

/** Locked container identity: case-insensitive, ignoring the `\\?\` prefix. */
function sameLockedPath(left: string, right: string): boolean {
  return (
    left.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase() ===
    right.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase()
  );
}

function safeDisplayName(path: string): string {
  const plain = displayPath(path).replace(/\\+$/, "");
  return plain.split("\\").filter(Boolean).pop() ?? plain;
}

/** Which active scope a registered command's default shortcut serves
 * (Step 10b D6/D8). Unknown owners stay global, as before. */
function shortcutScopeFor(commandId: string): ShortcutScope {
  if (commandId.startsWith("explorer.")) return "explorer";
  if (commandId.startsWith("search.")) return "search";
  if (commandId.startsWith("editor.")) return "text";
  if (commandId.startsWith("pdf.")) return "pdf";
  if (commandId.startsWith("media.")) return "media";
  return "global";
}

const TAB_CYCLE_COMMAND_ID = "tabs.cycle";
const TAB_CYCLE_PREVIOUS_COMMAND_ID = "tabs.cyclePrevious";
const TAB_SHORTCUT_COMMANDS: readonly Command<unknown>[] = [
  {
    id: TAB_CYCLE_COMMAND_ID,
    labelKey: "palette.tabs",
    icon: PanelsTopLeft,
    shortcut: "Ctrl+Tab",
    risk: "read-only",
    helpSlug: "working-with-tabs",
    enabledWhen: () => true,
    run: () => undefined,
  },
  {
    id: TAB_CYCLE_PREVIOUS_COMMAND_ID,
    labelKey: "palette.tabs",
    icon: PanelsTopLeft,
    shortcut: "Ctrl+Shift+Tab",
    risk: "read-only",
    helpSlug: "working-with-tabs",
    enabledWhen: () => true,
    run: () => undefined,
  },
];
const TAB_SHORTCUT_BINDINGS = defaultShortcutBindings(TAB_SHORTCUT_COMMANDS, () => "global");

/** The map the router actually runs (Step 10b P6): the active stored map,
 * or its builtin preset generated from the registered commands' defaults.
 * Tab cycling is a window action, so it is added when the map has no
 * binding for it. */
function routerKeyboardMap(
  custom: KeyboardCustomSettings,
  defaults: readonly ShortcutBinding[],
): KeyboardMap {
  const map = isBuiltinMapId(custom.active_map)
    ? keyboardPreset(custom.active_map.slice("builtin:".length) as KeyboardPresetId, defaults)
    : custom.custom_maps.find((entry) => entry.id === custom.active_map) ??
      keyboardPreset("windows", defaults);
  const bound = new Set(map.bindings.map((binding) => binding.command_id));
  const additions = TAB_SHORTCUT_BINDINGS.filter((binding) => !bound.has(binding.command_id));
  return additions.length > 0 ? { ...map, bindings: [...map.bindings, ...additions] } : map;
}

/** Scopes of the visible tab surface, most specific first. A focused
 * viewer keeps its own scope; settings and help only have window actions. */
function tabShortcutScopes(tab: TabState | undefined): ShortcutScope[] {
  if (!tab) return [];
  if (tab.kind === "explorer" || tab.kind === "folder") return ["explorer"];
  let handler: string | undefined;
  if (tab.kind === "file") handler = tab.handler;
  if (tab.kind === "split") {
    const leaf = activeSplitLeaf(tab);
    if (leaf?.kind === "folder") return ["explorer"];
    if (leaf?.kind === "file") handler = leaf.handler;
  }
  if (handler === "text" || handler === "markdown") return ["text"];
  if (handler === "image" || handler === "image-project") return ["image"];
  if (handler === "pdf") return ["pdf"];
  if (handler === "media") return ["media"];
  if (handler?.startsWith("office-")) return ["office"];
  return [];
}

/** One bounded snapshot per palette opening: pinned and recent folders,
 * then the recent-file list. No file is touched or stat'ed here. */
async function paletteLocations(): Promise<{ folders: PaletteLocation[]; files: PaletteLocation[] }> {
  if (!isTauriRuntime()) return { folders: [], files: [] };
  const [state, recent] = await Promise.allSettled([explorerStateGet(), listRecentItems(200)]);
  const folders: PaletteLocation[] = [];
  const files: PaletteLocation[] = [];
  const seenFolders = new Set<string>();
  const addFolder = (path: string) => {
    const key = folderViewKey(path);
    if (!key || seenFolders.has(key)) return;
    seenFolders.add(key);
    folders.push({ id: path, title: safeDisplayName(path), description: displayPath(path) });
  };
  if (state.status === "fulfilled") {
    for (const path of state.value.pinned_folders) addFolder(path);
    for (const path of state.value.recent_folders) addFolder(path);
  }
  const seenFiles = new Set<string>();
  if (recent.status === "fulfilled") {
    for (const item of recent.value) {
      if (item.kind === "folder") { addFolder(item.path); continue; }
      if (item.kind !== "file") continue;
      const key = folderViewKey(item.path);
      if (!key || seenFiles.has(key)) continue;
      seenFiles.add(key);
      files.push({ id: item.path, title: item.name, description: displayPath(item.path) });
    }
  }
  const folderEntries = folders.slice(0, 500);
  return { folders: folderEntries, files: files.slice(0, 500 - folderEntries.length) };
}

async function paletteHelpEntries(locale: string) {
  const [localized, english] = await Promise.all([listHelp(locale), listHelp("en")]);
  const titles = new Map(english.map((page) => [page.slug, page.title] as const));
  return localized.map((page) => ({ ...page, english_title: titles.get(page.slug) ?? page.title }));
}

async function paletteSavedGroups() {
  if (!isTauriRuntime()) return [];
  const catalog = await listSavedGroups();
  return catalog.groups.map((group) => ({ id: group.id, title: group.name }));
}

// Dev/screenshot aid: ?view=gallery|settings|help opens that tab at startup.
function requestedView(): TabState | null {
  try {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "gallery" || v === "settings" || v === "help") {
      return { id: v, kind: v };
    }
  } catch {
    /* no URL available */
  }
  return null;
}

/** Native shelf patches persist disk references only; keep the in-memory
 * locked-folder references the user still sees (Step 09g). */
function mergeShelfCatalog(
  current: ShelfCatalog,
  next: ShelfCatalog,
  patch: ShelfPatch,
): ShelfCatalog {
  const removed = patch.kind === "remove" ? new Set(patch.ids) : null;
  const virtual =
    patch.kind === "clear"
      ? []
      : current.items.filter(
          (item) =>
            item.runtime_sensitive &&
            !(removed?.has(item.id) ?? false) &&
            !next.items.some((kept) => kept.id === item.id),
        );
  return { ...next, items: [...next.items, ...virtual] };
}

/** The legacy theme attributes still provide the non-whitelisted tokens
 * (shadows) for a custom theme, so every layer starts from a built-in one. */
function legacyThemeFor(theme: ThemeSettings, runtime: ThemeRuntime): ThemeSettings {
  const builtin = runtime.applied.kind === "builtin" ? runtime.applied.id : null;
  return {
    ...theme,
    mode: runtime.scheme,
    light_theme:
      runtime.scheme === "light"
        ? ((builtin ?? "light") as ThemeSettings["light_theme"])
        : theme.light_theme,
    dark_theme:
      runtime.scheme === "dark"
        ? ((builtin ?? "dark") as ThemeSettings["dark_theme"])
        : theme.dark_theme,
  };
}

/** Surfaces a chosen accent must stay readable against (root tokens). */
function activeSurfaceColors(root: HTMLElement): string[] {
  const fallback = ["#FFFFFF", "#F3F3F3", "#202020"];
  if (typeof getComputedStyle !== "function") return fallback;
  const style = getComputedStyle(root);
  const colors = [
    "--adp-color-surface-window",
    "--adp-color-surface-chrome",
    "--adp-color-surface-sidebar",
  ]
    .map((name) => style.getPropertyValue(name).trim())
    .filter((value) => /^#[0-9a-f]{6}$/i.test(value));
  return colors.length > 0 ? colors : fallback;
}

/** Trusted CSS rows of the applied custom theme, one element per document. */
function ensureCustomThemeStyle(css: string): void {
  let element = document.querySelector<HTMLStyleElement>("style[data-adp-custom-theme]");
  if (!element) {
    element = document.createElement("style");
    element.dataset.adpCustomTheme = "true";
    document.head.appendChild(element);
  }
  if (element.textContent !== css) element.textContent = css;
}

function clearCustomThemeStyle(): void {
  document.querySelector("style[data-adp-custom-theme]")?.remove();
}

export default function App() {
  useTitlebarDragRegion();
  const { t, i18n } = useTranslation();

  // Tauri's isolation frame (R-SEC) is invisible: hide it from assistive
  // technology and give it a name, as every frame needs one.
  useEffect(() => {
    const frame = document.getElementById("__tauri_isolation__");
    if (!frame) return;
    frame.setAttribute("title", t("window.securityFrame"));
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
  }, [t, i18n.language]);
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
  const [systemAccessibility, setSystemAccessibility] = useState<SystemAccessibility>(
    DEFAULT_SYSTEM_ACCESSIBILITY,
  );
  const effectiveAccessibility = useMemo(() => {
    try {
      return resolveAccessibility(
        settings.accessibility,
        settings.appearance.ui_scale,
        systemAccessibility,
      );
    } catch {
      return resolveAccessibility(
        defaultAccessibilitySettings(),
        100,
        DEFAULT_SYSTEM_ACCESSIBILITY,
      );
    }
  }, [settings.accessibility, settings.appearance.ui_scale, systemAccessibility]);
  const announcementQueueRef = useRef<AnnouncementQueue | null>(null);
  if (announcementQueueRef.current === null) announcementQueueRef.current = new AnnouncementQueue();
  // Click-pick uses the one 09c registry; drop targets register themselves,
  // so the list is read live when the command runs.
  const pickControllerRef = useRef<ClickPickDropController | null>(null);
  if (pickControllerRef.current === null) {
    pickControllerRef.current = new ClickPickDropController({
      registry: appTransferRegistry,
      // The active Explorer registers this folder target while a pick runs;
      // an unregistered id simply offers no actions.
      targetIds: () => [PICK_DROP_TARGET_ID],
    });
  }
  const [pickActive, setPickActive] = useState(false);
  const [pickDropOpen, setPickDropOpen] = useState(false);
  // Focus layout is a temporary preset overlay; leaving it restores the
  // exact layout values that were active on entry (D10).
  const [focusLayoutActive, setFocusLayoutActive] = useState(false);
  const focusLayoutBefore = useRef<ReturnType<typeof layoutValues> | null>(null);
  const [shelfCatalog, setShelfCatalog] = useState<ShelfCatalog | null>(null);
  const shelfRef = useRef<ShelfCatalog | null>(null);
  shelfRef.current = shelfCatalog;
  const [compressSources, setCompressSources] = useState<string[] | null>(null);
  const [privacyInputs, setPrivacyInputs] = useState<ConversionInput[] | null>(null);
  const [convertInputs, setConvertInputs] = useState<ConversionInput[] | null>(null);
  const [lockPaths, setLockPaths] = useState<string[] | null>(null);
  const [tabsState, setTabsState] = useState<TabsState>(() => initialTabs());
  const { tabs, activeId } = tabsState;
  const [navigateRequest, setNavigateRequest] = useState<ExplorerNavigateRequest | null>(null);
  const [viewModeRequest, setViewModeRequest] = useState<ExplorerViewModeRequest | null>(null);
  const [conversionRequest, setConversionRequest] = useState<ConversionOpenRequest | null>(null);
  const [extractRequest, setExtractRequest] = useState<ExplorerExtractRequest | null>(null);
  const [helpSlug, setHelpSlug] = useState("getting-started");
  const [showKeyTips, setShowKeyTips] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [explorerPath, setExplorerPath] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<{ tab: TabState; anchor: { x: number; y: number } } | null>(null);
  const maximizeRef = useRef<HTMLButtonElement | null>(null);
  const [explorerStats, setExplorerStats] = useState<ExplorerStats>({ total: 0, selected: 0, selectedBytes: 0, selectedFiles: 0, selectedPaths: [], viewMode: null, helpSlug: "browsing-folders" });
  const readyRef = useRef(false);
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;
  const sessionSaverRef = useRef<ReturnType<typeof createSessionSaver> | null>(null);
  if (sessionSaverRef.current === null) sessionSaverRef.current = createSessionSaver();
  // One two-open budget for the whole window: normal tabs and split leaves
  // take their restore slots from the same instance (Step 09i D7).
  const splitBudgetRef = useRef<SplitOpenBudget | null>(null);
  if (splitBudgetRef.current === null) splitBudgetRef.current = new SplitOpenBudget();
  // Unsaved changes are keyed by the view identity (a promoted survivor
  // keeps its leaf view id), so split leaves join the same dialog.
  const unsavedViews = useMemo(() => {
    const views: TabState[] = [];
    for (const tab of tabs) {
      if (tab.kind === "file") {
        views.push(tab.content_view_id !== undefined ? { ...tab, id: tab.content_view_id } : tab);
      } else if (isSplitTab(tab)) {
        for (const leaf of [tab.split.first, tab.split.second]) {
          if (leaf.kind === "file") views.push({ id: leaf.view_id, kind: "file", title: leaf.title });
        }
      }
    }
    return views;
  }, [tabs]);
  const unsaved = useUnsavedChanges(unsavedViews);

  // Recovery, safe mode and diagnostics (Step 09h). Every destructive
  // action here names exact record ids from the reviewed list; restore and
  // discard never guess a record from a path or a time.
  const [recovery, setRecovery] = useState<StartupRecovery | null>(null);
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryCopyPath, setRecoveryCopyPath] = useState<string | null>(null);
  const [diagnosticsSession, setDiagnosticsSession] = useState<DiagnosticsSession | null>(null);
  const [safeMode, setSafeMode] = useState<SafeModeStatus | null>(null);
  const [safeModeBusy, setSafeModeBusy] = useState(false);
  const [safeModeError, setSafeModeError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  // Tab groups and saved groups (Step 09b). Live groups travel inside
  // `TabsState.groups`; the dialogs and the catalog stay here.
  const [groupDialog, setGroupDialog] = useState<
    { mode: "create"; tabIds: string[] } | { mode: "edit"; groupId: string } | null
  >(null);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState<GroupColor>("purple");
  const [groupError, setGroupError] = useState("");
  const [groupMenu, setGroupMenu] = useState<{ groupId: string; anchor: DOMRect } | null>(null);
  const [savedGroupsOpen, setSavedGroupsOpen] = useState(false);
  const [savedCatalog, setSavedCatalog] = useState<SavedGroupCatalog | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | undefined>(undefined);
  const savedReservations = useRef(new Map<string, string[]>());
  const restoreHistoryHost = useRef<((state: unknown) => void) | null>(null);

  // Day/night custom appearances (Step 10a): the schedule is runtime state,
  // the catalog is loaded only for the themes the settings reference.
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [customThemeSummaries, setCustomThemeSummaries] = useState<CustomThemeSummary[]>([]);
  const [customCatalogReady, setCustomCatalogReady] = useState(false);
  const [themeEditorDraft, setThemeEditorDraft] = useState<CustomTheme | null>(null);
  const [themeBackground, setThemeBackground] = useState<{
    token: string;
    name: string;
    assetId: string;
  } | null>(null);
  const customThemesRef = useRef<CustomTheme[]>([]);
  customThemesRef.current = customThemes;
  const systemDarkRef = useRef(systemDark);
  systemDarkRef.current = systemDark;
  const previousCustomThemeRef = useRef<CustomTheme | null>(null);
  const schedule = useThemeSchedule({ settings: settings.theme_custom });
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const runtime = useMemo(
    () =>
      resolveTheme(
        settings.theme_custom,
        THEMES,
        customThemes,
        systemDark,
        schedule.minute,
        schedule.override,
      ),
    [settings.theme_custom, customThemes, systemDark, schedule.minute, schedule.override],
  );
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const appliedCustomThemeId =
    runtime.applied.kind === "custom" ? runtime.applied.id : null;
  const appliedCustomTheme = appliedCustomThemeId
    ? customThemes.find((theme) => theme.id === appliedCustomThemeId) ?? null
    : null;

  const applyVisual = useCallback(async (next: AppSettings) => {
    const root = document.documentElement;
    const dark = systemDarkRef.current;
    const activeCustomThemes = customThemesRef.current;
    const scheduleState = scheduleRef.current;
    const resolved = resolveTheme(
      next.theme_custom,
      THEMES,
      activeCustomThemes,
      dark,
      scheduleState.minute,
      scheduleState.override,
    );
    const resolvedCustomId = resolved.applied.kind === "custom" ? resolved.applied.id : null;
    const customTheme = resolvedCustomId
      ? activeCustomThemes.find((theme) => theme.id === resolvedCustomId) ?? null
      : null;

    // 1. A built-in layer always runs first; a custom theme then overrides
    // the whitelisted tokens inline and keeps the built-in shadows. Clearing
    // the old custom layer restores its pre-custom snapshot, so it must run
    // before the new built-in attributes are written.
    if (customTheme) {
      applyThemeAttributes(root, legacyThemeFor(next.theme, resolved), dark);
      applyCustomThemeAttributes(root, customTheme);
      ensureCustomThemeStyle(customThemeCss(customTheme));
    } else {
      const previous = previousCustomThemeRef.current;
      if (previous) clearCustomThemeAttributes(root, previous);
      clearCustomThemeStyle();
      applyThemeAttributes(root, legacyThemeFor(next.theme, resolved), dark);
    }
    previousCustomThemeRef.current = customTheme;

    // 2. Density, radius, motion and zoom stay the existing appearance layer.
    applyAppearanceAttributes(root, next.appearance);
    void setUiZoom(next.appearance.ui_scale).catch(() => undefined);
    await applyLanguage(next.language);
    // Step 16: the tray is native and its labels are already translated.
    // Sending them on every language application creates the one tray on
    // the first send and replaces only its menu labels afterwards.
    if (isTauriRuntime()) {
      const tr = i18n.getFixedT(next.language);
      void setTrayLabels({
        open: tr("resident.open"),
        turn_off: tr("resident.disable"),
        quit: tr("resident.quit"),
      }).catch(() => undefined);
    }

    // 3. The native material adapter records what the PC accepted before the
    // next resolve reads `data-material-support`. High contrast stays solid.
    const forcedColors =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(forced-colors: active)").matches;
    const requestedMaterial = forcedColors ? "solid" : customTheme?.material ?? "solid";
    void applyThemeMaterial(requestedMaterial).catch(() => {
      root.dataset.material = "solid";
    });

    // 4. Accent choice, then the readable per-type overrides. Design accents
    // are CSS variables and cannot be measured here; explicit colours can.
    let accent = "var(--adp-accent-explorer)";
    if (next.theme.accent_source === "custom") {
      accent = next.theme.accent_custom ?? "#0067C0";
    } else if (next.theme.accent_source === "windows" && isTauriRuntime()) {
      try {
        const value = (await invoke("get_windows_accent")) as unknown as string | null;
        if (value) accent = value;
      } catch {
        accent = "var(--adp-accent-explorer)";
      }
    }
    const typeAccents = next.theme_custom.type_accents;
    const surfaces = activeSurfaceColors(root);
    if (typeAccents.explorer) {
      const readable = resolveReadableAccent(typeAccents.explorer, surfaces);
      root.style.setProperty("--adp-accent-current", readable.accent);
      root.style.setProperty("--adp-color-text-on-accent", readable.on_accent);
    } else {
      root.style.removeProperty("--adp-color-text-on-accent");
      if (accent.startsWith("#")) {
        const readable = resolveReadableAccent(accent, surfaces);
        root.style.setProperty("--adp-accent-current", readable.accent);
        if (next.theme.accent_source === "custom") {
          root.style.setProperty("--adp-color-text-on-accent", readable.on_accent);
        }
      } else {
        root.style.setProperty("--adp-accent-current", accent);
      }
    }
    for (const id of THEME_CANONICAL_TYPE_IDS) {
      const variable = `--adp-accent-${id}`;
      const color = typeAccents[id];
      if (color) {
        root.style.setProperty(variable, resolveReadableAccent(color, surfaces).accent);
      } else if (!customTheme) {
        // A custom theme already wrote its own token; do not erase it.
        root.style.removeProperty(variable);
      }
    }
  }, [i18n]);

  // The custom theme's own background image, if it has one, is a leased
  // owned asset; the root layer shows it behind the shell.
  const backgroundAssetId = appliedCustomTheme?.background?.asset_id;
  useEffect(() => {
    setThemeBackground(null);
    if (!backgroundAssetId || !isTauriRuntime()) return;
    let cancelled = false;
    let token: string | null = null;
    void leaseThemeBackground(backgroundAssetId)
      .then((asset) => {
        if (cancelled) {
          void revokeThemeBackground(asset.token).catch(() => undefined);
          return;
        }
        token = asset.token;
        setThemeBackground({ token: asset.token, name: asset.name, assetId: backgroundAssetId });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (token) void revokeThemeBackground(token).catch(() => undefined);
    };
  }, [backgroundAssetId]);

  const themeBackgroundStyle = useMemo<CSSProperties | null>(() => {
    const definition = appliedCustomTheme?.background;
    if (!themeBackground || !definition) return null;
    if (themeBackground.assetId !== definition.asset_id) return null;
    return {
      position: "fixed",
      inset: 0,
      zIndex: 0,
      pointerEvents: "none",
      opacity: definition.opacity,
      filter: definition.blur_px > 0 ? `blur(${definition.blur_px}px)` : undefined,
      backgroundImage: `url("${fileUrl(themeBackground.token, themeBackground.name)}")`,
      backgroundSize:
        definition.fit === "fit" ? "contain" : definition.fit === "tile" ? "auto" : "cover",
      backgroundRepeat: definition.fit === "tile" ? "repeat" : "no-repeat",
      backgroundPosition: "center",
    };
  }, [appliedCustomTheme, themeBackground]);

  // Tags (Step 11b): one Undo adapter for the whole window, one guarded
  // identity bridge, and one reconciliation for a crashed or rebuilt index.
  // A failed batch never changes the native store; the next assignment read
  // is authoritative.
  useEffect(() => {
    registerTagHistory();
  }, []);

  // Optional engine packs (Step 12b): the converters become selectable only
  // after the native side reports the verified `media.encode` capability. A
  // missing pack leaves them declared but disabled, never half-working.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void engineCapabilities()
      .then((capabilities) => {
        if (!cancelled) registerEngineConverters(capabilities);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void registerTagIdentityBridge()
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    void reconcileTagMirrors().catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const applySettings = useCallback(
    (next: AppSettings) => {
      const normalized: AppSettings = {
        ...next,
        theme: { ...next.theme, accent_custom: next.theme.accent_custom ?? "#0067C0" },
      };
      setSettings(normalized);
      void applyVisual(normalized);
      void saveSettings(normalized).catch(() => undefined);
    },
    [applyVisual],
  );

  // The Explorer's view options; stable, so the command list isn't rebuilt
  // on every render.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const readNamesAloudRef = useRef<ReadNamesAloud | null>(null);
  if (readNamesAloudRef.current === null) {
    readNamesAloudRef.current = new ReadNamesAloud(() => settingsRef.current.accessibility);
  }

  // Step 10b T5: toolbar and keyboard changes enter the one UI history.
  const applySettingsRef = useRef(applySettings);
  applySettingsRef.current = applySettings;
  const customizeHistoryHost = useMemo<CustomizeHistoryHost>(
    () => ({
      getToolbar: () => settingsRef.current.toolbar_custom,
      applyToolbar: async (value) => {
        // Keep the ref current so a second Apply cannot save an older section.
        settingsRef.current = { ...settingsRef.current, toolbar_custom: value };
        applySettingsRef.current(settingsRef.current);
      },
      getKeyboard: () => settingsRef.current.keyboard_custom,
      applyKeyboard: async (value) => {
        settingsRef.current = { ...settingsRef.current, keyboard_custom: value };
        applySettingsRef.current(settingsRef.current);
      },
    }),
    [],
  );
  useEffect(() => {
    if (!UiHistoryRegistry.hasAdapter(COMMAND_LAYOUT_ADAPTER)) {
      registerCustomizeHistory(UiHistoryRegistry, customizeHistoryHost);
    }
  }, [customizeHistoryHost]);

  /** History records still referenced by the shared Undo stack. */
  const retainedUiIds = useCallback(() => {
    const ids: string[] = [];
    for (const entry of appUndoStack.retainedEntries) {
      for (const action of [entry.undo, entry.redo]) {
        if (action.type === "uiState") ids.push(action.id);
      }
    }
    return ids;
  }, []);

  /** Apply the toolbar draft as one Undo entry (D4). */
  const applyToolbarCustom = useCallback(
    async (value: ToolbarCustomSettings) => {
      const validated = validateToolbarCustomSettings(value);
      const id = await applyToolbarWithHistory(
        customizeHistoryRegistry,
        customizeHistoryHost,
        validated,
        retainedUiIds(),
      );
      appUndoStack.push({
        labelKey: "toolbarCustom.title",
        undo: { type: "uiState", id, reverse: true } satisfies FileAction,
        redo: { type: "uiState", id, reverse: false } satisfies FileAction,
      });
    },
    [customizeHistoryHost, retainedUiIds],
  );

  /** Save the normalized map, then apply the builtin/custom flow as one
   * Undo entry (E4/D9): a builtin only becomes `active_map`; a custom map
   * replaces its own entry and becomes active. */
  const applyKeyboardCustom = useCallback(
    async (map: KeyboardMap) => {
      const normalized = isTauriRuntime() ? await saveKeyboardMap(map) : validateKeyboardMap(map);
      const current = settingsRef.current.keyboard_custom;
      const next: KeyboardCustomSettings = isBuiltinMapId(normalized.id)
        ? { ...current, active_map: normalized.id }
        : {
            ...current,
            active_map: normalized.id,
            custom_maps: [
              ...current.custom_maps.filter((entry) => entry.id !== normalized.id),
              normalized,
            ],
          };
      const id = await applyKeyboardWithHistory(
        customizeHistoryRegistry,
        customizeHistoryHost,
        next,
        retainedUiIds(),
      );
      appUndoStack.push({
        labelKey: "keyboard.title",
        undo: { type: "uiState", id, reverse: true } satisfies FileAction,
        redo: { type: "uiState", id, reverse: false } satisfies FileAction,
      });
    },
    [customizeHistoryHost, retainedUiIds],
  );

  const notify = useCallback((message: string) => {
    setToasts((list) => [...list.slice(-2), { id: Date.now(), message }]);
  }, []);

  /** Catalog summaries and the full records the settings currently reference
   * (never all 100 at startup). A failed read leaves the previous list. */
  const refreshCustomThemes = useCallback(async (config: ThemeCustomSettings) => {
    if (!isTauriRuntime()) return customThemesRef.current;
    let summaries: CustomThemeSummary[];
    try {
      summaries = await listCustomThemes();
    } catch {
      return customThemesRef.current;
    }
    setCustomThemeSummaries(summaries);
    setCustomCatalogReady(true);
    const ids = [
      ...new Set(
        [config.day, config.night]
          .filter((ref) => ref.kind === "custom")
          .map((ref) => ref.id),
      ),
    ];
    const loaded = await Promise.all(
      ids.map((id) => readCustomTheme(id).catch(() => null)),
    );
    const themes = loaded.filter((theme): theme is CustomTheme => theme !== null);
    customThemesRef.current = themes;
    setCustomThemes(themes);
    return themes;
  }, []);

  const saveThemeFromEditor = useCallback(
    async (theme: CustomTheme) => {
      const saved = await saveCustomTheme(theme);
      setThemeEditorDraft(saved);
      await refreshCustomThemes(settingsRef.current.theme_custom);
    },
    [refreshCustomThemes],
  );

  const openThemeEditor = useCallback(async () => {
    const current = runtimeRef.current;
    if (current.applied.kind === "custom") {
      const loaded = await readCustomTheme(current.applied.id).catch(() => null);
      if (loaded) {
        setThemeEditorDraft(loaded);
        return;
      }
    }
    setThemeEditorDraft(createCustomTheme(t("themeEditor.new"), current.scheme));
  }, [t]);

  const toggleDayNight = useCallback(() => {
    const current = scheduleRef.current;
    current.setOverride(
      current.override !== null
        ? null
        : runtimeRef.current.scheme === "light"
          ? "dark"
          : "light",
    );
  }, []);

  const themeFeatureActions = useMemo(
    () => ({
      editTheme: () => {
        void openThemeEditor();
      },
      toggleDayNight,
    }),
    [openThemeEditor, toggleDayNight],
  );

  // A referenced custom theme id changes when it is picked in Settings; the
  // catalog follows, and the resolver shows a warning for a missing one.
  const dayNightKey = `${settings.theme_custom.day.kind}:${settings.theme_custom.day.id}|${settings.theme_custom.night.kind}:${settings.theme_custom.night.id}`;
  useEffect(() => {
    void refreshCustomThemes(settingsRef.current.theme_custom);
  }, [dayNightKey, refreshCustomThemes]);

  useEffect(() => {
    void applyVisual(settingsRef.current);
  }, [applyVisual, schedule.scheme, schedule.override, customThemes, systemDark]);

  const warnedThemeRef = useRef("");
  useEffect(() => {
    if (!customCatalogReady) return;
    const missing = runtime.warning_codes.find(
      (code) => code === "theme.missing_custom" || code === "theme.missing_builtin",
    );
    if (!missing || warnedThemeRef.current === missing) return;
    warnedThemeRef.current = missing;
    notify(t(`errors.${missing}`));
  }, [runtime.warning_codes, notify, t, customCatalogReady]);

  // Step 09b: the App owns every live group change. Each one is recorded
  // as a bounded session descriptor on the window's one Undo stack, then
  // applied; history records no longer referenced are released.
  useEffect(() => {
    restoreHistoryHost.current = (state: unknown) => {
      const next = tabsFromSession(state, handlers.list().map((handler) => handler.id));
      tabsRef.current = next;
      setTabsState(next);
    };
    if (!UiHistoryRegistry.hasAdapter(TAB_HISTORY_ADAPTER_ID)) {
      UiHistoryRegistry.registerAdapter(TAB_HISTORY_ADAPTER_ID, {
        validate: (state) =>
          state !== null && typeof state === "object" && Array.isArray((state as { tabs?: unknown }).tabs),
        apply: async (state) => {
          restoreHistoryHost.current?.(state);
        },
      });
    }
  }, []);

  const releaseGroupHistory = useCallback(() => {
    const uiIds: string[] = [];
    const savedIds: string[] = [];
    const collect = (action: FileAction) => {
      if (action.type === "uiState") uiIds.push(action.id);
      else if (action.type === "savedGroups") savedIds.push(action.id);
      else if (action.type === "sequence") action.actions.forEach(collect);
    };
    for (const entry of appUndoStack.retainedEntries) {
      collect(entry.undo);
      collect(entry.redo);
    }
    TabHistory.releaseUnreferenced(uiIds);
    savedGroupHistory.releaseUnreferenced(savedIds);
  }, []);

  // A push from any feature (a file operation trims the shared stack too)
  // drops entries; free the bounded group records they referenced before
  // the next group change needs that capacity (D9).
  useEffect(() => {
    appUndoStack.onTrim = releaseGroupHistory;
    return () => {
      if (appUndoStack.onTrim === releaseGroupHistory) appUndoStack.onTrim = undefined;
    };
  }, [releaseGroupHistory]);

  /** Apply one already-validated group state with Undo (D9). */
  const applyGroupState = useCallback(
    (after: TabsState, labelKey: string) => {
      const before = tabsRef.current;
      // Free any records trimmed by earlier non-group actions before this
      // new record has to fit in the bounded history.
      releaseGroupHistory();
      const entry = recordGroupChange(before, after, labelKey);
      appUndoStack.push(entry);
      tabsRef.current = after;
      setTabsState(after);
      releaseGroupHistory();
      notify(t(labelKey));
    },
    [notify, releaseGroupHistory, t],
  );

  const changeGroup = useCallback(
    (reduce: (state: TabsState) => TabsState) => {
      try {
        applyGroupState(reduce(tabsRef.current), "toast.groupChanged");
      } catch {
        notify(t("errors.groups.invalid"));
      }
    },
    [applyGroupState, notify, t],
  );

  /** The tab a group command acts on: the active one when eligible, else
   * the most recently active eligible tab (the Explorer tab never joins). */
  const groupTargetTab = useCallback((): TabState | undefined => {
    const state = tabsRef.current;
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    if (active && isEligibleGroupMember(active)) return active;
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const tab = state.tabs.find((candidate) => candidate.id === state.history[index]);
      if (tab && isEligibleGroupMember(tab)) return tab;
    }
    return undefined;
  }, []);

  /** Reload the reviewed recovery list; ids come only from this answer. */
  const refreshRecovery = useCallback(async () => {
    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      setRecovery(await loadRecoveryAtStartup());
      return true;
    } catch (error) {
      setRecoveryError(errorCode(error) || "recovery.io");
      return false;
    } finally {
      setRecoveryLoading(false);
    }
  }, []);

  /** The app.recovery command: look again, then show the same review dialog. */
  const openRecovery = useCallback(() => {
    setRecoveryCopyPath(null);
    setRecoveryVisible(true);
    void refreshRecovery();
  }, [refreshRecovery]);

  /** The app.reportProblem command: gather a local session, then review it. */
  const reportProblem = useCallback(() => {
    void (async () => {
      try {
        const handle = await createDiagnostics({
          include_dumps: settingsRef.current.recovery.diagnostics_include_dumps,
          include_paths: false,
        });
        setDiagnosticsSession(await handle.completion);
      } catch (error) {
        notify(errorText(t, error, "diagnostics"));
      }
    })();
  }, [notify, t]);

  /** Restart normally only after the same dirty-close decision as closing. */
  const restartApp = useCallback(() => {
    setSafeModeBusy(true);
    setSafeModeError(null);
    void restartNormally()
      .catch((error: unknown) => {
        // The user cancelled the dirty-close question; stay in safe mode.
        if (errorCode(error) !== "app.close_cancelled") {
          setSafeModeError(errorText(t, error, "safe_mode"));
        }
      })
      .finally(() => setSafeModeBusy(false));
  }, [t]);

  const onShelfToggle = useCallback(() => {
    const current = settingsRef.current;
    applySettings({ ...current, shelf: { ...current.shelf, visible: !current.shelf.visible } });
  }, [applySettings]);
  const onViewChange = useCallback(
    (patch: Partial<AppSettings["explorer"]>) =>
      applySettings({ ...settingsRef.current, explorer: { ...settingsRef.current.explorer, ...patch } }),
    [applySettings],
  );

  // Command palette (Step 09d): one host and one open state for the window.
  // The Explorer publishes its live command registry and context through
  // `explorerPalette`; the palette itself has no shortcut listener.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const openCommandPalette = useCallback(() => setPaletteOpen(true), []);
  // Every mounted Explorer publishes its bridge under its tab id; the
  // palette always uses the active tab's registry and selection.
  const paletteBridges = useRef(new Map<string, ExplorerPaletteBridge>());
  const [paletteBridgeVersion, setPaletteBridgeVersion] = useState(0);
  // Settings > Keyboard shortcuts starts its presets from the registered
  // commands' real defaults, not from an edited map or a hand-kept list.
  const registeredCommands = useMemo(() => {
    const byId = new Map<string, Command>();
    for (const bridge of paletteBridges.current.values()) {
      for (const command of bridge.registry.list()) byId.set(command.id, command);
    }
    return [...byId.values()];
    // A bridge publish bumps the version, so newly mounted tabs are seen.
  }, [paletteBridgeVersion]);
  const commandLabels = useMemo<Readonly<Record<string, string>>>(() => {
    const labels: Record<string, string> = {};
    for (const command of registeredCommands) labels[command.id] = t(command.labelKey);
    return labels;
  }, [registeredCommands, t]);
  const keyboardDefaults = useMemo(
    () => defaultShortcutBindings(registeredCommands, shortcutScopeFor),
    [registeredCommands],
  );
  // Step 10b: the map the router runs, shared with every shortcut display
  // (tooltips, menus, ribbons and the palette) through one provider.
  const activeKeyboardMap = useMemo(
    () => routerKeyboardMap(settings.keyboard_custom, keyboardDefaults),
    [settings.keyboard_custom, keyboardDefaults],
  );
  const publishExplorerPalette = useCallback((owner: string, bridge: ExplorerPaletteBridge | null) => {
    const current = paletteBridges.current;
    if (bridge !== null) {
      if (current.get(owner) === bridge) return;
      current.set(owner, bridge);
    } else {
      if (!current.has(owner)) return;
      current.delete(owner);
    }
    setPaletteBridgeVersion((value) => value + 1);
  }, []);
  const explorerPalette = paletteBridges.current.get(activeId) ?? null;
  const [paletteRegistry] = useState(
    () => new VisiblePaletteRegistry(() => settingsRef.current.palette.show_disabled),
  );
  const paletteShortcut = useMemo<Command<undefined>[]>(
    () => [{
      id: "app.commandPalette",
      labelKey: "palette.title",
      icon: Search,
      shortcut: "Ctrl+K",
      risk: "read-only",
      helpSlug: "command-palette",
      enabledWhen: () => true,
      run: openCommandPalette,
    }],
    [openCommandPalette],
  );
  // Step 10b P6: one window router. The host reads the active map, the
  // visible tab's scopes and the active Explorer bridge; it rechecks live
  // enablement at dispatch (contract U1). The old per-area default listeners
  // (palette, Explorer static keys, Ctrl+Tab) now come through here.
  const keyboardHost = useMemo<KeyboardHost>(() => {
    const activeBridge = () =>
      paletteBridges.current.get(tabsRef.current.activeId) ?? null;
    const activeTabState = () => {
      const state = tabsRef.current;
      return state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
    };
    const isTypingElement = (target: EventTarget | null): boolean => {
      const element = target instanceof HTMLElement ? target : null;
      return (
        element !== null &&
        (element.tagName === "INPUT" ||
          element.tagName === "TEXTAREA" ||
          element.tagName === "SELECT" ||
          element.isContentEditable ||
          element.closest('input, textarea, select, [contenteditable="true"]') !== null)
      );
    };
    const commandFor = (id: string): Command<unknown> | undefined => {
      const bridge = activeBridge();
      // A dialog owns the keyboard: only the window actions that already
      // worked behind dialogs (palette and tab cycling) stay reachable.
      if (
        document.querySelector("[role='dialog']") &&
        id !== "app.commandPalette" &&
        id !== TAB_CYCLE_COMMAND_ID &&
        id !== TAB_CYCLE_PREVIOUS_COMMAND_ID
      ) {
        return undefined;
      }
      if (id === TAB_CYCLE_COMMAND_ID || id === TAB_CYCLE_PREVIOUS_COMMAND_ID) {
        // Text fields and editors keep Ctrl+Tab with the field (as the old
        // tab router did); the chord is consumed without switching tabs.
        return isTypingElement(document.activeElement)
          ? undefined
          : TAB_SHORTCUT_COMMANDS.find((command) => command.id === id);
      }
      if (id === "app.commandPalette") {
        return (bridge?.registry.get(id) ?? paletteShortcut[0]) as unknown as Command<unknown>;
      }
      return bridge?.registry.get(id) as unknown as Command<unknown> | undefined;
    };
    const dispatch = (id: string): void => {
      if (id === TAB_CYCLE_COMMAND_ID || id === TAB_CYCLE_PREVIOUS_COMMAND_ID) {
        const direction = id === TAB_CYCLE_COMMAND_ID ? 1 : -1;
        setTabsState((current) => {
          const target = mruCycleTarget(current, direction);
          return target ? activateTab(current, target) : current;
        });
        return;
      }
      if (id === "app.commandPalette") {
        openCommandPalette();
        return;
      }
      activeBridge()?.dispatchCommand(id);
    };
    return {
      activeScopes: () => {
        const bridge = activeBridge();
        const scopes: ShortcutScope[] = [];
        if (document.querySelector("[role='dialog']")) {
          scopes.push("dialog");
        } else {
          const surface = bridge?.shortcutScopes?.() ?? tabShortcutScopes(activeTabState());
          const focused = document.activeElement;
          if (
            !surface.includes("search") &&
            focused instanceof Element &&
            focused.closest('[role="combobox"]')
          ) {
            scopes.push("search");
          }
          scopes.push(...surface);
        }
        scopes.push("global");
        return [...new Set(scopes)];
      },
      isTypingTarget: isTypingElement,
      command: commandFor,
      isEnabled: (id) => {
        if (id === TAB_CYCLE_COMMAND_ID || id === TAB_CYCLE_PREVIOUS_COMMAND_ID) return true;
        if (id === "app.commandPalette") return true;
        if (NAVIGATION_DIRECTIONS[id] !== undefined || id === FOCUS_FILTER_COMMAND) return true;
        const bridge = activeBridge();
        if (!bridge) return id !== COPY_TO_FOLDER_COMMAND && id !== MOVE_TO_FOLDER_COMMAND;
        const command = bridge.registry.get(id);
        return command ? isCommandEnabled(command, bridge.commandContext()) : true;
      },
      dispatch,
      showDisabled: (id) => {
        const bridge = activeBridge();
        const command = bridge?.registry.get(id);
        const context = bridge?.commandContext();
        const reason =
          command && context
            ? command.pending
              ? "commands.comingLater"
              : command.disabledReasonKey?.(context) ?? "palette.disabled"
            : "palette.disabled";
        notify(t(reason, { label: command ? t(command.labelKey) : "" }));
      },
      navigate: (direction) => activeBridge()?.navigate?.(direction),
      focusFilter: () => activeBridge()?.focusFilter?.(),
      copyToFolder: async () => dispatch(COPY_TO_FOLDER_COMMAND),
      moveToFolder: async () => dispatch(MOVE_TO_FOLDER_COMMAND),
    };
  }, [notify, openCommandPalette, paletteShortcut, t]);

  useEffect(() => {
    const router = new KeyboardRouter(keyboardHost);
    router.setMap(activeKeyboardMap);
    const onKey = (event: KeyboardEvent) => {
      if (router.handle(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      router.dispose();
    };
  }, [activeKeyboardMap, keyboardHost]);

  // MRU ids are stored only after CommandPalette awaited a successful
  // dispatch; a failed or disabled action never reaches this callback.
  const onPaletteUsed = useCallback((id: string) => {
    const current = settingsRef.current;
    const recent_ids = [id, ...current.palette.recent_ids.filter((item) => item !== id)].slice(0, 50);
    applySettings({ ...current, palette: { ...current.palette, recent_ids } });
  }, [applySettings]);

  // Where the toolbar, the tabs and the panes go (Step 05c).
  const onLayoutChange = useCallback(
    (layout: AppSettings["layout"]) => applySettings({ ...settingsRef.current, layout }),
    [applySettings],
  );

  // The My templates folder (Step 06c).
  const onTemplatesFolderChange = useCallback(
    async (folder: string) => {
      const saved = await saveSettings({
        ...settingsRef.current,
        templates: { ...settingsRef.current.templates, my_folder: folder },
      });
      // A rejected save leaves the current folder in memory and on screen.
      settingsRef.current = { ...settingsRef.current, templates: saved.templates };
      setSettings(settingsRef.current);
    },
    [],
  );
  const onGallerySettingsChange = useCallback(
    async (gallery: AppSettings["gallery"]) => {
      const saved = await saveSettings({
        ...settingsRef.current,
        gallery,
      });
      settingsRef.current = { ...settingsRef.current, gallery: saved.gallery };
      setSettings(settingsRef.current);
    },
    [],
  );
  // Indexed folders (Step 11a): the indexing window edits the stored search
  // settings through the same save path as every other settings section.
  const onSearchSettingsChange = useCallback(
    (search: AppSettings["search"]) => {
      applySettings({ ...settingsRef.current, search });
    },
    [applySettings],
  );
  // Background folder sizes (Step 11c): the command and Settings controls
  // share the ordinary settings save path.
  const onFolderSizesChange = useCallback(
    (folder_sizes: AppSettings["folder_sizes"]) => {
      applySettings({ ...settingsRef.current, folder_sizes });
    },
    [applySettings],
  );
  const layoutValue = useMemo(() => ({ layout: settings.layout, onLayoutChange }), [settings.layout, onLayoutChange]);

  // Effective accessibility (Step 10f): the stored preferences plus the
  // Windows snapshot decide focus width, target size, motion and zoom.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getSystemAccessibility()
      .then((value) => {
        if (!cancelled) setSystemAccessibility(value);
      })
      .catch(() => undefined);
    void onSystemAccessibility((value) => {
      if (!cancelled) setSystemAccessibility(value);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    const forced = window.matchMedia("(forced-colors: active)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMedia = () =>
      setSystemAccessibility((current) =>
        systemFromMedia(current, {
          forcedColors: forced.matches,
          reducedMotion: reduced.matches,
        }),
      );
    forced.addEventListener?.("change", onMedia);
    reduced.addEventListener?.("change", onMedia);
    return () => {
      cancelled = true;
      unlisten?.();
      forced.removeEventListener?.("change", onMedia);
      reduced.removeEventListener?.("change", onMedia);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const effective = effectiveAccessibility;
    root.dataset.accessibilityFocus = String(effective.settings.focus_px);
    root.dataset.accessibilityTargets = String(effective.target_px);
    root.dataset.accessibilityCursor = effective.settings.cursor;
    if (effective.settings.dyslexic_font) root.dataset.accessibilityFont = "dyslexic";
    else delete root.dataset.accessibilityFont;
    if (effective.reduce_motion) root.dataset.accessibilityMotion = "reduced";
    else delete root.dataset.accessibilityMotion;
    root.style.setProperty("--adp-a11y-target-px", `${effective.target_px}px`);
    root.style.setProperty(
      "--adp-a11y-letter-spacing",
      `${effective.settings.letter_spacing_em}em`,
    );
    root.style.setProperty(
      "--adp-a11y-word-spacing",
      `${effective.settings.word_spacing_em}em`,
    );
    root.style.setProperty("--adp-a11y-line-height", String(effective.settings.line_height));
    void setUiZoom(effective.effective_zoom).catch(() => undefined);
  }, [effectiveAccessibility]);

  // The shelf lists references only; it never moves or deletes a file.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getShelf()
      .then(setShelfCatalog)
      .catch(() => setShelfCatalog(null));
  }, []);

  // No browser menu (Back, Refresh, Print...) anywhere in the app; text
  // boxes and help text keep their copy and paste menu.
  useEffect(() => {
    const onMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, .adp-help-body")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  const persistSession = useCallback(async () => {
    if (!readyRef.current) return;
    const data = sessionFromTabs(tabsRef.current, Math.floor(Date.now() / 1000));
    if (isTauriRuntime()) {
      // Writes are debounced; a clean close flushes the newest state.
      sessionSaverRef.current?.schedule(data);
      return;
    }
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable; session stays in memory.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadSettings();
      if (cancelled) return;
      setSettings(loaded);
      await applyVisual(loaded);
      // The seven reserved tags are stored once the profile and language are
      // ready; the service skips a name another tag already uses.
      if (isTauriRuntime()) {
        void ensureDefaultTags((key) => i18n.t(key)).catch(() => undefined);
      }
      let session: unknown = null;
      if (isTauriRuntime()) {
        try {
          session = await loadSession();
        } catch {
          session = null;
        }
      } else {
        try {
          const raw = window.localStorage.getItem(SESSION_KEY);
          session = raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
          session = null;
        }
      }
      if (cancelled) return;
      setTabsState(tabsFromSession(session, handlers.list().map((handler) => handler.id)));
      readyRef.current = true;
      if (isTauriRuntime()) {
        // Step 09h: the launch is ready after the first painted frame with
        // the restored tabs. A hidden resident start has no animation frame,
        // so a short fallback timer performs the same one-shot handshake; the
        // native side is idempotent and never downgrades a clean launch.
        let readyAnnounced = false;
        const announceReady = () => {
          if (readyAnnounced || cancelled) return;
          readyAnnounced = true;
          void startupReady().catch(() => undefined);
        };
        const readyFallback = window.setTimeout(announceReady, 250);
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            window.clearTimeout(readyFallback);
            announceReady();
          });
        }
        // Startup review: an unclean exit or a kept revision opens the same
        // dialog before the user reaches the restored originals.
        void loadRecoveryAtStartup()
          .then((startup) => {
            if (cancelled) return;
            setRecovery(startup);
            if (shouldShowRecovery(startup.page)) setRecoveryVisible(true);
          })
          .catch(() => undefined);
        void safeModeStatus()
          .then((status) => {
            if (!cancelled) setSafeMode(status);
          })
          .catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyVisual, i18n]);

  useEffect(() => {
    void persistSession();
  }, [tabs, activeId, persistSession]);

  useEffect(() => {
    return () => {
      void sessionSaverRef.current?.flush();
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setSystemDark(media.matches);
      if (settingsRef.current.theme.mode === "system") {
        void applyVisual(settingsRef.current);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [applyVisual]);

  const openTab = useCallback((kind: "explorer" | "help" | "settings" | "gallery", slug?: string) => {
    if (kind === "help" && slug) setHelpSlug(slug);
    setTabsState((current) => (kind === "explorer" ? activateTab(current, "explorer") : openSingleTab(current, kind)));
  }, []);

  // Settings palette entries scroll the already registered section into
  // view; the Settings page keeps its own layout and state. A fresh object
  // makes the same request run again while the page is already shown.
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<{ id: string } | null>(null);
  const openSettingsSection = useCallback((sectionId: string) => {
    setSettingsSectionRequest({ id: sectionId });
    openTab("settings");
  }, [openTab]);

  // --- Accessibility hosts (Step 10f T5) -------------------------------
  const readSelectionAloud = useCallback(
    (paths: readonly string[]) => {
      const names = paths
        .map((path) => path.split(/[\\/]/).filter(Boolean).pop() ?? path)
        .join(". ");
      if (names === "") return;
      void readNamesAloudRef.current?.read(names).catch((error: unknown) => {
        const code = errorCode(error);
        const key = code.startsWith("read_aloud.") ? `errors.${code}` : "errors.read_aloud.failed";
        announcementQueueRef.current?.announce(key, {}, "assertive", true);
        notify(errorText(t, error, "read_aloud"));
      });
    },
    [notify, t],
  );

  const pickSelection = useCallback(
    (paths: readonly string[]) => {
      const sources: DocumentRef[] = paths.map((path) => ({ kind: "disk", path }));
      void pickControllerRef.current
        ?.pick({ kind: "files", sources }, null)
        .then(() => {
          setPickDropOpen(false);
          setPickActive(true);
          announcementQueueRef.current?.announce("accessibility.pick", {}, "polite");
        })
        .catch((error: unknown) => notify(errorText(t, error, "transfer")));
    },
    [notify, t],
  );

  const cancelPick = useCallback(() => {
    setPickDropOpen(false);
    void pickControllerRef.current?.cancel().then(() => {
      setPickActive(false);
      announcementQueueRef.current?.announce("accessibility.cancelPick", {}, "polite");
    });
  }, []);

  // Clicking an eligible folder while a pick is active asks the normal 09c
  // operation choice before anything changes (Step 10f E4/T5).
  const requestPickDrop = useCallback(() => {
    const controller = pickControllerRef.current;
    if (controller?.getEnvelope() == null) return;
    // A folder that offers nothing (for example the sources' own folder)
    // shows no dialog at all.
    if (controller.targets().length === 0) return;
    setPickDropOpen(true);
  }, []);

  const choosePickAction = useCallback(
    async (actionId: string) => {
      try {
        await pickControllerRef.current?.drop(PICK_DROP_TARGET_ID, actionId);
        announcementQueueRef.current?.announce("accessibility.drop", {}, "polite");
      } catch (error) {
        notify(errorText(t, error, "transfer"));
      } finally {
        setPickDropOpen(false);
        setPickActive(false);
      }
    },
    [notify, t],
  );

  // Esc releases the lease with no file change; the choice dialog closes
  // through the same cancel path.
  useEffect(() => {
    if (!pickActive || pickDropOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      cancelPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickActive, pickDropOpen, cancelPick]);

  const toggleFocusLayout = useCallback(() => {
    const layout = settingsRef.current.layout;
    if (focusLayoutBefore.current !== null) {
      const previous = focusLayoutBefore.current;
      focusLayoutBefore.current = null;
      setFocusLayoutActive(false);
      onLayoutChange(applyLayoutValues(layout, previous));
      return;
    }
    focusLayoutBefore.current = layoutValues(layout);
    setFocusLayoutActive(true);
    onLayoutChange(applyLayoutValues(layout, BUILT_IN_PRESETS.minimal));
  }, [onLayoutChange]);

  // A picked lease is released by Esc, Cancel, an accepted drop or the next
  // pick; the native transfer registry expires stale leases when the window
  // closes.

  // --- Locked folders (Step 09k) ---------------------------------------
  /** Open or reuse one virtual tab for a container. The root entry id is
   * the opaque container id; navigation only replaces that entry id. */
  const openLockedTab = useCallback((locked: LockedSession) => {
    setTabsState((current) => {
      const existing = current.tabs.find(
        (tab) =>
          tab.kind === "file" &&
          tab.source?.kind === "virtual" &&
          tab.document_id !== "locked-virtual-file" &&
          tab.missing === undefined &&
          sameLockedPath(tab.source.container_path, locked.container_path),
      );
      if (existing) return activateTab(current, existing.id);
      const tab: TabState = {
        id: newTabId("file"),
        kind: "file",
        handler: LOCKED_TEXT_HANDLER_ID,
        title: t("locked.title"),
        source: {
          kind: "virtual",
          provider: "locked",
          container_path: locked.container_path,
          entry_id: locked.container_id,
        },
      };
      return activateTab({ ...current, tabs: [...current.tabs, tab] }, tab.id);
    });
  }, [t]);

  const openLockedEntry = useCallback((
    source: Extract<DocumentRef, { kind: "virtual" }>,
    entryId: string,
  ) => {
    setTabsState((current) => {
      const existing = current.tabs.find(
        (tab) =>
          tab.kind === "file" &&
          tab.source?.kind === "virtual" &&
          sameLockedPath(tab.source.container_path, source.container_path) &&
          tab.source.entry_id.toLowerCase() === entryId.toLowerCase(),
      );
      if (existing) return activateTab(current, existing.id);
      const tab: TabState = {
        id: newTabId("file"),
        kind: "file",
        handler: LOCKED_TEXT_HANDLER_ID,
        title: t("locked.title"),
        source: { ...source, entry_id: entryId },
        // Runtime marker: a file entry tab is not the container browser.
        document_id: "locked-virtual-file",
      };
      return activateTab({ ...current, tabs: [...current.tabs, tab] }, tab.id);
    });
  }, [t]);

  const navigateLockedTab = useCallback((tabId: string, entryId: string) => {
    setTabsState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId && tab.kind === "file" && tab.source?.kind === "virtual"
          ? { ...tab, document_id: undefined, source: { ...tab.source, entry_id: entryId } }
          : tab,
      ),
    }));
  }, []);

  const closeLockedTabs = useCallback((containerPath: string) => {
    const stale = tabsRef.current.tabs.filter(
      (tab) =>
        tab.kind === "file" &&
        tab.source?.kind === "virtual" &&
        sameLockedPath(tab.source.container_path, containerPath),
    );
    if (stale.length === 0) return;
    setTabsState((current) => {
      let next = current;
      for (const tab of stale) next = closeTabState(next, tab.id);
      return next;
    });
    unsaved.forget(stale.flatMap(viewIdsOf));
  }, [unsaved.forget]);

  const lockedHost = useLockedFolderHost({
    onOpenHelp: (slug) => openTab("help", slug),
    onOpenLockedTab: openLockedTab,
    onCreated: (result) => notify(t("locked.savedCopy", { path: result.path })),
    settings: settings.locked,
  });
  const lockedHostRef = useRef(lockedHost);
  lockedHostRef.current = lockedHost;
  const previousLockedSession = useRef<LockedSession | null>(null);
  useEffect(() => {
    const previous = previousLockedSession.current;
    previousLockedSession.current = lockedHost.session;
    // A lock started from a command leaves no live session; its virtual
    // tabs would only show stale content, so they close with it.
    if (previous && !lockedHost.session) closeLockedTabs(previous.container_path);
  }, [lockedHost.session, closeLockedTabs]);

  const handleLockedSessionChange = useCallback(
    (next: LockedSession) => {
      if (next.state === "locked") {
        lockedHostRef.current.forgetSession(next);
        closeLockedTabs(next.container_path);
        return;
      }
      if (next.state === "lock_pending") {
        lockedHostRef.current.showPending(next, t("errors.locked.lock_pending"));
        return;
      }
      lockedHostRef.current.setSession(next);
    },
    [closeLockedTabs, t],
  );

  /** Open the current Explorer folder in its own, independently
   * remembered folder tab (Step 09a E1). */
  const openFolderTabAt = useCallback((path: string | null) => {
    if (!path) return;
    setTabsState((current) => openFolderTab(current, defaultFolderTabState(path), false));
  }, []);

  const updateFolderTab = useCallback((id: string, folder: FolderTabState) => {
    setTabsState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              folder,
              path: folder.path,
              title: folder.path === "home" ? undefined : folder.path.split(/[\\/]/).filter(Boolean).pop() ?? folder.path,
            }
          : tab,
      ),
    }));
  }, []);

  const newTab = useCallback(
    (kind: "help" | "settings" | "gallery" | "folder" | "home") => {
      if (kind === "home") setTabsState(current => openFolderTab(current, defaultFolderTabState("home"), false));
      else if (kind === "folder") openFolderTabAt(explorerPath);
      else openTab(kind);
    },
    [explorerPath, openFolderTabAt, openTab],
  );

  /** The view ids a whole-tab close must decide come from `viewIdsOf`. */
  const closeTab = useCallback((id: string) => {
    const target = tabsRef.current.tabs.find((tab) => tab.id === id);
    if (!target) return;
    const ids = viewIdsOf(target);
    void unsaved.confirmClose(ids).then((proceed) => {
      if (!proceed) return;
      setTabsState((current) => closeTabRecording(current, id, Math.floor(Date.now() / 1000)));
      unsaved.forget(ids);
      // An in-memory recipe draft lives only with its tab.
      target.draft?.release();
      // Closing the last view of a container ends its live session, so the
      // keys cannot outlive every window that showed them.
      if (target.source?.kind === "virtual") {
        const container = target.source.container_path;
        const remaining = tabsRef.current.tabs.filter(
          (tab) =>
            tab.id !== target.id &&
            tab.source?.kind === "virtual" &&
            sameLockedPath(tab.source.container_path, container),
        );
        if (remaining.length === 0 && lockedHostRef.current.session) {
          void lockedHostRef.current.lockForClose();
        }
      }
    });
  }, [unsaved.confirmClose, unsaved.forget]);

  /** The active slide-deck tab, including the active leaf of a split. Only a
   * disk path is returned; a virtual or draft deck never invents one. */
  const activeDeckTarget = useCallback((): { tabId: string; path: string | null; title?: string } | null => {
    const state = tabsRef.current;
    const tab = state.tabs.find((entry) => entry.id === state.activeId) ?? state.tabs[0];
    if (!tab) return null;
    if (tab.kind === "file" && tab.handler === "office-slide") {
      return {
        tabId: tab.id,
        path: tab.source?.kind === "disk" ? tab.source.path : (tab.path ?? null),
        title: tab.title,
      };
    }
    if (isSplitTab(tab)) {
      const leaf = activeSplitLeaf(tab);
      if (leaf?.kind === "file" && leaf.handler === "office-slide") {
        return {
          tabId: tab.id,
          path: leaf.source?.kind === "disk" ? leaf.source.path : null,
          title: leaf.title ?? tab.title,
        };
      }
    }
    return null;
  }, []);

  const saveDeckCopy = useCallback(async () => {
    const target = activeDeckTarget();
    if (!target?.path) return;
    const name = target.title ?? target.path.split(/[\\/]/).filter(Boolean).pop() ?? "presentation.pptx";
    let handle: DocumentHandle | null = null;
    try {
      const destination = await pickSavePath(t("office.saveCopy"), name, t("editor.allFiles"));
      if (!destination) return;
      handle = await DocumentRegistry.acquire({ kind: "disk", path: target.path });
      if (!await handle.saveCopy(destination)) throw new Error("office_edit.unsupported");
    } catch (error) {
      notify(errorText(t, error, "office_edit"));
    } finally {
      handle?.release();
    }
  }, [activeDeckTarget, notify, t]);

  const copyDeckPath = useCallback(async () => {
    const target = activeDeckTarget();
    if (!target?.path) return;
    try {
      await navigator.clipboard.writeText(target.path);
    } catch {
      // Clipboard access can be refused; nothing was copied.
    }
  }, [activeDeckTarget]);

  // Step 22a: deck file/tab actions belong to the app host. New/open/image
  // pickers have no concrete API yet, so those buttons stay inert rather
  // than guessing a path; close, Save a copy and Copy path use the tab host.
  useEffect(() => {
    setDeckEditorHost({
      newDeck: () => undefined,
      openDeck: () => undefined,
      closeTab: () => {
        const target = activeDeckTarget();
        if (target) closeTab(target.tabId);
      },
      saveCopy: () => { void saveDeckCopy(); },
      copyPath: () => { void copyDeckPath(); },
      pickImage: async () => null,
    });
    return () => setDeckEditorHost(null);
  }, [activeDeckTarget, closeTab, copyDeckPath, saveDeckCopy]);

  // One dirty question at a time, shared by the normal close and the native
  // resident handshake so a repeated click cannot open a second dialog.
  const closePromptOpen = useRef(false);

  /** The title bar's close button and Windows' close request ask once for
   * every file and split leaf with unsaved changes (Step 06a). */
  const closeWindow = useCallback(async () => {
    if (closePromptOpen.current) return;
    closePromptOpen.current = true;
    try {
      const ids = tabsRef.current.tabs
        .filter((tab) => tab.kind === "file" || isSplitTab(tab))
        .flatMap(viewIdsOf);
      const proceed = await unsaved.confirmClose(ids);
      if (!proceed) return;
      // The clean close writes the newest tab state once, before the window goes.
      try {
        await sessionSaverRef.current?.flush();
      } catch {
        // Session persistence is best-effort; closing still proceeds.
      }
      if (!isTauriRuntime()) return;
      // Step 16: resident mode keeps the one window and lets the native
      // coordinator hide it. A pending foreground choice keeps it visible.
      const resident = await residentStatus().catch(() => null);
      if (resident?.enabled) {
        if (resident.state === "visible" || resident.state === "resident") {
          await confirmResidentClose("close").catch(() => undefined);
        }
        return;
      }
      // A live container must reach a verified lock (or its pending curtain)
      // before the window goes; closing must never drop dirty bytes.
      if (lockedHostRef.current.session) {
        const lockedClosed = await lockedHostRef.current.lockForClose();
        if (!lockedClosed) return;
      }
      try {
        await getCurrentWindow().destroy();
      } catch {
        // No Tauri window in a plain browser.
      }
    } finally {
      closePromptOpen.current = false;
    }
  }, [unsaved.confirmClose]);
  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;

  /** Step 16: tray Quit/Turn off and the native close hook ask the UI to run
   * the one normal 09a/09h dirty decision. Only an approved decision calls
   * the native confirmation; Cancel leaves the window and every tab as is. */
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const request = (reason: ResidentCloseReason) => {
      if (disposed || closePromptOpen.current) return;
      closePromptOpen.current = true;
      void (async () => {
        try {
          const ids = tabsRef.current.tabs
            .filter((tab) => tab.kind === "file" || isSplitTab(tab))
            .flatMap(viewIdsOf);
          const proceed = await unsaved.confirmClose(ids);
          if (!proceed || disposed) {
            // A cancelled tray close leaves the window shown; restore the
            // coordinator to Visible so the next X still asks first.
            if (!disposed) await showResidentWindow().catch(() => undefined);
            return;
          }
          try {
            await sessionSaverRef.current?.flush();
          } catch {
            // Session persistence is best-effort.
          }
          // Quit and turn off end the process; a live container must reach
          // a verified lock first. A plain hide keeps the tabs loaded.
          if (reason !== "close" && lockedHostRef.current.session) {
            const lockedClosed = await lockedHostRef.current.lockForClose();
            if (!lockedClosed || disposed) return;
          }
          if (disposed) return;
          await confirmResidentClose(reason).catch(() => undefined);
        } finally {
          closePromptOpen.current = false;
        }
      })();
    };
    void listen<{ reason?: unknown }>("resident-close-requested", (event) => {
      const reason = event.payload?.reason;
      if (reason === "close" || reason === "turn_off" || reason === "quit") {
        request(reason);
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [unsaved.confirmClose]);

  // Safe mode's Restart normally waits for this decision and the session
  // flush; a cancelled question keeps every view and never restarts.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    registerRestartGuard(async () => {
      const ids = tabsRef.current.tabs
        .filter((tab) => tab.kind === "file" || isSplitTab(tab))
        .flatMap(viewIdsOf);
      const proceed = await unsaved.confirmClose(ids);
      if (!proceed) return false;
      try {
        await sessionSaverRef.current?.flush();
      } catch {
        // Session persistence is best-effort; an accepted restart proceeds.
      }
      return true;
    });
    return () => registerRestartGuard(null);
  }, [unsaved.confirmClose]);

  /** Reopen the newest closed tab through the normal open pipeline. */
  const reopenLastClosed = useCallback(() => {
    const closed = closedTabsOf(tabsRef.current).at(-1);
    if (!closed) return;
    if (closed.tab.kind === "split" && closed.tab.split) {
      // A reopened split gets fresh leaf view ids; its files mount through
      // the normal viewer pipeline and take slots from the shared budget.
      try {
        const saved = serializeSplit(closed.tab.split);
        if (!saved) return;
        const restored = restoreSplit(saved);
        setTabsState((current) =>
          reopenClosedTab(current, {
            ...closed,
            tab: { ...closed.tab, split: restored, title: splitTabTitle(restored) },
          }),
        );
      } catch {
        // A split the session codecs no longer accept is not reopened.
      }
      return;
    }
    if (closed.tab.kind === "file" && closed.tab.path) {
      void planOpen(closed.tab.path, handlers, settingsRef.current.open.open_with)
        .then((decision) => {
          if (decision.kind !== "tab") return;
          // Revalidate the handler; never reuse an old grant.
          const reopened = {
            ...closed,
            tab: { ...closed.tab, handler: decision.handler.id, title: decision.info.name },
          };
          setTabsState((current) => reopenClosedTab(current, reopened));
        })
        .catch(() => undefined);
      return;
    }
    setTabsState((current) => reopenClosedTab(current, closed));
  }, []);

  // --- Tab groups and saved groups (Step 09b) ---------------------------

  const appendRestoredTab = useCallback(
    (tab: TabState, background: boolean, reservationId: string): string => {
      const current = tabsRef.current;
      const withTab: TabsState = { ...current, tabs: [...current.tabs, tab] };
      const next = background ? withTab : activateTab(withTab, tab.id);
      tabsRef.current = next;
      setTabsState(next);
      savedReservations.current.get(reservationId)?.push(tab.id);
      return tab.id;
    },
    [],
  );

  /** A saved position whose file or handler is unavailable: the tab stays
   * visible as a Locate placeholder (09a missing reason). */
  const missingRestoredTab = useCallback(
    (descriptor: SavedTabDescriptor, reason: "not_found" | "handler_missing" | "locked"): TabState => {
      const tab: TabState = {
        id: newTabId("file"),
        kind: "file",
        handler: descriptor.handler,
        title: descriptor.title,
        path: descriptor.path,
        missing: { reason, original_path: descriptor.path },
      };
      if (descriptor.source !== undefined) tab.source = descriptor.source;
      return tab;
    },
    [],
  );

  /** Open one saved split side through the normal pipeline; unavailable
   * sides become their own missing leaf instead of dropping the other. */
  const openSavedLeaf = useCallback(async (leaf: SplitLeaf): Promise<SplitLeaf> => {
    if (leaf.kind === "folder") {
      return leaf.folder ? leaf : { ...leaf, missing: { reason: "not_found" } };
    }
    const source = leaf.source;
    if (!source) return { ...leaf, missing: { reason: "not_found" } };
    if (source.kind === "virtual") {
      return { ...leaf, missing: { reason: "locked", original_path: source.container_path } };
    }
    if (source.kind !== "disk" || !leaf.handler || !handlers.get(leaf.handler)) {
      return { ...leaf, missing: { reason: "handler_missing" } };
    }
    try {
      const decision = await planOpen(source.path, handlers, settingsRef.current.open.open_with);
      if (decision.kind !== "tab") return { ...leaf, missing: { reason: "handler_missing" } };
      return { ...leaf, handler: decision.handler.id, title: leaf.title ?? decision.info.name };
    } catch {
      return { ...leaf, missing: { reason: "not_found", original_path: source.path } };
    }
  }, []);

  /** The coordinator's GroupRestoreHost (09b E6): reservation, per-member
   * normal-pipeline open, one atomic commit, exact rollback. */
  const restoreHost = useMemo(
    () => ({
      getState: () => tabsRef.current,
      reserve: async (count: number) => {
        if (tabsRef.current.tabs.length + count > MAX_TOTAL_TABS) throw new Error("groups.limit");
        const id = globalThis.crypto?.randomUUID?.() ?? `restore-${Date.now()}-${Math.random()}`;
        savedReservations.current.set(id, []);
        return id;
      },
      open: async (descriptor: SavedTabDescriptor, background: boolean, reservationId: string) => {
        if (descriptor.kind === "folder") {
          const folder = descriptor.folder ?? defaultFolderTabState(descriptor.path ?? "");
          const current = tabsRef.current;
          const before = new Set(current.tabs.map((tab) => tab.id));
          const next = openFolderTab(current, folder, background);
          const created = next.tabs.find((tab) => !before.has(tab.id));
          if (!created) throw new Error("groups.limit");
          tabsRef.current = next;
          setTabsState(next);
          savedReservations.current.get(reservationId)?.push(created.id);
          return created.id;
        }
        if (descriptor.kind === "split") {
          if (!descriptor.split) throw new Error("tabs.handler_missing");
          const result = await restoreSplitTab(
            { kind: "split", split: descriptor.split },
            { openLeaf: openSavedLeaf },
            { budget: splitBudgetRef.current ?? undefined },
          );
          if (!result) throw new Error("tabs.handler_missing");
          return appendRestoredTab(result.tab, background, reservationId);
        }
        if (descriptor.source?.kind === "virtual") {
          return appendRestoredTab(missingRestoredTab(descriptor, "locked"), background, reservationId);
        }
        if (descriptor.handler !== undefined && !handlers.get(descriptor.handler)) {
          return appendRestoredTab(
            missingRestoredTab(descriptor, "handler_missing"),
            background,
            reservationId,
          );
        }
        const path =
          descriptor.path ?? (descriptor.source?.kind === "disk" ? descriptor.source.path : undefined);
        if (!path) throw new Error("tabs.handler_missing");
        try {
          // Normal and split restores take their open slots from the one
          // window budget (Step 09i D7).
          const plan = () => planOpen(path, handlers, settingsRef.current.open.open_with);
          const decision = splitBudgetRef.current ? await splitBudgetRef.current.run(plan) : await plan();
          if (decision.kind !== "tab") throw new Error("tabs.handler_missing");
          const tab: TabState = {
            id: newTabId("file"),
            kind: "file",
            handler: decision.handler.id,
            title: descriptor.title ?? decision.info.name,
            path,
          };
          if (descriptor.source?.kind === "disk") tab.source = descriptor.source;
          if (descriptor.view !== undefined) {
            const decoded = decodeViewState(
              decision.handler.id,
              descriptor.view as Parameters<typeof decodeViewState>[1],
              descriptor.view_version,
            );
            if (decoded !== null) {
              tab.view = decoded;
              tab.view_version = descriptor.view_version;
            }
          }
          return appendRestoredTab(tab, background, reservationId);
        } catch (error) {
          const code =
            typeof error === "string" ? error : error instanceof Error ? error.message : "";
          if (code.startsWith("tabs.") || code.startsWith("groups.")) throw error;
          return appendRestoredTab(missingRestoredTab(descriptor, "not_found"), background, reservationId);
        }
      },
      commit: async (group: TabGroup, activeId: string, reservationId: string) => {
        const current = tabsRef.current;
        const members = new Set(group.tab_ids);
        const tabs = current.tabs.map((tab) =>
          members.has(tab.id) ? { ...tab, group_id: group.id } : tab,
        );
        const next = activateTab(
          normalizeTabGroups({
            ...current,
            tabs,
            groups: [...(current.groups ?? []).filter((entry) => entry.id !== group.id), group],
          }),
          activeId,
        );
        applyGroupState(next, "toast.groupChanged");
        savedReservations.current.delete(reservationId);
      },
      rollback: async (reservationId: string) => {
        const ids = savedReservations.current.get(reservationId) ?? [];
        savedReservations.current.delete(reservationId);
        if (ids.length === 0) return;
        let next = tabsRef.current;
        for (const id of ids) next = closeTabState(next, id);
        tabsRef.current = next;
        setTabsState(next);
      },
    }),
    [appendRestoredTab, applyGroupState, missingRestoredTab, openSavedLeaf],
  );

  const reloadSavedGroups = useCallback(async () => {
    setSavedLoading(true);
    setSavedError(undefined);
    try {
      setSavedCatalog(
        isTauriRuntime()
          ? await listSavedGroups()
          : { schema_version: 1, groups: [], revision: 1 },
      );
    } catch (error) {
      setSavedError(errorCode(error) || "groups.io");
    } finally {
      setSavedLoading(false);
    }
  }, []);

  const openSavedGroups = useCallback(() => {
    setSavedGroupsOpen(true);
    void reloadSavedGroups();
  }, [reloadSavedGroups]);

  /** Palette, navigation pane and home rows all reopen through this one
   * owner; the restore host does the capacity and dirty handling. */
  const openSavedGroupById = useCallback(
    async (id: string) => {
      const catalog = await listSavedGroups();
      const saved = catalog.groups.find((group) => group.id === id);
      if (!saved) throw new Error("groups.changed");
      await restoreSavedGroup(saved, restoreHost);
      setSavedGroupsOpen(false);
    },
    [restoreHost],
  );

  const recordSavedCatalog = useCallback(
    (before: SavedGroupCatalog, after: SavedGroupCatalog) => {
      // The catalog write already succeeded; make room for its undo
      // record before creating it, then release whatever the push trims.
      releaseGroupHistory();
      try {
        appUndoStack.push(savedGroupHistoryEntry(before, after, "toast.groupSaved"));
      } catch {
        // A full history must not hide a catalog write that already succeeded.
      }
      releaseGroupHistory();
      setSavedCatalog(after);
      notify(t("toast.groupSaved"));
    },
    [notify, releaseGroupHistory, t],
  );

  const renameSavedGroup = useCallback(
    async (id: string, name: string) => {
      if (!savedCatalog) throw new Error("groups.changed");
      const saved = savedCatalog.groups.find((group) => group.id === id);
      if (!saved) throw new Error("groups.changed");
      const cleaned = name.trim();
      if ([...cleaned].length < 1 || [...cleaned].length > 60) {
        throw new Error("groups.invalid");
      }
      const after = await writeSavedGroup({
        expected_revision: savedCatalog.revision,
        group: { ...saved, name: cleaned, modified_unix: Math.floor(Date.now() / 1000) },
      });
      recordSavedCatalog(savedCatalog, after);
    },
    [recordSavedCatalog, savedCatalog],
  );

  const removeSavedGroupFromCatalog = useCallback(
    async (id: string) => {
      if (!savedCatalog) throw new Error("groups.changed");
      const after = await removeSavedGroup(id, savedCatalog.revision);
      recordSavedCatalog(savedCatalog, after);
    },
    [recordSavedCatalog, savedCatalog],
  );

  const saveGroupToCatalog = useCallback(
    async (groupId: string) => {
      const catalog = await listSavedGroups();
      const state = tabsRef.current;
      const group = (state.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) throw new Error("tabs.invalid_group");
      const existing = catalog.groups.find((entry) => entry.name === group.name);
      const saved = buildSavedGroup(state, groupId, Math.floor(Date.now() / 1000), existing);
      const after = await writeSavedGroup({ expected_revision: catalog.revision, group: saved });
      recordSavedCatalog(catalog, after);
    },
    [recordSavedCatalog],
  );

  const closeGroupById = useCallback(
    async (groupId: string) => {
      const before = tabsRef.current;
      const group = (before.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      const next = await closeTabGroup(before, groupId, {
        lastViewDocumentIds: (state, tabIds) =>
          state.tabs
            .filter((tab) => tabIds.includes(tab.id) && tab.document_id !== undefined)
            .map((tab) => tab.document_id as string),
        prepareClose: () =>
          unsaved.confirmClose(
            before.tabs.filter((tab) => group.tab_ids.includes(tab.id)).flatMap(viewIdsOf),
          ),
      });
      if (next) {
        unsaved.forget(before.tabs.filter((tab) => group.tab_ids.includes(tab.id)).flatMap(viewIdsOf));
        applyGroupState(next, "toast.groupChanged");
      }
    },
    [applyGroupState, unsaved.confirmClose, unsaved.forget],
  );

  const saveAndCloseGroupById = useCallback(
    async (groupId: string) => {
      const before = tabsRef.current;
      const group = (before.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      const next = await saveAndCloseTabGroup(before, groupId, {
        persist: async (state, entry) => {
          const catalog = await listSavedGroups();
          const existing = catalog.groups.find((candidate) => candidate.name === entry.name);
          const saved = buildSavedGroup(
            state,
            entry.id,
            Math.floor(Date.now() / 1000),
            existing,
          );
          const after = await writeSavedGroup({ expected_revision: catalog.revision, group: saved });
          recordSavedCatalog(catalog, after);
        },
        lastViewDocumentIds: (state, tabIds) =>
          state.tabs
            .filter((tab) => tabIds.includes(tab.id) && tab.document_id !== undefined)
            .map((tab) => tab.document_id as string),
        prepareClose: () =>
          unsaved.confirmClose(
            before.tabs.filter((tab) => group.tab_ids.includes(tab.id)).flatMap(viewIdsOf),
          ),
      });
      if (next) {
        unsaved.forget(before.tabs.filter((tab) => group.tab_ids.includes(tab.id)).flatMap(viewIdsOf));
        applyGroupState(next, "toast.groupChanged");
      }
    },
    [applyGroupState, recordSavedCatalog, unsaved.confirmClose, unsaved.forget],
  );

  const openGroupCreate = useCallback(
    (tabIds: string[]) => {
      setGroupName(t("groups.new"));
      setGroupColor("purple");
      setGroupError("");
      setGroupDialog({ mode: "create", tabIds });
      setTabMenu(null);
    },
    [t],
  );

  const openGroupRename = useCallback((group: TabGroup) => {
    setGroupName(group.name);
    setGroupColor(group.color);
    setGroupError("");
    setGroupDialog({ mode: "edit", groupId: group.id });
  }, []);

  const submitGroupDialog = useCallback(() => {
    if (!groupDialog) return;
    const name = groupName.trim();
    if ([...name].length < 1 || [...name].length > 60) {
      setGroupError(t("errors.groups.invalid"));
      return;
    }
    try {
      if (groupDialog.mode === "create") {
        applyGroupState(
          createTabGroup(tabsRef.current, groupDialog.tabIds, name, groupColor),
          "toast.groupChanged",
        );
      } else {
        applyGroupState(
          patchTabGroup(tabsRef.current, groupDialog.groupId, { name, color: groupColor }),
          "toast.groupChanged",
        );
      }
      setGroupDialog(null);
    } catch {
      setGroupError(t("errors.groups.invalid"));
    }
  }, [applyGroupState, groupColor, groupDialog, groupName, t]);

  const closeGroupMenu = useCallback(() => {
    const groupId = groupMenu?.groupId;
    setGroupMenu(null);
    if (!groupId) return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`)?.focus();
    });
  }, [groupMenu]);

  // Tab commands (Step 09a T6). The context menu and the command data stay
  // in one place; the reducer functions remain pure in services/tabActions.
  const tabCommands = useMemo<Command[]>(
    () => [
      {
        id: "tab.pin",
        labelKey: "tabs.pin",
        icon: Pin,
        risk: "read-only",
        helpSlug: "working-with-tabs",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.unpin",
        labelKey: "tabs.unpin",
        icon: PinOff,
        risk: "read-only",
        helpSlug: "working-with-tabs",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.duplicate",
        labelKey: "tabs.duplicate",
        icon: Copy,
        risk: "change",
        helpSlug: "working-with-tabs",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.reopenClosed",
        labelKey: "tabs.reopen",
        icon: Undo2,
        risk: "change",
        helpSlug: "working-with-tabs",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.openSplit",
        labelKey: "splits.open",
        icon: Columns2,
        risk: "change",
        helpSlug: "split-view",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.splitSwap",
        labelKey: "splits.swap",
        icon: ArrowLeftRight,
        risk: "change",
        helpSlug: "split-view",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.splitVertical",
        labelKey: "splits.vertical",
        icon: Columns2,
        risk: "change",
        helpSlug: "split-view",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.splitHorizontal",
        labelKey: "splits.horizontal",
        icon: Rows2,
        risk: "change",
        helpSlug: "split-view",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.splitSync",
        labelKey: "splits.sync",
        icon: Link2,
        risk: "change",
        helpSlug: "split-view",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "explorer.openInNewTab",
        labelKey: "commands.openInNewTab",
        icon: FolderPlus,
        risk: "read-only",
        helpSlug: "working-with-tabs",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.groupNew",
        labelKey: "groups.new",
        icon: FolderPlus,
        risk: "change",
        helpSlug: "tab-groups",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.groupRemove",
        labelKey: "groups.remove",
        icon: FolderMinus,
        risk: "change",
        helpSlug: "tab-groups",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "tab.groupSave",
        labelKey: "groups.save",
        icon: Save,
        risk: "change",
        helpSlug: "tab-groups",
        enabledWhen: () => true,
        run: () => undefined,
      },
      {
        id: "app.savedGroups",
        labelKey: "groups.saved",
        icon: PanelsTopLeft,
        risk: "read-only",
        helpSlug: "saved-tab-groups",
        enabledWhen: () => true,
        run: () => undefined,
      },
    ],
    [],
  );
  const tabCommandRegistry = useMemo(() => {
    const registry = new CommandRegistry();
    for (const command of tabCommands) registry.register(command);
    return registry;
  }, [tabCommands]);

  /** Swap remounts both presentation views (their panes exchange places),
   * so dirty sides are saved or set aside first; never a silent loss. */
  const swapSplitFromUi = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.tabs.find((entry) => entry.id === tabId);
    if (!tab || !isSplitTab(tab)) return;
    const ids = [tab.split.first.view_id, tab.split.second.view_id].filter((id) => unsaved.dirtyIds.has(id));
    if (ids.length > 0) {
      const proceed = await unsaved.confirmClose(ids);
      if (!proceed) return;
    }
    setTabsState((current) => {
      try {
        return swapSplitSides(current, tabId);
      } catch {
        return current;
      }
    });
    if (ids.length > 0) unsaved.forget(ids);
  }, [unsaved.confirmClose, unsaved.dirtyIds, unsaved.forget]);

  /** Structural split changes go through the pure reducers; every invalid
   * request leaves the current state untouched. */
  const applySplitCommand = useCallback((tabId: string, commandId: string) => {
    setTabsState((current) => {
      const tab = current.tabs.find((entry) => entry.id === tabId);
      if (!tab || !isSplitTab(tab)) return current;
      try {
        if (commandId === "tab.splitVertical") return setSplitDirection(current, tab.id, "vertical");
        if (commandId === "tab.splitHorizontal") return setSplitDirection(current, tab.id, "horizontal");
        if (commandId === "tab.splitSync") return setSplitSyncScroll(current, tab.id, !tab.split.sync_scroll);
      } catch {
        return current;
      }
      return current;
    });
  }, []);

  /** Consume the context tab and the most recently used eligible tab of the
   * same group into one split outer tab (Decision 1). A tab with unsaved
   * changes is refused: the disk viewers keep their buffer inside the
   * presentation view, so reparenting it could lose that work. */
  const openSplitForTab = useCallback((tabId: string) => {
    const state = tabsRef.current;
    const tab = state.tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    if (unsaved.dirtyIds.has(viewIdentityOf(tab))) return;
    const partner = splitPartnerFor(tab, state);
    if (!partner || unsaved.dirtyIds.has(viewIdentityOf(partner))) return;
    try {
      const outcome = createSplit(state, tab.id, partner.id, "vertical");
      tabsRef.current = outcome.state;
      setTabsState(outcome.state);
    } catch {
      // An ineligible tab or an unknown handler refuses the split.
    }
  }, [unsaved.dirtyIds]);

  const runTabCommand = useCallback(
    (command: Command) => {
      const id = command.id;
      const tab = tabMenu?.tab;
      setTabMenu(null);
      if (id === "explorer.openInNewTab") {
        openFolderTabAt(explorerPath);
        return;
      }
      if (id === "tab.reopenClosed") {
        reopenLastClosed();
        return;
      }
      if (id === "tab.openSplit") {
        openSplitForTab(tab?.id ?? tabsRef.current.activeId);
        return;
      }
      if (id.startsWith("tab.split")) {
        // Split controls follow the menu's tab, else the active split tab.
        const target = tab && isSplitTab(tab) ? tab.id : tabsRef.current.activeId;
        if (id === "tab.splitSwap") void swapSplitFromUi(target);
        else applySplitCommand(target, id);
        return;
      }
      if (id === "app.savedGroups") {
        openSavedGroups();
        return;
      }
      if (!tab) return;
      if (id === "tab.pin") setTabsState((current) => pinTab(current, tab.id, true));
      else if (id === "tab.unpin") setTabsState((current) => pinTab(current, tab.id, false));
      else if (id === "tab.duplicate") setTabsState((current) => duplicateTab(current, tab.id));
      else if (id === "tab.groupNew") {
        if (isEligibleGroupMember(tab)) openGroupCreate([tab.id]);
      } else if (id === "tab.groupRemove") {
        if ((tabsRef.current.groups ?? []).some((entry) => entry.tab_ids.includes(tab.id))) {
          changeGroup((current) => removeTabsFromGroup(current, [tab.id]));
        }
      } else if (id === "tab.groupSave") {
        const group = (tabsRef.current.groups ?? []).find((entry) => entry.tab_ids.includes(tab.id));
        if (group) void saveGroupToCatalog(group.id).catch((error: unknown) => notify(errorText(t, error, "groups")));
      }
    },
    [
      applySplitCommand,
      changeGroup,
      explorerPath,
      notify,
      openFolderTabAt,
      openGroupCreate,
      openSavedGroups,
      openSplitForTab,
      reopenLastClosed,
      saveGroupToCatalog,
      swapSplitFromUi,
      t,
      tabMenu,
    ],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void (async () => {
          // Step 16: while residence is on, the native close hook owns this
          // request and emits `resident-close-requested` once. Asking here
          // as well would show the dirty dialog twice.
          const resident = await residentStatus().catch(() => null);
          if (resident?.enabled) return;
          await closeWindowRef.current();
        })();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  /** The open pipeline (contract 13): a built-in handler opens the file in
   * a tab; anything else opens in the Windows default app. Rejects with a
   * `files.*` code; the Explorer shows the message. */
  const openFile = useCallback(async (path: string, background: boolean) => {
    const decision = await planOpen(path, handlers, settingsRef.current.open.open_with);
    if (decision.kind === "tab") {
      setTabsState((current) =>
        openFileTab(current, { path, handler: decision.handler.id, title: decision.info.name }, background),
      );
      return;
    }
    await openItem(path);
  }, []);

  /** U5 for drops and Windows activation: apply one already-planned
   * decision and report the tab a built-in handler opened (null for a
   * Windows-default open). The decision is never planned twice. */
  const openDecisionTab = async (
    decision: OpenDecision,
    background: boolean,
  ): Promise<string | null> => {
    if (decision.kind === "windows") {
      await openItem(decision.info.path);
      return null;
    }
    const result = openFileTabResult(
      tabsRef.current,
      { path: decision.info.path, handler: decision.handler.id, title: decision.info.name },
      background,
    );
    // The next file of one drop reads the newest list, not a stale render.
    tabsRef.current = result.state;
    setTabsState(result.state);
    return result.tabId;
  };

  /** Normal open inside a split creates the destination leaf through the
   * normal pipeline (Step 09i D1). The leaf gets a fresh stable view id and
   * takes a slot from the window's shared budget. */
  const openFileIntoSplit = useCallback(
    async (tabId: string, side: SplitSide, path: string, handlerId?: string) => {
      const previous = tabsRef.current.tabs.find((tab) => tab.id === tabId);
      const closed = previous ? splitLeafOf(previous, side) : null;
      // Replacing a dirty side is a last-view close for that view.
      if (closed && unsaved.dirtyIds.has(closed.view_id)) {
        const proceed = await unsaved.confirmClose([closed.view_id]);
        if (!proceed) return;
      }
      const decision = await planOpen(path, handlers, settingsRef.current.open.open_with);
      if (decision.kind !== "tab") {
        await openItem(decision.info.path);
        return;
      }
      const leaf: SplitLeaf = {
        view_id: newSplitViewId(),
        kind: "file",
        source: { kind: "disk", path: decision.info.path },
        handler: handlerId ?? decision.handler.id,
        title: decision.info.name,
      };
      setTabsState((current) => {
        const tab = current.tabs.find((entry) => entry.id === tabId);
        if (!tab || !isSplitTab(tab)) return current;
        try {
          return setSplitLeaf(current, tabId, side, leaf);
        } catch {
          return current;
        }
      });
      if (closed) unsaved.forget([closed.view_id]);
    },
    [unsaved.confirmClose, unsaved.dirtyIds, unsaved.forget],
  );

  /** A chosen viewer ("Open as text") replaces the same split side. */
  const openFileWithIntoSplit = useCallback(async (tabId: string, side: SplitSide, path: string, handlerId: string) => {
    const previous = tabsRef.current.tabs.find((tab) => tab.id === tabId);
    const closed = previous ? splitLeafOf(previous, side) : null;
    if (closed && unsaved.dirtyIds.has(closed.view_id)) {
      const proceed = await unsaved.confirmClose([closed.view_id]);
      if (!proceed) return;
    }
    const title = path.split(/[\\/]/).pop() ?? path;
    const leaf: SplitLeaf = {
      view_id: newSplitViewId(),
      kind: "file",
      source: { kind: "disk", path },
      handler: handlerId,
      title,
    };
    setTabsState((current) => {
      const tab = current.tabs.find((entry) => entry.id === tabId);
      if (!tab || !isSplitTab(tab)) return current;
      try {
        return setSplitLeaf(current, tabId, side, leaf);
      } catch {
        return current;
      }
    });
    if (closed) unsaved.forget([closed.view_id]);
  }, [unsaved.confirmClose, unsaved.dirtyIds, unsaved.forget]);

  /** One drop on a split tab opens every path into the active leaf in
   * order; the last one stays visible. */
  const openPathsIntoSplit = useCallback(
    async (tabId: string, side: SplitSide, paths: readonly string[]) => {
      for (const path of paths) {
        await openFileIntoSplit(tabId, side, path);
      }
    },
    [openFileIntoSplit],
  );

  /** Close one side after its own dirty decision; the survivor becomes the
   * normal tab with the same outer id (Step 09i D3). The closed view's file
   * grant and document reference are released by its unmount. */
  const closeSplitSideFromUi = useCallback(
    async (tabId: string, side: SplitSide) => {
      const tab = tabsRef.current.tabs.find((entry) => entry.id === tabId);
      if (!tab || !isSplitTab(tab)) return;
      const closed = splitLeafOf(tab, side);
      if (!closed) return;
      const survivor = splitLeafOf(tab, side === "first" ? "second" : "first");
      // Promoting the survivor remounts its presentation view, so a dirty
      // survivor is saved or set aside first; never a silent loss.
      const ids = survivor && unsaved.dirtyIds.has(survivor.view_id)
        ? [closed.view_id, survivor.view_id]
        : [closed.view_id];
      const proceed = await unsaved.confirmClose(ids);
      if (!proceed) return;
      setTabsState((current) => {
        try {
          return closeSplitSideInState(current, tabId, side);
        } catch {
          return current;
        }
      });
      unsaved.forget(ids);
    },
    [unsaved.confirmClose, unsaved.forget],
  );

  /** File actions for the mounted 20b document editor. Only actions the tab
   * host can perform today are supplied; New, Open, Save a copy, Export,
   * Print and image insertion stay inert until their 20a engine, blank-draft
   * and picker owners exist. */
  useEffect(() => {
    const activePath = (): string | null => {
      const state = tabsRef.current;
      const tab = state.tabs.find((entry) => entry.id === state.activeId);
      if (!tab) return null;
      if (tab.kind === "file") return tab.path ?? null;
      const leaf = activeSplitLeaf(tab);
      return leaf?.source?.kind === "disk" ? leaf.source.path : null;
    };
    setDocumentEditorAppHost({
      newDocument: () => undefined,
      openDocument: () => undefined,
      closeTab: () => {
        const state = tabsRef.current;
        const tab = state.tabs.find((entry) => entry.id === state.activeId);
        if (!tab) return;
        if (isSplitTab(tab)) void closeSplitSideFromUi(tab.id, tab.split.active_side);
        else closeTab(tab.id);
      },
      copyPath: () => {
        const path = activePath();
        if (!path) return;
        const written = navigator.clipboard?.writeText(pathsForClipboard([path]));
        if (written) void written.catch(() => undefined);
      },
      exportPdf: () => undefined,
      print: () => undefined,
      pickImage: async () => null,
    });
    return () => setDocumentEditorAppHost(null);
  }, [closeSplitSideFromUi, closeTab]);

  /** One validated file drop on a tab or the tab bar (Step 09c T4).
   * Every open still follows planOpen; a split tab sends the drop to its
   * active leaf. */
  const dropFiles = (destination: DropDestination, paths: readonly string[]) => {
    if (destination.kind === "tab") {
      const tab = tabsRef.current.tabs.find((entry) => entry.id === destination.tabId);
      if (tab && isSplitTab(tab)) {
        // A drop reaches the active leaf, never the last mounted editor.
        setTabsState((current) => activateTab(current, tab.id));
        return openPathsIntoSplit(tab.id, tab.split.active_side, paths);
      }
    }
    return routeFileDrop(destination, paths, { ctrl: false, shift: false, alt: false }, {
      planOpen: (path) => planOpen(path, handlers, settingsRef.current.open.open_with),
      openDecision: openDecisionTab,
      // A drop on a group label opens the files and appends their tabs to
      // that group through the 09b reducer (09c addToGroup port).
      addToGroup: (groupId, tabIds) => {
        if (!(tabsRef.current.groups ?? []).some((group) => group.id === groupId)) return;
        changeGroup((current) => addTabsToGroup(current, groupId, tabIds));
      },
    });
  };

  /** "Open as text" and "Open as hex" (Step 04c): a chosen viewer for a
   * file, whatever its type. The same file can have one tab per viewer. */
  const openFileWith = useCallback((path: string, handlerId: string) => {
    const title = path.split(/[\\/]/).pop() ?? path;
    setTabsState((current) => openFileTab(current, { path, handler: handlerId, title }, false));
  }, []);

  /** Step 15 "Edit media": the media tab stays an ordinary player and the
   * recipe opens as its own in-memory document. The source file is never
   * written; saving the recipe asks for a new `.admedia` file. */
  const openMediaEdit = useCallback(async (path: string, subtitlePath?: string) => {
    if (!path || !isTauriRuntime()) return;
    try {
      const mediaName = path.split(/[\\/]/).pop() ?? path;
      const probe = await probeMedia({ kind: "file", path, expected: null });
      const info = await probe.completion;
      const source = mediaSourceForProbe(info);
      let recipe = newMediaRecipe(newRecipeProjectId(), newMediaId(), source);
      // The subtitle shown in the player becomes initial recipe cues when
      // the existing 07f parser accepts it; a failure keeps editing usable.
      if (subtitlePath) {
        try {
          const job = await openExtraView(subtitlePath, "subtitle");
          const session = await job.completion;
          try {
            const imported = await importAllMediaSubtitles(session.session_id);
            if (imported.cues.length > 0) {
              recipe = { ...recipe, subtitles: imported.cues, subtitle_mode: "select" };
            }
          } finally {
            await closeExtraView(session.session_id).catch(() => undefined);
          }
        } catch {
          notify(t("media.subtitlesFailed"));
        }
      }
      const draft = createMediaRecipeDraft(recipe, mediaName, {
        saveTitle: t("mediaEdit.saveRecipe"),
        filterName: t("editor.allFiles"),
      });
      const draftId = draft.document.source.kind === "draft" ? draft.document.source.draft_id : null;
      setTabsState((current) => {
        const existing = draftId === null
          ? undefined
          : current.tabs.find(
              (tab) =>
                tab.kind === "file" &&
                tab.source?.kind === "draft" &&
                tab.source.draft_id === draftId,
            );
        if (existing) return activateTab(current, existing.id);
        const tab: TabState = {
          id: newTabId("file"),
          kind: "file",
          source: draft.document.source,
          handler: "media-recipe",
          title: draft.title,
          draft: draft.document,
        };
        return activateTab({ ...current, tabs: [...current.tabs, tab] }, tab.id);
      });
    } catch (error) {
      notify(errorText(t, error, "media_edit"));
    }
  }, [notify, t]);

  /** Step 19a "New timeline project": one empty `.adtimeline` file at a
   * user-chosen path, opened in the timeline handler. */
  const openNewTimeline = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const path = await pickSavePath(
        t("timeline.new"),
        timelineFileName(t("timeline.title")),
        t("editor.allFiles"),
      );
      if (path === null) return;
      const project = emptyTimelineProject({
        project_id: newUuid(),
        content_id: newUuid(),
        video_name: t("timeline.videoTrackName", { number: 1 }),
      });
      const saved = await saveText({
        path,
        text: encodeTimelineProject(project),
        encoding: "utf-8",
        table: null,
        mode: "saveAs",
        expected_modified_unix: null,
        expected_size: null,
        force: false,
      });
      openFileWith(saved.path, TIMELINE_HANDLER_ID);
    } catch {
      notify(t("errors.timeline.failed"));
    }
  }, [notify, openFileWith, t]);

  /** Step 19a "Edit in timeline": one probed video and its linked audio
   * become a new `.adtimeline` project. The source media is never written. */
  const openTimelineEdit = useCallback(async (path: string) => {
    if (!path || !isTauriRuntime()) return;
    try {
      const mediaName = path.split(/[\\/]/).pop() ?? path;
      const stem = mediaName.replace(/\.[^.]+$/, "");
      const probe = await probeMedia({ kind: "file", path, expected: null });
      const info = await probe.completion;
      const source = mediaSourceForProbe(info);
      const withAudio = source.audio_rate !== null;
      const project = projectFromMediaSource(source, {
        project_id: newUuid(),
        content_id: newUuid(),
        video_name: t("timeline.videoTrackName", { number: 1 }),
        audio_name: withAudio ? t("timeline.audioTrackName", { number: 1 }) : undefined,
      });
      const destination = await pickSavePath(
        t("timeline.edit"),
        timelineFileName(stem),
        t("editor.allFiles"),
      );
      if (destination === null) return;
      const saved = await saveText({
        path: destination,
        text: encodeTimelineProject(project),
        encoding: "utf-8",
        table: null,
        mode: "saveAs",
        expected_modified_unix: null,
        expected_size: null,
        force: false,
      });
      openFileWith(saved.path, TIMELINE_HANDLER_ID);
    } catch {
      notify(t("errors.timeline.failed"));
    }
  }, [notify, openFileWith, t]);

  /** Switch to the Explorer tab and open a folder there, optionally
   * selecting one item in it. */
  const showInExplorer = useCallback((folder: string, select: string | null) => {
    setNavigateRequest((previous) => ({ folder, select, nonce: (previous?.nonce ?? 0) + 1 }));
    setTabsState((current) => activateTab(current, "explorer"));
  }, []);

  // Step 10e: the built-in Home providers are static app code and register
  // once; activation uses the normal Explorer open pipeline.
  useEffect(
    () =>
      registerBuiltInHomeProviders(homeSections, {
        openFolder: (path) => showInExplorer(path, null),
        openFile: (path) => openFile(path, false),
        openSavedGroup: openSavedGroupById,
      }),
    [showInExplorer, openFile, openSavedGroupById],
  );

  // The Explorer's live status getters; free space stays null because the
  // shell does not own a drive query (a hidden field never asks one).
  const explorerStatsRef = useRef(explorerStats);
  explorerStatsRef.current = explorerStats;
  useEffect(() => {
    const unsubscribes = [
      statusFields.register("explorer", {
        id: "item_count",
        label_key: "statusFields.itemCount",
        read: () => ({ kind: "number", value: explorerStatsRef.current.total }),
      }),
      statusFields.register("explorer", {
        id: "selection_count",
        label_key: "statusFields.selectionCount",
        read: () => ({ kind: "number", value: explorerStatsRef.current.selected }),
      }),
      statusFields.register("explorer", {
        id: "selection_size",
        label_key: "statusFields.selectionSize",
        read: () => ({ kind: "size", bytes: explorerStatsRef.current.selectedBytes }),
      }),
      statusFields.register("explorer", {
        id: "free_space",
        label_key: "statusFields.freeSpace",
        read: () => null,
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  const shellCommandActions = useMemo(
    () => ({
      editMenus: () => openSettingsSection("menus"),
      editHome: () => openSettingsSection("home"),
      editNavigation: () => openSettingsSection("navigation"),
      editStatus: () => openSettingsSection("status"),
      importSetup: () => openSettingsSection("setups"),
      shareSetup: () => openSettingsSection("setups"),
    }),
    [openSettingsSection],
  );

  /** Palette dispatch (Step 09d): commands go through the Explorer's own
   * registry and context; folders and files use the normal opening paths. */
  const paletteHost = useMemo<PaletteHost>(() => ({
    commandContext: () => {
      if (!explorerPalette) throw new Error("palette.unavailable");
      return explorerPalette.commandContext();
    },
    dispatchCommand: (id: string) => {
      if (!explorerPalette) throw new Error("palette.unavailable");
      // The active Explorer's own context decides; its dialogs are already
      // in the visible pane.
      explorerPalette.dispatchCommand(id);
    },
    openFolder: async (path: string) => {
      const stat = await fsStat(path);
      if (stat.kind === "file") {
        await openFile(stat.path, false);
        return;
      }
      if (tabsRef.current.tabs.length >= MAX_TABS) throw new Error("palette.unavailable");
      setTabsState((current) => openFolderTab(current, defaultFolderTabState(stat.path), false));
    },
    openFile: (path: string) => openFile(path, false),
    activateTab: (id: string) => {
      if (!tabsRef.current.tabs.some((tab) => tab.id === id)) throw new Error("palette.unavailable");
      setTabsState((current) => activateTab(current, id));
    },
    // The saved-group restore host is mounted here (Step 09b): palette and
    // navigation rows delegate to the one owner of capacity and Undo.
    openSavedGroup: openSavedGroupById,
    openSettings: (sectionId: string) => openSettingsSection(sectionId),
    openHelp: (slug: string) => openTab("help", slug),
  }), [explorerPalette, openFile, openSavedGroupById, openSettingsSection, openTab]);

  const language = i18n.language;
  useLayoutEffect(() => {
    const localized = i18n.getFixedT(language);
    const english = i18n.getFixedT("en");
    // One shared snapshot per catalog collection, shared by both location
    // providers and discarded once collection finishes.
    let locations: ReturnType<typeof paletteLocations> | null = null;
    const loadLocations = () => {
      if (!locations) {
        const pending = paletteLocations();
        locations = pending;
        void pending.finally(() => { if (locations === pending) locations = null; });
      }
      return locations!;
    };
    const unsubscribes = [
      paletteRegistry.registerProvider("settings", settingsPaletteProvider(localized, english)),
      paletteRegistry.registerProvider("help", helpPaletteProvider(() => paletteHelpEntries(language))),
      paletteRegistry.registerProvider("folder", descriptorPaletteProvider("folder", async () => (await loadLocations()).folders)),
      paletteRegistry.registerProvider("recent_file", descriptorPaletteProvider("recent_file", async () => (await loadLocations()).files)),
      paletteRegistry.registerProvider("tab", descriptorPaletteProvider("tab", async () =>
        tabsRef.current.tabs.flatMap((tab) => {
          if (tab.kind === "file" && ((tab.source !== undefined && tab.source.kind !== "disk") || tab.missing?.reason === "locked")) return [];
          const title = tab.title ?? (tab.path !== undefined ? safeDisplayName(tab.path) : i18n.t(
            tab.kind === "explorer" ? "tabs.explorer"
              : tab.kind === "help" ? "help.title"
                : tab.kind === "settings" ? "settings.title"
                  : tab.kind === "gallery" ? "gallery.title"
                    : tab.kind === "split" ? "splits.title" : "tabs.file",
          ));
          return [{ id: tab.id, title }];
        }))),
      paletteRegistry.registerProvider("saved_group", descriptorPaletteProvider("saved_group", paletteSavedGroups)),
      // Two static theme actions; nothing here reads settings or invokes.
      // When the active Explorer already publishes the same commands, its
      // provider owns the palette entry; a duplicate id rejects the catalog.
      ...(() => {
        const provider = createThemePaletteProvider({
          editTheme: () => { void openThemeEditor(); },
          toggleDayNight,
        });
        return [
          paletteRegistry.registerProvider("theme-actions", {
            snapshot: async () => {
              const entries = await provider.snapshot();
              const registry = explorerPalette?.registry;
              return registry
                ? entries.filter(
                    (entry) => entry.target_id === undefined || !registry.get(entry.target_id),
                  )
                : entries;
            },
            dispatch: (entry, host) => provider.dispatch(entry, host),
          }),
        ];
      })(),
    ];
    if (explorerPalette) {
      unsubscribes.push(
        paletteRegistry.registerProvider(
          "commands",
          commandPaletteProvider(explorerPalette.registry, paletteHost, english),
        ),
      );
    }
    return () => { for (const unsubscribe of unsubscribes) unsubscribe(); };
  }, [i18n, language, explorerPalette, paletteHost, paletteRegistry, openThemeEditor, toggleDayNight]);

  /** An archive tab asked for an extraction (Step 06d): show the folder in
   * the Explorer, then let it run the job and select what it made. */
  const extractArchive = useCallback(
    (request: ArchiveExtractRequest) => {
      showInExplorer(request.dest_dir, null);
      setExtractRequest((previous) => ({ request, nonce: (previous?.nonce ?? 0) + 1 }));
    },
    [showInExplorer],
  );

  const patchShelfFromPanel = useCallback(async (patch: ShelfPatch) => {
    const current = shelfRef.current;
    if (!current) return;
    try {
      const next = await patchShelf(patch, current.revision);
      const merged = mergeShelfCatalog(current, next, patch);
      shelfRef.current = merged;
      setShelfCatalog(merged);
    } catch (error) {
      if (errorCode(error) === "shelf.changed") {
        try {
          const reloaded = await getShelf();
          shelfRef.current = reloaded;
          setShelfCatalog(reloaded);
        } catch {
          // The panel keeps its current list and shows the original error.
        }
      }
      throw error;
    }
  }, []);

  const addToShelf = useCallback(
    async (paths: readonly string[]) => {
      if (!isTauriRuntime() || paths.length === 0) return;
      let current = shelfRef.current;
      if (!current) {
        current = await getShelf();
        shelfRef.current = current;
        setShelfCatalog(current);
      }
      const next = await patchShelf(
        { kind: "add", sources: paths.map((path) => ({ kind: "disk" as const, path })) },
        current.revision,
      );
      const merged = mergeShelfCatalog(current, next, { kind: "add", sources: [] });
      shelfRef.current = merged;
      setShelfCatalog(merged);
    },
    [],
  );

  const openShelfItem = useCallback(
    async (id: string) => {
      const item = shelfRef.current?.items.find((entry) => entry.id === id);
      if (!item) throw new Error("shelf.unavailable");
      if (item.source.kind !== "disk") throw new Error("shelf.sensitive");
      const stat = await fsStat(item.source.path);
      if (stat.kind === "folder") showInExplorer(item.source.path, null);
      else await openFile(item.source.path, false);
    },
    [openFile, showInExplorer],
  );

  const shelfHost = useMemo<ShelfActionHost>(
    () => ({
      startTransfer: async (request) => {
        await startHostedTransfer(request);
      },
      openBatch: async (inputs) => setConvertInputs([...inputs]),
      openArchive: async (paths) => setCompressSources([...paths]),
      share: async (paths) => {
        await shareItems([...paths], t("shelf.title"));
      },
      openGroup: async () => {
        throw new Error("shelf.unavailable");
      },
      openPrivacy: async (inputs) => setPrivacyInputs([...inputs]),
    }),
    [t],
  );

  const runShelfActionFromPanel = useCallback(
    async (id: Parameters<typeof runShelfAction>[0], ids: readonly string[]) => {
      const items = (shelfRef.current?.items ?? []).filter((item) => ids.includes(item.id));
      await runShelfAction(id, items, shelfHost);
    },
    [shelfHost],
  );

  const shelfElement =
    shelfCatalog === null ? null : (
      <ShelfPanel
        key="shelf"
        catalog={shelfCatalog}
        active={settings.shelf.visible}
        onPatch={patchShelfFromPanel}
        onAction={runShelfActionFromPanel}
        onOpen={openShelfItem}
        onOpenHelp={(slug) => openTab("help", slug)}
      />
    );

  const mounted = useMemo(() => mountedFileTabs(tabsState), [tabsState]);
  // Split outer tabs stay mounted like file tabs, so their two leaves keep
  // their listings, scroll positions and live views while another tab is
  // shown (Step 09i D3).
  const mountedSplits = useMemo(() => {
    const splitIds = new Set(tabsState.tabs.filter((tab) => tab.kind === "split").map((tab) => tab.id));
    const recent = [...tabsState.history].reverse().filter((id) => splitIds.has(id));
    const keep = new Set(recent.slice(0, 8));
    if (splitIds.has(tabsState.activeId)) keep.add(tabsState.activeId);
    return keep;
  }, [tabsState]);
  // The strip marks an outer tab dirty when either side has unsaved work.
  const dirtyTabIds = useMemo(() => {
    const ids = new Set(unsaved.dirtyIds);
    for (const tab of tabs) {
      if (isSplitTab(tab)) {
        if (ids.has(tab.split.first.view_id) || ids.has(tab.split.second.view_id)) ids.add(tab.id);
      } else if (ids.has(viewIdentityOf(tab))) {
        ids.add(tab.id);
      }
    }
    return ids;
  }, [tabs, unsaved.dirtyIds]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    listen("open-help", (event) => {
        const payload = (event as unknown as { payload: unknown }).payload;
        openTab("help", typeof payload === "string" ? payload : undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [openTab]);

  /** Windows activation (Step 09c D9/D10/E4): install the listener first,
   * then mark the native queue ready. The service drops duplicate ids;
   * every open path still follows the normal planOpen pipeline. The first
   * path of a request takes the foreground tab, the rest open in the
   * background. Step 16 D3: a fixed convert verb opens the shared review
   * with convertible paths and never starts a conversion. */
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const openRequest = (request: ActivationRequest) => {
      if (disposed) return;
      // Step 16: an activation restores the resident shell through the
      // coordinator, so the next close still asks before hiding again.
      void showResidentWindow().catch(() => undefined);
      // The activation service already dropped a repeated request id, so a
      // duplicate delivery cannot open a second review or tab.
      if (request.intent === "convert") {
        const inputs = request.paths.map((path): ConversionInput => ({ kind: "file", path }));
        if (convertersForInputs(QUICK_CONVERT_CONVERTERS, inputs).length > 0) {
          setConvertInputs(inputs);
          return;
        }
        // No quick converter accepts this set: keep the normal open so the
        // chosen files are not silently ignored.
      }
      request.paths.forEach((path, index) => {
        void openFile(path, index > 0).catch(() => undefined);
      });
    };
    void onOpenRequest(openRequest)
      .then((stop) => {
        if (disposed) {
          stop();
          return undefined;
        }
        unlisten = stop;
        return activationReady();
      })
      .then((queued) => {
        if (disposed || !queued) return;
        for (const request of queued) openRequest(request);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openFile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The keyboard router owns every binding in the active map; a key it
      // already ran must not also run the remaining static tab/shelf keys.
      if (event.defaultPrevented) return;
      if (event.key === "Alt") {
        setShowKeyTips(true);
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        const state = tabsRef.current;
        const tab = state.tabs.find((entry) => entry.id === state.activeId);
        openTab("help", helpSlugForTab(tab, explorerStats.helpSlug));
        return;
      }
      if (
        isShelfToggleShortcut({
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          key: event.key,
        })
      ) {
        event.preventDefault();
        onShelfToggle();
        return;
      }
      // Ctrl+Tab / Ctrl+Shift+Tab belong to the keyboard router's map;
      // Ctrl+1..9, Ctrl+W and Ctrl+Shift+T stay with the tab strip.
      if (event.key === "Tab" && (event.ctrlKey || event.metaKey) && !event.altKey) return;
      const target = event.target as HTMLElement | null;
      const action = resolveTabKey(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        },
        tabsRef.current,
        {
          textEditing: target?.closest('input, textarea, [contenteditable="true"]') !== null,
          searchFocused: target?.closest('[role="combobox"]') !== null,
        },
      );
      if (action.type === "activate") {
        event.preventDefault();
        setTabsState((current) => activateTab(current, action.id));
      } else if (action.type === "close") {
        event.preventDefault();
        closeTab(action.id);
      } else if (action.type === "reopenClosed") {
        event.preventDefault();
        reopenLastClosed();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setShowKeyTips(false);
    };
    const onBlur = () => setShowKeyTips(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [closeTab, onShelfToggle, openTab, explorerStats.helpSlug, reopenLastClosed]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const update = () => {
      try {
        void getCurrentWindow()
          .isMaximized()
          .then(setIsMaximized)
          .catch(() => undefined);
      } catch {
        // Browser fallback: window controls are inert.
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Snap layouts: tell Windows where the custom maximize button is, so it
  // can treat that area as the native maximize button (HTMAXBUTTON).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const report = () => {
      const el = maximizeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = window.devicePixelRatio || 1;
      void invoke("set_maximize_rect", {
        x: r.x * s,
        y: r.y * s,
        width: r.width * s,
        height: r.height * s,
      }).catch(() => undefined);
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, []);

  const windowAction = (action: "minimize" | "toggle-maximize" | "close") => {
    if (!isTauriRuntime()) return;
    try {
      const win = getCurrentWindow();
      if (action === "minimize") void win.minimize();
      if (action === "toggle-maximize") {
        void win.toggleMaximize().then(() => {
          void win.isMaximized().then(setIsMaximized).catch(() => undefined);
        });
      }
      if (action === "close") void closeWindow();
    } catch {
      // No Tauri window in a plain browser.
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  // Opening Settings refreshes the catalog summaries its pickers list.
  useEffect(() => {
    if (activeTab.kind !== "settings") return;
    void refreshCustomThemes(settingsRef.current.theme_custom);
  }, [activeTab.kind, refreshCustomThemes]);
  // A palette settings entry scrolls its section into view once the lazy
  // Settings page has rendered it.
  useEffect(() => {
    if (!settingsSectionRequest || activeTab.kind !== "settings") return;
    const section = settingsSectionRequest.id;
    let frame = 0;
    let request = 0;
    const reveal = () => {
      const element = document.getElementById(`adp-settings-${section}`);
      if (element) {
        setSettingsSectionRequest(null);
        element.scrollIntoView({ block: "start" });
        return;
      }
      frame += 1;
      if (frame < 60) request = window.requestAnimationFrame(reveal);
    };
    request = window.requestAnimationFrame(reveal);
    return () => window.cancelAnimationFrame(request);
  }, [activeTab.kind, settingsSectionRequest]);
  const tabLabel = (tab: TabState): string => {
    if (tab.kind === "explorer") return t("tabs.explorer");
    if (tab.kind === "help") return t("help.title");
    if (tab.kind === "settings") return t("settings.title");
    if (tab.kind === "file") return tab.title ?? t("tabs.file");
    if (tab.kind === "folder") return tab.folder?.path === "home" ? t("explorer.nav.home") : tab.title ?? tab.path ?? t("tabs.explorer");
    if (tab.kind === "split") return tab.title ?? t("splits.title");
    if (tab.kind === "gallery") return t("tabs.components");
    return t("gallery.title");
  };
  const TabIcon =
    activeTab.kind === "help"
      ? CircleHelp
      : activeTab.kind === "settings"
        ? SettingsIcon
        : activeTab.kind === "gallery"
          ? LayoutGrid
          : activeTab.kind === "folder"
            ? Folder
            : activeTab.kind === "split"
              ? Columns2
              : activeTab.kind === "file" && activeTab.handler
                ? (handlers.get(activeTab.handler)?.icon ?? LayoutGrid)
                : Home;

  // The assistant offers a native Allow/Cancel dialog for this folder only;
  // no grant is inferred from a path being visible in the Explorer.
  const assistantScopeRoot =
    activeTab.kind === "explorer"
      ? explorerPath
      : activeTab.kind === "folder"
        ? activeTab.path ?? explorerPath
        : activeTab.kind === "file" && activeTab.path
          ? parentPathOf(activeTab.path)
          : explorerPath;

  /** One split leaf through the same viewer components as a normal tab.
   * The leaf view id is the identity for dirty state, save handles and
   * scroll ports; the outer tab is the one that owns the split state. */
  const renderSplitLeaf = (
    outer: TabState,
    leaf: SplitLeaf,
    side: SplitSide,
    leafActive: boolean,
    visible: boolean,
  ) => {
    if (leaf.missing !== undefined || (leaf.kind === "file" && leaf.source?.kind !== "disk")) {
      const reason = leaf.missing?.reason === "handler_missing" ? "tabs.handlerMissing" : "fileTab.notFoundTitle";
      return (
        <div className="adp-viewer-message" role="alert">
          <p>{t(reason)}</p>
        </div>
      );
    }
    if (leaf.kind === "folder") {
      if (!leaf.folder) return null;
      return (
        <FolderTabView
          tabId={leaf.view_id}
          state={leaf.folder}
          active={leafActive}
          visible={visible}
          doubleClickMs={effectiveDoubleClickMs(settings.accessibility, systemAccessibility)}
          pickActive={pickActive}
          onPickDropRequest={requestPickDrop}
          toolbarCustom={settings.toolbar_custom}
          onCustomizeToolbar={() => openSettingsSection("toolbars")}
          onCustomizeShortcuts={() => openSettingsSection("keyboard")}
          dragHoverMs={settings.tabs.drag_hover_ms}
          onActivateTab={(memberId) => setTabsState((current) => activateTab(current, memberId))}
          onDropFilesOnTab={(memberId, paths) => {
            setTabsState((current) => activateTab(current, memberId));
            return dropFiles({ kind: "tab", tabId: memberId }, paths);
          }}
          onViewChange={(folder) =>
            setTabsState((current) => {
              const tab = current.tabs.find((entry) => entry.id === outer.id);
              if (!tab || !isSplitTab(tab)) return current;
              try {
                return setSplitState(current, outer.id, withSplitLeafFolder(tab.split, side, folder));
              } catch {
                return current;
              }
            })
          }
          onOpenFile={(path) => openFileIntoSplit(outer.id, side, path)}
          onOpenHelp={(slug) => openTab("help", slug)}
          views={settings.views}
          onPaletteBridge={publishExplorerPalette}
          onOpenCommandPalette={openCommandPalette}
          onReportProblem={reportProblem}
          onOpenRecovery={openRecovery}
          onOpenMountedDrive={openFolderTabAt}
          searchSettings={settings.search}
          onSearchSettingsChange={onSearchSettingsChange}
          folderSizes={settings.folder_sizes}
          onFolderSizesChange={onFolderSizesChange}
          onOpenAppStorage={() => openSettingsSection("appStorage")}
        />
      );
    }
    const leafTab = splitLeafTab(leaf);
    return (
      <FileTabView
        key={leaf.view_id}
        tab={leafTab}
        active={leafActive}
        visible={visible}
        syncViewId={leaf.view_id}
        openBudget={splitBudgetRef.current ?? undefined}
        onShowInFolder={(path) => showInExplorer(parentPathOf(path) ?? path, path)}
        onOpenFolder={(folder) => showInExplorer(folder, null)}
        onClose={() => void closeSplitSideFromUi(outer.id, side)}
        onViewState={(view) =>
          setTabsState((current) => {
            const tab = current.tabs.find((entry) => entry.id === outer.id);
            if (!tab || !isSplitTab(tab)) return current;
            try {
              return setSplitState(current, outer.id, withSplitLeafView(tab.split, side, view));
            } catch {
              return current;
            }
          })
        }
        onOpenHelp={(slug) => openTab("help", slug)}
        protectedViewEnabled={settings.open.protected_view}
        statusCustomization={settings.shell_custom.status}
        isDirty={unsaved.dirtyIds.has(leaf.view_id)}
        onDirtyChange={(dirty) => unsaved.onDirtyChange(leaf.view_id, dirty)}
        registerSave={(handle) => unsaved.registerSave(leaf.view_id, handle)}
        onPathChange={(newPath) =>
          setTabsState((current) => {
            const tab = current.tabs.find((entry) => entry.id === outer.id);
            if (!tab || !isSplitTab(tab)) return current;
            try {
              return setSplitState(current, outer.id, withSplitLeafPath(tab.split, side, newPath));
            } catch {
              return current;
            }
          })
        }
        onConfirmDiscard={() => unsaved.confirmClose([leaf.view_id])}
        ocrLanguage={settings.ocr.language}
        onOpenFile={(path) => openFileIntoSplit(outer.id, side, path)}
        onExtractArchive={extractArchive}
        onConvert={(request) => {
          setConversionRequest((previous) => ({ ...request, nonce: (previous?.nonce ?? 0) + 1 }));
          setTabsState((current) => activateTab(current, "explorer"));
        }}
        onOpenAsText={() => { void openFileWithIntoSplit(outer.id, side, leafTab.path ?? "", "text"); }}
        onEditMedia={(subtitle) => {
          if (leafTab.path) void openMediaEdit(leafTab.path, subtitle);
        }}
        recovery={{
          enabled: settings.recovery.enabled,
          interval_seconds: settings.recovery.interval_seconds,
        }}
      />
    );
  };

  /** A split can start only from clean tabs: neither the context tab nor
   * its partner may lose an unsaved viewer buffer to the remount. */
  const canSplitNow = (tab: TabState): boolean => {
    if (unsaved.dirtyIds.has(viewIdentityOf(tab))) return false;
    const partner = splitPartnerFor(tab, tabsState);
    return partner !== null && !unsaved.dirtyIds.has(viewIdentityOf(partner));
  };

  // The one group wiring both TabStrips share (Step 09b T5).
  const tabStripGroups = {
    groups: tabsState.groups,
    onGroupToggle: (group: TabGroup) =>
      changeGroup((current) => patchTabGroup(current, group.id, { collapsed: !group.collapsed })),
    onGroupMenu: (group: TabGroup, anchor: DOMRect) =>
      setGroupMenu({ groupId: group.id, anchor }),
    onDropFilesOnGroup: (groupId: string, paths: readonly string[]) =>
      dropFiles({ kind: "group", groupId }, paths),
    onOpenSavedGroups: openSavedGroups,
  };

  // Group and saved-group commands for the Explorer's command bar and the
  // palette; the Explorer's running context supplies no tab, so these use
  // the most recently active eligible tab.
  const featureActions = useMemo(() => ({
    tabGroupNew: () => {
      const tab = groupTargetTab();
      if (tab) openGroupCreate([tab.id]);
    },
    tabGroupRemove: () => {
      const tab = groupTargetTab();
      if (tab && (tabsRef.current.groups ?? []).some((group) => group.tab_ids.includes(tab.id))) {
        changeGroup((current) => removeTabsFromGroup(current, [tab.id]));
      }
    },
    tabGroupSave: () => {
      const tab = groupTargetTab();
      const group = tab
        ? (tabsRef.current.groups ?? []).find((entry) => entry.tab_ids.includes(tab.id))
        : undefined;
      if (group) void saveGroupToCatalog(group.id).catch((error: unknown) => notify(errorText(t, error, "groups")));
    },
    openSavedGroups,
    editMedia: isTauriRuntime() ? (path: string) => void openMediaEdit(path) : undefined,
    newTimelineProject: isTauriRuntime() ? () => void openNewTimeline() : undefined,
    editInTimeline: isTauriRuntime() ? (path: string) => void openTimelineEdit(path) : undefined,
    editTheme: themeFeatureActions.editTheme,
    toggleDayNight: themeFeatureActions.toggleDayNight,
    lockedSession: lockedHost.session !== null,
    createEncryptedCopy: lockedHost.openCreate,
    unlockLockedFolder: lockedHost.openUnlock,
    lockLockedFolder: lockedHost.lock,
    saveLockedCopy: lockedHost.saveCopy,
    exportLockedCopy: () => lockedHost.exportCopy(),
    openAccessibility: () => openSettingsSection("accessibility"),
    readAloud: readSelectionAloud,
    pickSelection,
    cancelPick,
    pickActive: () => pickActive,
    focusLayout: toggleFocusLayout,
    focusLayoutActive: () => focusLayoutActive,
  }), [
    changeGroup,
    cancelPick,
    focusLayoutActive,
    pickActive,
    pickSelection,
    readSelectionAloud,
    toggleFocusLayout,
    groupTargetTab,
    lockedHost.exportCopy,
    lockedHost.lock,
    lockedHost.openCreate,
    lockedHost.openUnlock,
    lockedHost.saveCopy,
    lockedHost.session,
    notify,
    openGroupCreate,
    openMediaEdit,
    openNewTimeline,
    openSavedGroups,
    openSettingsSection,
    openTimelineEdit,
    saveGroupToCatalog,
    t,
    themeFeatureActions,
  ]);

  return (
    <ShortcutResolutionProvider map={activeKeyboardMap} scopeFor={shortcutScopeFor}>
    <AccessibilityProvider value={effectiveAccessibility}>
    <AnnouncementContext.Provider value={announcementQueueRef.current}>
    <AppearanceContext.Provider value={settings.appearance.density}>
    <LayoutContext.Provider value={layoutValue}>
    {themeBackgroundStyle ? (
      <div className="adp-theme-background-layer" aria-hidden="true" style={themeBackgroundStyle} />
    ) : null}
    <div className="adp-shell" style={{ position: "relative", zIndex: 1 }}>
      <header className="adp-titlebar" data-tauri-drag-region="">
        {settings.layout.tab_bar_position === "top" ? (
          <TabStrip
            tabs={tabs}
            activeId={activeId}
            side="top"
            collapsed={settings.layout.tab_bar_collapsed}
            label={tabLabel}
            onActivate={(id) => setTabsState((current) => activateTab(current, id))}
            onClose={closeTab}
            onNewTab={newTab}
            onToggleCollapsed={() =>
              onLayoutChange({ ...settings.layout, tab_bar_collapsed: !settings.layout.tab_bar_collapsed })
            }
            dirtyIds={dirtyTabIds}
            onTabMenu={(tab, anchor) => setTabMenu({ tab, anchor })}
            hoverMs={settings.tabs.drag_hover_ms}
            onDropFilesOnBar={(paths) => dropFiles({ kind: "bar" }, paths)}
            onDropFilesOnTab={(tabId, paths) => {
              setTabsState((current) => activateTab(current, tabId));
              return dropFiles({ kind: "tab", tabId }, paths);
            }}
            {...tabStripGroups}
          />
        ) : (
          <span className="adp-titlebar-title" data-tauri-drag-region="">
            {tabLabel(activeTab)}
          </span>
        )}
        <div className="adp-button-row">
          <IconButton
            icon={MessageSquare}
            labelKey="assistant.title"
            pressed={assistantOpen}
            onClick={() => setAssistantOpen((open) => !open)}
          />
          <IconButton
            icon={CircleHelp}
            labelKey="help.title"
            keyTip="H"
            showKeyTip={showKeyTips}
            onClick={() => {
              openTab("help", helpSlugForTab(activeTab, explorerStats.helpSlug));
            }}
          />
          <IconButton
            icon={SettingsIcon}
            labelKey="settings.title"
            keyTip="S"
            showKeyTip={showKeyTips}
            onClick={() => openTab("settings")}
          />
        </div>
        <div className="adp-window-controls">
          <button
            type="button"
            className="adp-icon-btn adp-window-btn"
            aria-label={t("window.minimize")}
            title={t("window.minimize")}
            onClick={() => windowAction("minimize")}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="adp-icon-btn adp-window-btn"
            aria-label={isMaximized ? t("window.restore") : t("window.maximize")}
            title={isMaximized ? t("window.restore") : t("window.maximize")}
            onClick={() => windowAction("toggle-maximize")} ref={maximizeRef}
          >
            {isMaximized ? (
              <Copy size={13} aria-hidden="true" />
            ) : (
              <Square size={13} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="adp-icon-btn adp-window-btn adp-window-btn--close"
            aria-label={t("window.close")}
            title={t("window.close")}
            onClick={() => windowAction("close")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      {safeMode?.active ? (
        <SafeModeBanner
          busy={safeModeBusy}
          error={safeModeError ?? undefined}
          onRestart={restartApp}
        />
      ) : null}

      {/* Two fixed slots, so changing the side never remounts `main` (D10). */}
      <div className={`adp-workspace adp-workspace--tabs-${settings.layout.tab_bar_position}`}>
        {settings.layout.tab_bar_position === "top" ? null : (
          <TabStrip
            tabs={tabs}
            activeId={activeId}
            side={settings.layout.tab_bar_position}
            collapsed={settings.layout.tab_bar_collapsed}
            label={tabLabel}
            onActivate={(id) => setTabsState((current) => activateTab(current, id))}
            onClose={closeTab}
            onNewTab={newTab}
            onToggleCollapsed={() =>
              onLayoutChange({ ...settings.layout, tab_bar_collapsed: !settings.layout.tab_bar_collapsed })
            }
            dirtyIds={dirtyTabIds}
            onTabMenu={(tab, anchor) => setTabMenu({ tab, anchor })}
            hoverMs={settings.tabs.drag_hover_ms}
            onDropFilesOnBar={(paths) => dropFiles({ kind: "bar" }, paths)}
            onDropFilesOnTab={(tabId, paths) => {
              setTabsState((current) => activateTab(current, tabId));
              return dropFiles({ kind: "tab", tabId }, paths);
            }}
            {...tabStripGroups}
          />
        )}
      <KeyTipsContext.Provider value={showKeyTips}>
      <ToolbarCustomSettingsProvider value={settings.toolbar_custom}>
      <div className="adp-workspace-main">
      <main className="adp-main">
        <div
          className={`adp-main-body adp-main-body--shelf-${settings.shelf.side}`}
          style={{ "--adp-shelf-size": `${settings.shelf.size}px` } as CSSProperties}
        >
        {settings.shelf.visible && settings.shelf.side === "left" ? shelfElement : null}
        <div className="adp-main-content">
        {/* The Explorer stays mounted so it keeps its folder, selection and
            scroll position; it ignores shortcuts and drops while hidden. */}
        <div className="adp-tabpane" hidden={activeTab.kind !== "explorer"}>
          <ExplorerHome
            active={activeTab.kind === "explorer"}
            pickActive={pickActive}
            onPickDropRequest={requestPickDrop}
            doubleClickMs={effectiveDoubleClickMs(settings.accessibility, systemAccessibility)}
            dragHoverMs={settings.tabs.drag_hover_ms}
            onPaletteBridge={publishExplorerPalette}
            paletteOwnerId="explorer"
            onOpenCommandPalette={openCommandPalette}
            featureActions={featureActions}
            toolbarCustom={settings.toolbar_custom}
            onCustomizeToolbar={() => openSettingsSection("toolbars")}
            onCustomizeShortcuts={() => openSettingsSection("keyboard")}
            shellCustom={settings.shell_custom}
            onShellCustomChange={(shell_custom) => applySettings({ ...settings, shell_custom })}
            shellCommandActions={shellCommandActions}
            onSavedGroups={openSavedGroups}
            onActivateTab={(tabId) => setTabsState((current) => activateTab(current, tabId))}
            onDropFilesOnTab={(tabId, paths) => {
              setTabsState((current) => activateTab(current, tabId));
              return dropFiles({ kind: "tab", tabId }, paths);
            }}
            onStatsChange={setExplorerStats}
            onOpenHelp={(slug) => openTab("help", slug ?? "browsing-folders")}
            onOpenMountedDrive={openFolderTabAt}
            onOpenFile={openFile}
            onOpenFileWith={openFileWith}
            onLocationChange={setExplorerPath}
            onAddToShelf={(paths) => void addToShelf(paths).catch(() => undefined)}
            onShowFileLocks={(paths) => setLockPaths([...paths])}
            onReportProblem={reportProblem}
            onOpenRecovery={openRecovery}
            navigateRequest={navigateRequest}
            viewModeRequest={viewModeRequest}
            extractRequest={extractRequest}
            conversionRequest={conversionRequest}
            view={settings.explorer}
            onViewChange={onViewChange}
            views={settings.views}
            pasteImageFormat={settings.files?.paste_image_format ?? "png"}
            templatesFolder={settings.templates?.my_folder ?? ""}
            onTemplatesFolderChange={onTemplatesFolderChange}
            versionsEnabled={settings.versions.enabled}
            gallery={settings.gallery}
            onGallerySettingsChange={onGallerySettingsChange}
            searchSettings={settings.search}
            onSearchSettingsChange={onSearchSettingsChange}
            folderSizes={settings.folder_sizes}
            onFolderSizesChange={onFolderSizesChange}
            onOpenAppStorage={() => openSettingsSection("appStorage")}
          />
        </div>
        {tabs
          .filter((tab) => tab.kind === "file" && mounted.has(tab.id))
          .map((tab) => (
            <FileTabView
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              syncViewId={viewIdentityOf(tab)}
              openBudget={splitBudgetRef.current ?? undefined}
              onShowInFolder={(path) => showInExplorer(parentPathOf(path) ?? path, path)}
              onOpenFolder={(folder) => showInExplorer(folder, null)}
              onClose={() => closeTab(tab.id)}
              onViewState={(view) => setTabsState((current) => setTabView(current, tab.id, view))}
              onOpenHelp={(slug) => openTab("help", slug)}
              protectedViewEnabled={settings.open.protected_view}
              statusCustomization={settings.shell_custom.status}
              isDirty={unsaved.dirtyIds.has(viewIdentityOf(tab))}
              onDirtyChange={(dirty) => unsaved.onDirtyChange(viewIdentityOf(tab), dirty)}
              registerSave={(handle) => unsaved.registerSave(viewIdentityOf(tab), handle)}
              onPathChange={(newPath) =>
                setTabsState((current) =>
                  setTabPath(current, tab.id, newPath, newPath.split(/[\\/]/).pop() ?? tab.title ?? ""),
                )
              }
              onConfirmDiscard={() => unsaved.confirmClose([viewIdentityOf(tab)])}
              ocrLanguage={settings.ocr.language}
              onOpenFile={(path) => openFile(path, false)}
              onExtractArchive={extractArchive}
              onConvert={(request) => {
                setConversionRequest((previous) => ({ ...request, nonce: (previous?.nonce ?? 0) + 1 }));
                setTabsState((current) => activateTab(current, "explorer"));
              }}
              onOpenAsText={() => openFileWith(tab.path ?? "", "text")}
              onEditMedia={(subtitle) => void openMediaEdit(tab.path ?? "", subtitle)}
              recovery={{
                enabled: settings.recovery.enabled,
                interval_seconds: settings.recovery.interval_seconds,
              }}
              lockedSession={lockedHost.session}
              onLockedSessionChange={handleLockedSessionChange}
              onLockedNavigate={navigateLockedTab}
              onOpenLockedEntry={openLockedEntry}
              onLockedExportEntry={(entryId) => lockedHost.exportCopy(entryId)}
              onLockedRecovery={lockedHost.openRecovery}
            />
          ))}
        {tabs
          .filter((tab) => tab.kind === "folder" && tab.folder !== undefined)
          .map((tab) => (
            <FolderTabView
              key={tab.id}
              tabId={tab.id}
              state={tab.folder!}
              active={tab.id === activeId}
              doubleClickMs={effectiveDoubleClickMs(settings.accessibility, systemAccessibility)}
              pickActive={pickActive}
              onPickDropRequest={requestPickDrop}
              featureActions={featureActions}
              toolbarCustom={settings.toolbar_custom}
              onCustomizeToolbar={() => openSettingsSection("toolbars")}
              onCustomizeShortcuts={() => openSettingsSection("keyboard")}
              dragHoverMs={settings.tabs.drag_hover_ms}
              onActivateTab={(memberId) => setTabsState((current) => activateTab(current, memberId))}
              onDropFilesOnTab={(memberId, paths) => {
                setTabsState((current) => activateTab(current, memberId));
                return dropFiles({ kind: "tab", tabId: memberId }, paths);
              }}
              onViewChange={(folder) => updateFolderTab(tab.id, folder)}
              onOpenMountedDrive={openFolderTabAt}
              onOpenFile={openFile}
              onOpenHelp={(slug) => openTab("help", slug)}
              views={settings.views}
              onPaletteBridge={publishExplorerPalette}
              onOpenCommandPalette={openCommandPalette}
              onReportProblem={reportProblem}
              onOpenRecovery={openRecovery}
              searchSettings={settings.search}
              onSearchSettingsChange={onSearchSettingsChange}
              folderSizes={settings.folder_sizes}
              onFolderSizesChange={onFolderSizesChange}
              onOpenAppStorage={() => openSettingsSection("appStorage")}
            />
          ))}
        {tabs
          .filter((tab) => tab.kind === "split" && tab.split !== undefined && mountedSplits.has(tab.id))
          .map((tab) => (
            <div key={tab.id} className="adp-tabpane" hidden={tab.id !== activeId}>
              <SplitTabView
                tab={tab}
                active={tab.id === activeId}
                onSplitChange={(split) => {
                  const current = tabsState.tabs.find((entry) => entry.id === tab.id);
                  const swapped =
                    current !== undefined &&
                    isSplitTab(current) &&
                    split.first.view_id === current.split.second.view_id &&
                    split.second.view_id === current.split.first.view_id;
                  if (swapped) {
                    // The panes exchange their leaves; decide dirty work first.
                    void swapSplitFromUi(tab.id);
                    return;
                  }
                  setTabsState((state) => {
                    try {
                      return setSplitState(state, tab.id, split);
                    } catch {
                      return state;
                    }
                  });
                }}
                onCloseSide={(side) => closeSplitSideFromUi(tab.id, side)}
                onOpenHelp={(slug) => openTab("help", slug)}
                onLeafCommand={(_viewId, commandId) => {
                  if (commandId === "tab.splitSwap") void swapSplitFromUi(tab.id);
                  else applySplitCommand(tab.id, commandId);
                }}
                renderLeaf={(leaf, side, leafActive, visible) =>
                  renderSplitLeaf(tab, leaf, side, leafActive, visible)
                }
                confirmCloseLeaves={async (leaves) => unsaved.confirmClose(leaves.map((leaf) => leaf.view_id))}
              />
            </div>
          ))}
        {activeTab.kind === "help" ? (
          <Suspense fallback={null}><HelpCenter
            lang={settings.language}
            requestedSlug={helpSlug}
            onOpenHelp={(slug) => openTab("help", slug)}
          /></Suspense>
        ) : null}
        {activeTab.kind === "settings" ? (
          <Suspense fallback={null}><SettingsView
            active={activeTab.kind === "settings"}
            settings={settings}
            onApply={applySettings}
            onOpenHelp={() => openTab("help", "the-settings-page")}
            onOpenHelpPage={(slug) => openTab("help", slug)}
            systemReducedMotion={systemAccessibility.reduced_motion}
            forcedColors={systemAccessibility.forced_colors}
            customThemes={customThemeSummaries}
            onEditTheme={() => { void openThemeEditor(); }}
            toolbarDescriptors={TOOLBAR_DESCRIPTORS}
            commandLabels={commandLabels}
            keyboardDefaults={keyboardDefaults}
            onApplyToolbarCustom={applyToolbarCustom}
            onApplyKeyboardCustom={applyKeyboardCustom}
            commands={registeredCommands}
            onPickSelection={
              pickActive || (explorerStats.selectedPaths?.length ?? 0) > 0
                ? () => pickSelection(explorerStats.selectedPaths ?? [])
                : undefined
            }
            onCancelPick={cancelPick}
            pickActive={pickActive}
            onFocusLayout={toggleFocusLayout}
            focusLayoutActive={focusLayoutActive}
          /></Suspense>
        ) : null}
        {activeTab.kind === "gallery" ? (
          <Suspense fallback={null}><GalleryView onOpenHelp={() => openTab("help", "using-help")} /></Suspense>
        ) : null}
        </div>
        {settings.shelf.visible && settings.shelf.side !== "left" ? shelfElement : null}
        </div>
      </main>
      {assistantOpen ? (
        <AssistantPanel
          active
          enabled={settings.assistant.enabled}
          initialBackend={settings.assistant.backend}
          initialProviderId={settings.assistant.provider_id}
          localSource={settings.assistant.local_source}
          scopeRootPath={assistantScopeRoot}
          onClose={() => setAssistantOpen(false)}
          onOpenHelp={(slug) => openTab("help", slug)}
        />
      ) : null}
      </div>
      </ToolbarCustomSettingsProvider>
      </KeyTipsContext.Provider>
      </div>

      <footer
        className="adp-statusbar"
        hidden={
          activeTab.kind === "file" ||
          activeTab.kind === "split" ||
          (activeTab.kind === "explorer" && !settings.shell_custom.status.visible)
        }
      >
        {activeTab.kind === "explorer" ? (
          <>
            <StatusFieldHost
              registry={statusFields}
              ownerId="explorer"
              order={settings.shell_custom.status.orders.explorer ?? []}
              visible={settings.shell_custom.status.visible}
            />
            {explorerStats.viewMode !== null ? (
              <span className="adp-status-views">
                <IconButton
                  icon={List}
                  labelKey="commands.viewDetails"
                  className="adp-status-view-btn"
                  pressed={explorerStats.viewMode === "details"}
                  shortcut={viewModeShortcut("details")}
                  commandId={VIEW_MODE_COMMANDS.details}
                  onClick={() => setViewModeRequest({ mode: "details", nonce: (viewModeRequest?.nonce ?? 0) + 1 })}
                />
                {settings.explorer.hidden_view_modes.includes("largeIcons") ? null : (
                  <IconButton
                    icon={LayoutGrid}
                    labelKey="commands.viewLargeIcons"
                    className="adp-status-view-btn"
                    pressed={explorerStats.viewMode === "largeIcons"}
                    shortcut={viewModeShortcut("largeIcons")}
                    commandId={VIEW_MODE_COMMANDS.largeIcons}
                    onClick={() => setViewModeRequest({ mode: "largeIcons", nonce: (viewModeRequest?.nonce ?? 0) + 1 })}
                  />
                )}
              </span>
            ) : null}
          </>
        ) : (
          <span>{t("common.ready")}</span>
        )}
        <span>
          <TabIcon size={12} aria-hidden="true" />
        </span>
      </footer>
      {pickDropOpen
        ? (() => {
            const envelope = pickControllerRef.current?.getEnvelope();
            if (!envelope) return null;
            return (
              <TransferChoiceDialog
                envelope={envelope}
                actions={pickControllerRef.current?.targets() ?? []}
                onChoose={choosePickAction}
                onCancel={cancelPick}
              />
            );
          })()
        : null}
      {tabMenu ? (
        <TabContextMenu
          tab={tabMenu.tab}
          hasClosedTabs={closedTabsOf(tabsState).length > 0}
          canSplit={canSplitNow(tabMenu.tab)}
          anchor={{ kind: "point", x: tabMenu.anchor.x, y: tabMenu.anchor.y }}
          lookup={(id) => tabCommandRegistry.get(id)}
          onRun={runTabCommand}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
      {groupMenu ? (() => {
        const group = (tabsState.groups ?? []).find((entry) => entry.id === groupMenu.groupId);
        if (!group) return null;
        return (
          <TabGroupMenu
            group={group}
            anchor={groupMenu.anchor}
            onClose={closeGroupMenu}
            onRename={() => {
              const current = group;
              setGroupMenu(null);
              openGroupRename(current);
            }}
            onColor={(color: GroupColor) =>
              changeGroup((current) => patchTabGroup(current, group.id, { color }))
            }
            onToggleCollapse={() =>
              changeGroup((current) =>
                patchTabGroup(current, group.id, { collapsed: !group.collapsed }),
              )
            }
            onUngroup={() => changeGroup((current) => ungroupTabGroup(current, group.id))}
            onCloseGroup={() => void closeGroupById(group.id)}
            onSave={() =>
              void saveGroupToCatalog(group.id).catch((error: unknown) =>
                notify(errorText(t, error, "groups")),
              )
            }
            onSaveAndClose={() =>
              void saveAndCloseGroupById(group.id).catch((error: unknown) =>
                notify(errorText(t, error, "groups")),
              )
            }
          />
        );
      })() : null}
      {groupDialog ? (
        <Dialog
          title={groupDialog.mode === "create" ? t("groups.new") : t("groups.rename")}
          onClose={() => setGroupDialog(null)}
          className="adp-tab-group-dialog"
        >
          <div className="adp-tab-group-dialog-body">
            <TextInput
              value={groupName}
              onChange={setGroupName}
              ariaLabel={t("groups.name")}
              maxLength={60}
            />
            <div className="adp-tab-group-colors" role="group" aria-label={t("groups.color")}>
              {GROUP_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="menuitemradio"
                  aria-checked={groupColor === color}
                  aria-label={t(`groups.${color}`)}
                  title={t(`groups.${color}`)}
                  className={`adp-tab-group-color adp-tab-group-color--${color}`}
                  onClick={() => setGroupColor(color)}
                >
                  <span className="adp-tab-group-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
            {groupError ? <p role="alert">{groupError}</p> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 8 }}>
              <Button onClick={() => setGroupDialog(null)}>{t("common.cancel")}</Button>
              <Button onClick={submitGroupDialog}>{t("common.save")}</Button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {savedGroupsOpen ? (
        <Dialog
          title={t("groups.saved")}
          onClose={() => setSavedGroupsOpen(false)}
          className="adp-saved-groups-dialog"
        >
          <SavedGroupsPanel
            catalog={savedCatalog}
            loading={savedLoading}
            errorCode={savedError}
            onOpen={openSavedGroupById}
            onRename={renameSavedGroup}
            onRemove={removeSavedGroupFromCatalog}
            onImport={async () => {
              const expectedRevision =
                savedCatalog?.revision ?? (await listSavedGroups()).revision;
              const path = await pickSavedGroupsImport(
                t("groups.import"),
                t("groups.fileFilter"),
              );
              if (!path) return;
              const after = await importSavedGroups(path, expectedRevision);
              setSavedCatalog(after);
              setSavedError(undefined);
            }}
            onExport={async (ids) => {
              const path = await pickSavePath(
                t("groups.export"),
                "groups.adpgroups",
                t("groups.fileFilter"),
              );
              if (path) await exportSavedGroups(ids, path);
            }}
            onOpenHelp={(slug) => {
              setSavedGroupsOpen(false);
              openTab("help", slug);
            }}
          />
        </Dialog>
      ) : null}
      {unsaved.dialog}
      {lockedHost.overlay}
      {recoveryVisible ? (
        <RecoveryDialog
          items={recovery?.page.items ?? []}
          loading={recoveryLoading}
          errorCode={recoveryError ?? undefined}
          copyPath={recoveryCopyPath}
          legacyDrafts={recovery?.legacyDrafts ?? 0}
          onOpen={async (id) => {
            // Exact record id from the reviewed list; originals stay intact.
            const result = await openReviewedRecovery(id);
            setRecoveryCopyPath(result.copy_path);
            // The new app-owned copy goes through the normal open pipeline;
            // a failed open never removes the copy or the record.
            void openFile(result.copy_path, false).catch(() => undefined);
            void refreshRecovery();
          }}
          onDiscard={async (ids) => {
            await discardReviewedRecovery(ids);
            await refreshRecovery();
          }}
          onImportLegacy={async () => {
            const handle = await importLegacyRecovery();
            await handle.completion;
            await refreshRecovery();
          }}
          onLater={() => {
            setRecoveryVisible(false);
            setRecoveryCopyPath(null);
          }}
          onOpenHelp={(slug) => openTab("help", slug)}
        />
      ) : null}
      {diagnosticsSession !== null ? (
        <DiagnosticsDialog
          key={diagnosticsSession.id}
          session={diagnosticsSession}
          onEdit={async (edits) => {
            const next = await editDiagnostics(diagnosticsSession.id, edits);
            setDiagnosticsSession(next);
          }}
          onSave={async () => {
            const dest = await pickSavePath(
              t("diagnostics.save"),
              "Adperastra-diagnostics.zip",
              t("archive.format.zip"),
            );
            if (!dest) return;
            const path = dest.toLowerCase().endsWith(".zip") ? dest : `${dest}.zip`;
            const handle = await saveDiagnostics(diagnosticsSession.id, path);
            await handle.completion;
            await closeDiagnostics(diagnosticsSession.id).catch(() => undefined);
            setDiagnosticsSession(null);
          }}
          onOpenIssue={() => openProblemPage(t("diagnostics.title"), [])}
          onClose={() => {
            const id = diagnosticsSession.id;
            setDiagnosticsSession(null);
            void closeDiagnostics(id).catch(() => undefined);
          }}
          onOpenHelp={(slug) => openTab("help", slug)}
        />
      ) : null}
      {lockPaths !== null ? (
        <FilesInUseDialog
          paths={lockPaths}
          onRetry={async () => setLockPaths(null)}
          onClose={() => setLockPaths(null)}
          onOpenHelp={(slug) => openTab("help", slug)}
        />
      ) : null}
      <TransferHost onOpenHelp={(slug) => openTab("help", slug)} />
      {compressSources !== null ? (
        <CompressDialog
          sources={compressSources}
          initialFolder={parentPathOf(compressSources[0] ?? "") ?? ""}
          onCreate={async (request) => {
            const job = await archiveCreate(request);
            await job.completion;
            setCompressSources(null);
          }}
          onClose={() => setCompressSources(null)}
          onOpenHelp={() => openTab("help", "creating-archives")}
        />
      ) : null}
      {privacyInputs !== null ? (
        <Suspense fallback={null}>
          <PrivacyDialog
            inputs={privacyInputs}
            onClose={() => setPrivacyInputs(null)}
            onCompleted={() => setPrivacyInputs(null)}
            onOpenHelp={(slug) => openTab("help", slug)}
          />
        </Suspense>
      ) : null}
      {convertInputs !== null ? (
        <Suspense fallback={null}>
          <QuickConvertDialog
            inputs={convertInputs}
            onClose={() => setConvertInputs(null)}
            onCompleted={() => setConvertInputs(null)}
            onOpenHelp={(slug) => openTab("help", slug)}
          />
        </Suspense>
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          registry={paletteRegistry}
          host={paletteHost}
          locale={language}
          recentIds={settings.palette.recent_ids}
          onUsed={onPaletteUsed}
          onClose={() => setPaletteOpen(false)}
          onOpenHelp={(slug) => {
            setPaletteOpen(false);
            openTab("help", slug);
          }}
        />
      ) : null}
      {themeEditorDraft ? (
        <ThemeEditor
          draft={themeEditorDraft}
          onSave={saveThemeFromEditor}
          onCancel={() => setThemeEditorDraft(null)}
          onOpenHelp={(slug) => openTab("help", slug)}
        />
      ) : null}
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((list) => list.filter((toast) => toast.id !== id))}
      />
      <AnnouncementRegion queue={announcementQueueRef.current!} />
    </div>
    </LayoutContext.Provider>
    </AppearanceContext.Provider>
    </AnnouncementContext.Provider>
    </AccessibilityProvider>
    </ShortcutResolutionProvider>
  );
}
