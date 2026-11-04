import { useAccessibilityOptional } from "../accessibility/AccessibilityContext";
import { PICK_DROP_TARGET_ID } from "../accessibility/ClickPickDrop";
import { isUuid } from "../documents/types";
import { useAnnouncementsOptional } from "../accessibility/AnnouncementContext";
import { SELECTION_DEBOUNCE_MS, debounceAnnouncement } from "../accessibility/announcements";
import QuickConvertDialog from "../convert/QuickConvertDialog";
import ClipboardHistoryPanel from "../clipboard/ClipboardHistoryPanel";
import BatchActionsDialog from "../batch/BatchActionsDialog";
import BulkRenameDialog from "../rename/BulkRenameDialog";
import { openTransfer, startHostedTransfer } from "../transfers/TransferHost";
import { ConversionProvider } from "../convert/ConversionContext";
import type { ConversionInput } from "../convert/types";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "../i18n";
import Dialog from "../components/Dialog";
import Menu, { type MenuAnchor } from "../components/Menu";
import Skeleton from "../components/Skeleton";
import TextInput from "../components/TextInput";
import ToastStack, { type ToastData } from "../components/Toast";
import TagImportDialog from "../tags/TagImportDialog";
import TagManager from "../tags/TagManager";
import TagPicker from "../tags/TagPicker";
import type { IndexedViewId } from "../tags/tagCommands";
import {
  applyTagImport,
  assignmentsForPaths,
  exportTags,
  getTagCatalog,
  mutateTagsForPaths,
  pickTagExport,
  pickTagImport,
  reconcileTagMirrors,
  type TagCatalog,
  type TagImportChoice,
  type TagImportPreview,
} from "../services/tags";
import {
  DEFAULT_VIEWS_SETTINGS,
  saveSmartFolder,
  type ViewsSettings,
} from "../services/smartViews";
import {
  VIEW_MODE_COMMANDS,
  createExplorerCommands,
  type ExplorerActions,
  type ViewToggle,
} from "../commands/explorerCommands";
import type { ShortcutScope } from "../keyboard/types";
import { ITEM_MENU, backgroundMenuFor, commandBarFor, resolveMenu } from "../commands/menus";
import { resolveCustomMenu } from "../shell/menuCustomization";
import { createShellCommands, type ShellCommandActions } from "../shell/shellCommands";
import type { NavigationCustomization, ShellCustomization } from "../shell/types";
import { CommandRegistry, isCommandEnabled, type Command, type CommandContext } from "../commands/registry";
import ColumnChooser from "./explorer/views/ColumnChooser";
import {
  defaultColumns,
  getFolderPresentation,
  legacyPresentation,
  setFolderPresentation,
  type ColumnSpec,
  type FolderPresentation,
} from "../services/folderPresentation";
import {
  DEFAULT_SEARCH_SETTINGS,
  getIndexStatus,
  listSavedSearches,
  pauseIndex,
  rebuildIndex,
  removeSavedSearch,
  saveSearch,
  type IndexStatus,
  type SavedSearch,
  type SearchMode,
  type SearchQuery,
  type SearchSettings,
} from "../services/search";
import SearchResultsView from "../search/SearchResultsView";
import AiSearchPanel from "../search/ai/AiSearchPanel";
import IndexSettings from "../search/IndexSettings";
import SortSuggestionChip from "../organize/SortSuggestionChip";
import { moveWithSuggestion } from "../organize/sortSuggestionAdapter";
import { semanticStatus, suggestDestination } from "../services/aiSearch";
import {
  defaultAiSearchSettings,
  type AiNameSuggestion,
  type AiNamingPattern,
  type AiSearchMode,
  type AiSearchSettings,
  type AiSortSuggestion,
} from "../services/aiSearchTypes";
import { acquireAiInput, releaseAiInput } from "../services/localAiArtifacts";
import type { AiInputRef } from "../services/localAiTypes";
import {
  authorizeSnapshotFile,
  releaseExportSnapshot,
  releaseSnapshotAuthority,
  uploadSnapshot,
} from "../services/exportSnapshots";
import { fileDetect, fileGrant, fileRevoke, fileUrl } from "../services/files";
import {
  addFavorite,
  displayPath,
  driveInfo as fetchDriveInfo,
  explorerStateGet,
  listDrives,
  listFavoriteItems,
  listKnownFolders,
  listRecentItems,
  mergeRecentItems,
  openInTerminal,
  openItem,
  openWithDialog,
  parentPathOf,
  pathSegments,
  pathsForClipboard,
  pinFolder,
  recordRecentFolder,
  removeFavorite,
  renameItem,
  samePath,
  shareItems,
  showClassicMenu,
  showProperties,
  startListDir,
  unpinFolder,
  watchStart,
  watchStop,
  type DriveItem,
  type ExplorerItem,
  type ExplorerStateData,
  type KnownFolder,
  type RecentItem,
  type SortDirection,
  type SortKey,
} from "../services/explorer";
import {
  clipboardClear,
  clipboardImageFile,
  clipboardRead,
  clipboardSetFiles,
  clipboardText,
  createItem,
  createShortcut,
  createTextFile,
  entryForJob,
  executeFileAction,
  runFileJob,
  startExternalDrag,
  startFileJob,
  setRetainedTransfers,
  type ConflictPolicy,
  type OpReport,
} from "../services/fileops";
import { toOpReport } from "../services/transferJobs";
import { classifyClipboardText, pastedStamp, pastedTextExtension } from "../services/paste";
import { createTabHoverScheduler, normalizeHoverMs } from "../transfer/useTabDropTarget";
import { routeFileDrop } from "../transfer/tabDropRouting";
import { appTransferRegistry } from "../transfer/TransferRegistry";
import {
  transferError,
  type TransferAction,
  type TransferEnvelope,
  type TransferReceipt,
} from "../transfer/types";
import { createBlank, createFromTemplate } from "../templates/createNew";
import type { BlankKind } from "../templates/catalog";
import TemplatePickerDialog from "../templates/TemplatePickerDialog";
import { formatShortcut } from "../services/shortcuts";
import { appUndoStack, type FileAction, type UndoEntry } from "../services/undo";
import VersionHistoryDialog from "../versions/VersionHistoryDialog";
import { groupItems, type GroupBy } from "../services/grouping";
import { compareSizeValues, resortAllowed } from "./explorer/folderSizeSort";
import { useFolderSizes } from "./explorer/useFolderSizes";
import {
  canGoBack,
  canGoForward,
  createHistory,
  goBack,
  goForward,
  navigate,
  type ExplorerLocation,
  type NavHistory,
} from "../services/navigation";
import {
  EMPTY_SELECTION,
  clearSelection,
  invertSelection,
  pruneSelection,
  selectAll,
  selectOnly,
  summarizeSelection,
  type SelectionState,
} from "../services/selection";
import {
  defaultFolderSizeSettings,
  defaultSettings,
  isTauriRuntime,
  loadSettings,
  type ExplorerViewSettings,
  type FolderSizeSettings,
  type ViewModeId,
} from "../services/settings";
import { useLayout } from "../layout/LayoutContext";
import ClassicMenuBar from "../layout/ClassicMenuBar";
import QuickAccessBar from "../layout/QuickAccessBar";
import ToolbarDock from "../layout/ToolbarDock";
import { CLASSIC_MENU_GROUPS, COMMAND_LAYOUT_REGISTRY } from "../layout/toolbarDescriptors";
import { defaultToolbarCustomSettings, EXPLORER_COMMAND_BAR_ID, type ToolbarCustomSettings } from "../services/commandLayout";
import AddressBar from "./explorer/AddressBar";
import CommandBar from "./explorer/CommandBar";
import {
  PermanentDialog,
  RecentActionsDialog,
  SystemItemsDialog,
} from "./explorer/FileOpDialogs";
import JobsPanel, { type JobView, type TrackJob } from "./explorer/JobsPanel";
import { useArchiveExtract, type ExplorerExtractRequest } from "./explorer/useArchiveExtract";
import { archivePickFolder } from "../services/archive";
import { useArchivePasswordPrompt } from "../archive/useArchivePasswordPrompt";
import CompressDialog from "../archive/CompressDialog";
import { useArchiveCreate } from "./explorer/useArchiveCreate";
import DetailsPane from "./explorer/DetailsPane";
import DriveList, { type DriveLoadState } from "./explorer/DriveList";
import FileList from "./explorer/FileList";
import { fileExtension } from "./explorer/fileTile";
import HomePage, { type HomeTab } from "./explorer/HomePage";
import NavPane from "./explorer/NavPane";
import ItemView from "./explorer/views/ItemView";
import QuickPreviewDialog from "../preview/QuickPreviewDialog";
import { useQuickPreview } from "../preview/useQuickPreview";
import type { ColumnViewOptions } from "./explorer/views/columnTrail";
import { useColumnNavigation } from "./explorer/views/useColumnNavigation";
import { useViewMode } from "./explorer/views/useViewMode";
import { skeletonVariant } from "./explorer/views/viewModes";
import type { GallerySettings } from "../services/gallery";

const GalleryContent = lazy(() => import("./gallery/GalleryContent"));
const AiActionsLauncher = lazy(() => import("../ai-actions/AiActionsLauncher"));
const ExtractionLauncher = lazy(() => import("../extraction/ExtractionLauncher"));
const IndexedViews = lazy(() => import("./IndexedViews"));
const StorageView = lazy(() => import("../storage/StorageView"));
const DuplicateFinder = lazy(() => import("../storage/DuplicateFinder"));

/** What the status bar shows for the Explorer tab. */
export interface ExplorerStats {
  total: number;
  selected: number;
  selectedBytes: number;
  selectedFiles: number;
  /** Selected paths in display order; the App's accessibility hosts read
   * the live selection from here (Step 10f T5). */
  selectedPaths?: readonly string[];
  /** The open folder's view; null when no folder is open. */
  viewMode: ViewModeId | null;
  /** Help page opened by F1 for the current location. */
  helpSlug: string;
}

/** Ask the Explorer to open a folder (and select one item in it). A new
 * `nonce` makes the same request run again. */
export interface ExplorerNavigateRequest {
  folder: string;
  select: string | null;
  nonce: number;
}

/** Status bar view buttons (Step 05a); a new `nonce` runs it again. */
export interface ExplorerViewModeRequest {
  mode: ViewModeId;
  nonce: number;
}

export type ExplorerShortcutDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "first"
  | "last";

const DIRECTION_KEYS: Record<ExplorerShortcutDirection, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  first: "Home",
  last: "End",
};

/** The Command palette's bridge into the live Explorer (Step 09d): its
 * command registry, fresh context and normal dispatch path. Step 10b adds
 * the scoped keyboard surface the one window router asks for. */
export interface ExplorerPaletteBridge {
  registry: CommandRegistry;
  commandContext: () => CommandContext;
  dispatchCommand: (id: string) => void;
  /** Scopes this Explorer surface owns; the search overlay owns all keys. */
  shortcutScopes?: () => readonly ShortcutScope[];
  /** Vim-style item navigation through the view's own direction model. */
  navigate?: (direction: ExplorerShortcutDirection) => void;
  /** Vim's "/": focus the folder filter box. */
  focusFilter?: () => void;
}

/** A stable registry facade for the palette: `list` and `get` always read
 * the newest command closures without publishing a new bridge each render. */
class LiveCommandRegistry extends CommandRegistry {
  constructor(private readonly latest: () => readonly Command[]) { super(); }
  list(): Command[] { return [...this.latest()]; }
  get(id: string): Command | undefined { return this.latest().find((command) => command.id === id); }
}

export interface ExplorerHomeProps {
  conversionRequest?: import("../convert/types").ConversionOpenRequest | null;
  /** False while another tab is shown: shortcuts and drops are ignored. */
  active?: boolean;
  /** Effective double-click delay from Windows or the accessibility setting
   * (Step 10f D8); item views default to 500 ms when absent. */
  doubleClickMs?: number;
  /** A click-pick lease is active: folders become click drop targets. */
  pickActive?: boolean;
  /** Ask the App to show the normal operation choice before a pick drops. */
  onPickDropRequest?: () => void;
  onStatsChange?: (stats: ExplorerStats) => void;
  onOpenHelp: (slug?: string) => void;
  /** Folder tabs (Step 09a): start at this folder and restore its view. */
  initialLocation?: string;
  initialFolderState?: import("../services/folderState").FolderTabState;
  /** A watcher or reactivation asks this folder tab to list again. */
  rescanNonce?: number;
  /** Report this instance's view state to its owning folder tab. */
  onFolderStateChange?: (state: import("../services/folderState").FolderTabState) => void;
  /** Defer quick preview to the folder tab's own preview host. */
  onPreviewItem?: (item: ExplorerItem | null) => void;
  /** The item the folder tab's preview host is showing; lets Space toggle it. */
  previewItem?: ExplorerItem | null;
  /** The folder currently shown; used to open it in a new folder tab. */
  onLocationChange?: (path: string | null) => void;
  /** Collect the selected paths on the app shelf (Step 09g). */
  onAddToShelf?: (paths: readonly string[]) => void;
  /** Open Files in use for the selection (Step 09g). */
  onShowFileLocks?: (paths: readonly string[]) => void;
  /** Open the local diagnostic review (Step 09h). */
  onReportProblem?: () => void;
  /** Open the reviewed recovery list (Step 09h). */
  onOpenRecovery?: () => void;
  /** Open a mounted image's drive as a normal folder tab (Step 09a). */
  onOpenMountedDrive?: (root: string) => void;
  /** Open a file through the app's open pipeline (Step 04a). Rejects with
   * a `files.*` error code. Without it, files open in their Windows app. */
  onOpenFile?: (path: string, background: boolean) => Promise<void>;
  /** "Open as text" and "Open as hex" (Step 04c): show a file in a chosen viewer. */
  onOpenFileWith?: (path: string, handlerId: string) => void;
  navigateRequest?: ExplorerNavigateRequest | null;
  /** Status bar view buttons (Step 05a); a new `nonce` runs it again. */
  viewModeRequest?: ExplorerViewModeRequest | null;
  /** View options from settings (schema 3); defaults when absent. */
  view?: ExplorerViewSettings;
  onViewChange?: (patch: Partial<ExplorerViewSettings>) => void;
  /** Tag and indexed-view settings (schema 35). */
  views?: ViewsSettings;
  /** Pasted-image format from settings (schema 4). */
  pasteImageFormat?: "png" | "jpg";
  /** An extraction an archive tab asked for (Step 06d). */
  extractRequest?: ExplorerExtractRequest | null;
  /** The My templates folder from settings (schema 11, Step 06c). */
  templatesFolder?: string;
  onTemplatesFolderChange?: (folder: string) => void | Promise<void>;
  /** Settings > Version history is on (Step 06b); true when absent. */
  versionsEnabled?: boolean;
  /** Gallery settings (schema 13). */
  gallery?: GallerySettings;
  onGallerySettingsChange?: (next: GallerySettings) => Promise<void>;
  /** Indexed folders and search defaults (schema 34, Step 11a). */
  searchSettings?: SearchSettings;
  onSearchSettingsChange?: (next: SearchSettings) => void;
  /** Optional background folder sizes (schema 36, Step 11c). */
  folderSizes?: FolderSizeSettings;
  onFolderSizesChange?: (next: FolderSizeSettings) => void;
  /** Opens the App storage section of the Settings page. */
  onOpenAppStorage?: () => void;
  /** Command palette (Step 09d): publish the live registry/context under
   * this Explorer's tab id, and open the palette through the app command. */
  onPaletteBridge?: (owner: string, bridge: ExplorerPaletteBridge | null) => void;
  paletteOwnerId?: string;
  onOpenCommandPalette?: () => void;
  /** Delay before a file drag over a tab activates it (Step 09c D2). */
  dragHoverMs?: number;
  onActivateTab?: (tabId: string) => void;
  onDropFilesOnTab?: (tabId: string, paths: readonly string[]) => Promise<unknown>;
  /** Tab-group and saved-group commands whose host is the App (Steps 09a/09b). */
  featureActions?: import("../commands/featureCommands").FeatureCommandActions;
  /** Open the saved-groups catalog from the navigation pane (Step 09b). */
  onSavedGroups?: () => void;
  /** Saved toolbar customization (schema 29, Step 10b); defaults when absent. */
  toolbarCustom?: ToolbarCustomSettings;
  /** Open Settings > Customize toolbars / Keyboard shortcuts. */
  onCustomizeToolbar?: () => void;
  onCustomizeShortcuts?: () => void;
  /** Saved shell customization (schema 32, Step 10e). */
  shellCustom?: ShellCustomization;
  onShellCustomChange?: (next: ShellCustomization) => void;
  /** Step 10e commands (edit menus/Home/navigation/status, setup files). */
  shellCommandActions?: ShellCommandActions;
}

const DEFAULT_VIEW: ExplorerViewSettings = defaultSettings().explorer;
const DEFAULT_FOLDER_SIZES: FolderSizeSettings = defaultFolderSizeSettings();
const DEFAULT_TOOLBAR_CUSTOM = defaultToolbarCustomSettings();

/** A storage scan or duplicate review shown in place of the folder list. */
interface StoragePaneState {
  kind: "storage" | "duplicates";
  root: string;
  nonce: number;
}

/** A fresh query for the search overlay; the saved default mode is applied
 * each time the overlay opens, never to a query already typed. */
function emptySearchQuery(mode: SearchMode): SearchQuery {
  return {
    mode,
    text: "",
    roots: [],
    regex_scope: "name",
    match_case: false,
    sort: { key: "name", direction: "ascending" },
  };
}

/** The toggles behind the View menu that patch one boolean field. */
const VIEW_SETTING: Record<ViewToggle, "details_pane" | "show_hidden" | "show_extensions" | "item_checkboxes"> = {
  detailsPane: "details_pane",
  showHidden: "show_hidden",
  showExtensions: "show_extensions",
  itemCheckboxes: "item_checkboxes",
};

/** Opening many files at once stops here, like Windows' own limit. */
const OPEN_LIMIT = 15;

function normalizeState(state: ExplorerStateData): ExplorerStateData {
  return {
    ...state,
    pinned_folders: state.pinned_folders.map(displayPath),
    recent_folders: state.recent_folders.map(displayPath),
    favorites: (state.favorites ?? []).map(displayPath),
  };
}

function toExplorerItem(item: RecentItem): ExplorerItem {
  return {
    path: item.path,
    name: item.name,
    kind: item.kind,
    size: item.size,
    modified_unix: item.modified_unix,
    hidden: false,
    system: false,
    is_link: false,
    online_only: false,
    file_id: null,
    file_id_stable: false,
  };
}

/** Error codes from Rust look like `rename.exists`; the UI shows the
 * matching translated message, or the action's generic one. */
function errorReason(error: unknown, action: string): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return raw.startsWith(`${action}.`) ? raw.slice(action.length + 1) : "other";
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

interface AiPathLease {
  input: AiInputRef;
  release: () => Promise<void>;
}

/** One explicit, released 14c input lease for a selected file. Used only by
 * the history-only destination suggestion; no background read. */
async function acquireAiPathLease(path: string): Promise<AiPathLease> {
  const token = await fileGrant(path);
  let snapshotId: string | null = null;
  let authorityId: string | null = null;
  try {
    const info = await fileDetect(path);
    if (info.size <= 0) throw new Error("ai_search.invalid");
    const authority = await authorizeSnapshotFile(token);
    authorityId = authority.document_id;
    const response = await fetch(fileUrl(token, info.name));
    if (!response.ok) throw new Error("ai_search.failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== info.size || bytes.byteLength === 0) {
      throw new Error("ai_search.changed");
    }
    if (typeof crypto.subtle?.digest !== "function") throw new Error("ai_search.failed");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const contentId = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const snapshot = await uploadSnapshot(
      {
        document_id: authority.document_id,
        revision: 1,
        content_id: contentId,
        mime: authority.mime || info.mime || "application/octet-stream",
        byte_len: bytes.byteLength,
      },
      bytes,
    );
    snapshotId = snapshot.snapshot_id;
    const input = await acquireAiInput({
      kind: "snapshot",
      snapshot_id: snapshot.snapshot_id,
      document_id: snapshot.document_id,
      revision: snapshot.revision,
    });
    return {
      input,
      release: async () => {
        await releaseAiInput(input.id).catch(() => undefined);
        await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
        if (authorityId) await releaseSnapshotAuthority(authorityId).catch(() => undefined);
        await fileRevoke(token).catch(() => undefined);
      },
    };
  } catch (error) {
    if (snapshotId) await releaseExportSnapshot(snapshotId).catch(() => undefined);
    if (authorityId) await releaseSnapshotAuthority(authorityId).catch(() => undefined);
    await fileRevoke(token).catch(() => undefined);
    throw error;
  }
}

interface OpenMenu {
  kind: "item" | "background";
  anchor: MenuAnchor;
  startedAt: number;
  focusFirst: boolean;
}

/** Accent- and case-insensitive text, for matching typed place names. */
function plainText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export default function ExplorerHome({
  active = true,
  doubleClickMs,
  pickActive = false,
  onPickDropRequest,
  onStatsChange,
  onOpenHelp,
  initialLocation,
  initialFolderState,
  rescanNonce = 0,
  onFolderStateChange,
  onPreviewItem,
  previewItem = null,
  onLocationChange,
  onAddToShelf,
  onShowFileLocks,
  onReportProblem,
  onOpenRecovery,
  onOpenMountedDrive,
  onOpenFile,
  onOpenFileWith,
  navigateRequest = null,
  viewModeRequest = null,
  view: viewProp,
  onViewChange,
  views = DEFAULT_VIEWS_SETTINGS,
  pasteImageFormat = "png",
  extractRequest = null,
  conversionRequest = null,
  templatesFolder = "",
  onTemplatesFolderChange,
  versionsEnabled = true,
  gallery = defaultSettings().gallery,
  onGallerySettingsChange,
  searchSettings,
  onSearchSettingsChange,
  folderSizes = DEFAULT_FOLDER_SIZES,
  onFolderSizesChange,
  onOpenAppStorage,
  onPaletteBridge,
  paletteOwnerId,
  onOpenCommandPalette,
  dragHoverMs,
  onActivateTab,
  onDropFilesOnTab,
  featureActions,
  onSavedGroups,
  toolbarCustom = DEFAULT_TOOLBAR_CUSTOM,
  onCustomizeToolbar,
  onCustomizeShortcuts,
  shellCustom,
  onShellCustomChange,
  shellCommandActions,
}: ExplorerHomeProps) {
  const { t, i18n } = useTranslation();
  const simpleMode = useAccessibilityOptional()?.settings.simple_mode ?? false;
  // Pick targets are offered by the active Explorer only: an inactive tab
  // (or the painted other half of a split) never registers them, so it must
  // not swallow folder clicks either.
  const pickDropEnabled = pickActive && active;
  const announcements = useAnnouncementsOptional();
  const { layout } = useLayout();
  const activeRef = useRef(active);
  activeRef.current = active;
  // Item views own their direction model; the keyboard host reaches it
  // through this root with the same arrow keys the views already handle.
  const rootRef = useRef<HTMLDivElement>(null);
  const view = viewProp ?? DEFAULT_VIEW;
  // Indexed folders are persisted by App; this tab only edits a copy.
  const searchConfig = searchSettings ?? DEFAULT_SEARCH_SETTINGS;
  const searchSettingsRef = useRef(searchConfig);
  searchSettingsRef.current = searchConfig;
  const [history, setHistory] = useState<NavHistory>(() =>
    createHistory(initialLocation ? { type: "folder", path: initialLocation } : { type: "home" }),
  );
  const location = history.current;
  // The folder's own view when it has one, else the default view (Step 05a).
  const viewModeState = useViewMode({
    view,
    onViewChange,
    folderPath: location.type === "folder" ? location.path : null,
  });
  const viewModeRef = useRef(viewModeState);
  viewModeRef.current = viewModeState;
  const [knownFolders, setKnownFolders] = useState<KnownFolder[]>([]);
  const [stateData, setStateData] = useState<ExplorerStateData>({ schema_version: 2, pinned_folders: [], recent_folders: [], favorites: [] });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<RecentItem[]>([]);
  const [homeTab, setHomeTab] = useState<HomeTab>("recent");
  const [favoritesNonce, setFavoritesNonce] = useState(0);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveStates, setDriveStates] = useState<Record<string, DriveLoadState>>({});
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(initialFolderState?.sort.key ?? "name");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialFolderState?.sort.direction ?? "ascending",
  );
  // Folder tabs keep their grouping in their own FolderTabState (Step 09a);
  // the permanent Explorer keeps the global setting.
  const folderTab = initialFolderState !== undefined;
  const [folderGroupBy, setFolderGroupBy] = useState<GroupBy>(
    () => initialFolderState?.group_by ?? "none",
  );
  const activeGroupBy: GroupBy = folderTab ? folderGroupBy : view.group_by;
  const [loading, setLoading] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [partialCount, setPartialCount] = useState(0);
  const [skeletonVisible, setSkeletonVisible] = useState(false);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [galleryRequest, setGalleryRequest] = useState<
    { kind: "add" | "remove"; nonce: number } | null
  >(null);
  const [gallerySourceSelected, setGallerySourceSelected] = useState(false);
  const [galleryCount, setGalleryCount] = useState(0);
  const {
    preview: quickPreviewSelection,
    toggle: toggleQuickPreview,
    close: closeQuickPreview,
  } = useQuickPreview();
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [compressRequest, setCompressRequest] = useState<{ sources: string[]; folder: string } | null>(
    null,
  );
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  // File operations (Step 03b): undo stack, jobs, and dialogs.
  const conversionRelease = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!conversionRequest) return;
    conversionRelease.current = conversionRequest.release;
    setConversionInputs(conversionRequest.inputs);
  }, [conversionRequest]);
  const [conversionInputs, setConversionInputs] = useState<ConversionInput[] | null>(null);
  const [bulkRenamePaths, setBulkRenamePaths] = useState<string[] | null>(null);
  const [batchInputs, setBatchInputs] = useState<ConversionInput[] | null>(null);
  const undoStack = useRef(appUndoStack);
  const [, setUndoVersion] = useState(0);
  const toastEntryRef = useRef(new Map<number, number>());
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const jobCancelRef = useRef(new Map<string, () => void>());
  const jobIdRef = useRef(0);
  // Click-pick target (Step 10f E4): the folder chosen by the last click and
  // the transfer performer, read by the registered target when it accepts.
  const pickDestRef = useRef<string | null>(null);
  const performCopyMoveRef = useRef<
    ((kind: "copy" | "move", sources: string[], destDir: string) => Promise<OpReport | null>) | null
  >(null);
  const [permanentAsk, setPermanentAsk] = useState<{
    count: number;
    answer: (confirmed: boolean) => void;
  } | null>(null);
  const systemQueue = useRef<((confirmed: boolean) => void)[]>([]);
  const [systemAsk, setSystemAsk] = useState<((confirmed: boolean) => void) | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  // The template window (Step 06c).
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // The indexed search overlay and Settings > Indexing window (Step 11a).
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;
  // A new number remounts the results view, so Ctrl+F focuses its box again.
  const [searchNonce, setSearchNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(() =>
    emptySearchQuery(searchSettings?.default_mode ?? DEFAULT_SEARCH_SETTINGS.default_mode),
  );
  // AI search and organizing (Step 17c): the panel, the reviewed rename
  // suggestions and the inline destination chip are hosted here. Opt-ins and
  // natural-language roots come from the saved settings; a missing provider
  // keeps every AI control disabled.
  const [aiSearchMode, setAiSearchMode] = useState<AiSearchMode | null>(null);
  const [aiSearchSettings, setAiSearchSettings] = useState<AiSearchSettings>(() =>
    defaultAiSearchSettings(),
  );
  const [aiProviderReady, setAiProviderReady] = useState(false);
  const [aiNameReview, setAiNameReview] = useState<{
    suggestions: AiNameSuggestion[];
    pattern: AiNamingPattern;
  } | null>(null);
  const [aiSortChip, setAiSortChip] = useState<{
    suggestion: AiSortSuggestion;
    sourcePath: string;
    destinationLabel: string;
  } | null>(null);
  const aiSearchSettingsRef = useRef(aiSearchSettings);
  aiSearchSettingsRef.current = aiSearchSettings;
  const aiProviderReadyRef = useRef(aiProviderReady);
  aiProviderReadyRef.current = aiProviderReady;
  const aiSortNeverRef = useRef(new Set<string>());
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  // Tags (Step 11b): one picker for the live selection, the catalog window,
  // and the parsed import preview. Only one tag dialog is open at a time.
  const [tagPicker, setTagPicker] = useState<{
    paths: string[];
    catalog: TagCatalog;
    value: string[];
  } | null>(null);
  const [tagManager, setTagManager] = useState<TagCatalog | null>(null);
  const [tagImport, setTagImport] = useState<TagImportPreview | null>(null);
  // The indexed view chosen by a command; null shows the ordinary folder.
  const [indexedView, setIndexedView] = useState<IndexedViewId | null>(null);
  // A storage scan or duplicate review replaces the listing until closed.
  const [storagePane, setStoragePane] = useState<StoragePaneState | null>(null);
  // Saving the live query as a smart folder (Step 11b).
  const [smartFolderOpen, setSmartFolderOpen] = useState(false);
  const [smartFolderName, setSmartFolderName] = useState("");
  const [smartFolderBusy, setSmartFolderBusy] = useState(false);
  // The file whose Version history window is open (Step 06b).
  const [historyFor, setHistoryFor] = useState<ExplorerItem | null>(null);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const pendingRenameRef = useRef<string | null>(null);
  const [dragBadge, setDragBadge] = useState<{ x: number; y: number; key: string; name: string } | null>(null);
  const loadModeRef = useRef<"hard" | "soft">("hard");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [columnsNonce, setColumnsNonce] = useState(0);
  // The Details column chooser's active value, and the serialized writes
  // that remember it per folder (Step 09d T2).
  const [columnChooser, setColumnChooser] = useState<readonly ColumnSpec[] | null>(null);
  const presentationWrites = useRef<Promise<void>>(Promise.resolve());
  const [homeNonce, setHomeNonce] = useState(0);
  const generationRef = useRef(0);
  type CancelFn = Awaited<ReturnType<typeof startListDir>>["cancel"];
  const cancelRef = useRef<CancelFn | null>(null);
  const benchRef = useRef<{ generation: number; startedAt: number; done: boolean }>({ generation: 0, startedAt: 0, done: false });
  const pendingSelectRef = useRef<string | null>(null);
  const toastIdRef = useRef(0);
  // Where "Show more options" opens: the last right-click point.
  const lastPointer = useRef({ x: 0, y: 0 });

  const notify = useCallback((message: string) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((list) => [...list.slice(-2), { id, message }]);
  }, []);
  const notifyError = useCallback(
    (error: unknown, action: string) => {
      const reason = errorReason(error, action);
      notify(t(`errors.${action}.${reason}`, { defaultValue: t(`errors.${action}.other`) }));
    },
    [notify, t],
  );
  /** Errors from file operations carry their own prefix (ops.*, ...). */
  const notifyOpError = useCallback(
    (error: unknown) => {
      const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      const action = ["ops", "rename", "clipboard", "image", "shortcut"].find((name) =>
        raw.startsWith(`${name}.`),
      );
      if (action) notifyError(error, action);
      else notify(t("errors.ops.other"));
    },
    [notify, notifyError, t],
  );
  const touchUndo = useCallback(() => {
    setRetainedTransfers(undoStack.current.retainedEntries);
    setUndoVersion((value) => value + 1);
  }, []);
  /** Toast for a finished action, with an Undo button wired to its entry. */
  const notifyAction = useCallback(
    (message: string, entry: UndoEntry | null) => {
      toastIdRef.current += 1;
      const id = toastIdRef.current;
      if (entry) toastEntryRef.current.set(id, entry.id);
      setToasts((list) => [
        ...list.slice(-2),
        {
          id,
          message,
          showUndo: entry !== null,
          shortcutHint: entry ? formatShortcut("Ctrl+Z", t) : undefined,
        },
      ]);
    },
    [t],
  );

  const goToLocation = useCallback((next: ExplorerLocation) => {
    setSearch("");
    setSelection(EMPTY_SELECTION);
    setRenamingPath(null);
    setMenu(null);
    setPartialCount(0);
    setItems([]);
    setIndexedView(null);
    setStoragePane(null);
    setSearchOpen(false);
    setHistory((current) => navigate(current, next));
  }, []);

  const goToFolder = useCallback((path: string) => goToLocation({ type: "folder", path: displayPath(path) }), [goToLocation]);

  const refresh = useCallback(() => {
    if (location.type === "folder") {
      loadModeRef.current = "soft";
      setRefreshNonce((value) => value + 1);
      // F5 and every file operation reload the side columns too (Step 05b D7).
      setColumnsNonce((value) => value + 1);
    } else if (location.type === "home") setHomeNonce((value) => value + 1);
    else if (location.type === "drives") setRefreshNonce((value) => value + 1);
  }, [location.type]);

  const typeLabel = useCallback(
    (item: ExplorerItem) => {
      if (item.kind === "folder" || item.kind === "drive") return t("explorer.folderType");
      const ext = fileExtension(item.name);
      return ext ? t("explorer.fileType", { ext: ext.toUpperCase() }) : t("explorer.genericFile");
    },
    [t],
  );

  // ---------------------------------------------------------------------
  // The list on screen: folder items (hidden items only when shown), or
  // the Home page's Recent/Favorites list.
  // ---------------------------------------------------------------------
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) => (view.show_hidden || !(item.hidden || item.system)) && (!query || item.name.toLowerCase().includes(query)),
    );
  }, [items, search, view.show_hidden]);

  // Optional background folder sizes (Step 11c T6): only folder rows in
  // the current listing, plus the Details pane's folder when that setting
  // asks for it. Consumers are released when the pane or the view hides.
  const listedFolderPaths = useMemo(
    () =>
      filteredItems
        .filter((item) => item.kind === "folder")
        .map((item) => item.path),
    [filteredItems],
  );
  const detailsFolderPaths = useMemo(() => {
    if (!view.details_pane) return [];
    if (selection.selected.size === 1) {
      const [path] = selection.selected;
      const item = filteredItems.find((entry) => entry.path === path);
      return item?.kind === "folder" ? [path] : [];
    }
    if (selection.selected.size === 0 && location.type === "folder") {
      return [location.path];
    }
    return [];
  }, [filteredItems, location, selection.selected, view.details_pane]);
  const folderSizeState = useFolderSizes({
    active: active && storagePane === null,
    enabled: folderSizes.enabled,
    network: folderSizes.network,
    details: folderSizes.details,
    // The Size column lives in the Details view; other modes request only
    // what the Details pane explicitly shows.
    folders: viewModeState.mode === "details" ? listedFolderPaths : [],
    detailsFolders: detailsFolderPaths,
  });
  // A size-sorted list uses ready values; unknown folders stay last in both
  // directions. An open inline rename keeps the last drawn order, so an
  // arriving value or a re-render cannot move the row under the editor.
  const lastSizeOrder = useRef<ExplorerItem[]>([]);
  const visibleItems = useMemo(() => {
    if (sortKey !== "size" || !folderSizeState.enabled) {
      lastSizeOrder.current = [];
      return filteredItems;
    }
    if (!resortAllowed(renamingPath)) {
      return lastSizeOrder.current.length > 0
        ? lastSizeOrder.current
        : filteredItems;
    }
    const sorted = [...filteredItems].sort((left, right) =>
      compareSizeValues(
        {
          path: left.path,
          file_bytes: left.size,
          is_folder: left.kind === "folder",
          folder_size: folderSizeState.valueFor(left.path),
        },
        {
          path: right.path,
          file_bytes: right.size,
          is_folder: right.kind === "folder",
          folder_size: folderSizeState.valueFor(right.path),
        },
        sortDirection,
      ),
    );
    lastSizeOrder.current = sorted;
    return sorted;
  }, [
    filteredItems,
    folderSizeState.enabled,
    folderSizeState.valueFor,
    renamingPath,
    sortDirection,
    sortKey,
  ]);

  const recentMerged = useMemo(() => mergeRecentItems(recent, stateData.recent_folders), [recent, stateData.recent_folders]);

  const homeItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = homeTab === "favorites" ? favoriteItems : recentMerged;
    return source.map(toExplorerItem).filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [homeTab, favoriteItems, recentMerged, search]);

  const groups = useMemo(
    () => (location.type === "folder" && activeGroupBy !== "none" ? groupItems(visibleItems, activeGroupBy, new Date(), typeLabel) : null),
    [activeGroupBy, location.type, visibleItems, typeLabel],
  );

  const listItems = location.type === "folder" ? visibleItems : location.type === "home" ? homeItems : [];
  const displayOrder = useMemo(() => (groups ? groups.flatMap((group) => group.items) : listItems), [groups, listItems]);
  const orderPaths = useMemo(() => displayOrder.map((item) => item.path), [displayOrder]);
  const itemByPath = useMemo(() => new Map(displayOrder.map((item) => [item.path, item])), [displayOrder]);

  useEffect(() => {
    setSelection((current) => pruneSelection(current, orderPaths));
  }, [orderPaths]);

  // "Show in folder": select the item once its folder has loaded.
  useEffect(() => {
    const wanted = pendingSelectRef.current;
    if (!wanted || location.type !== "folder") return;
    const match = orderPaths.find((path) => samePath(path, wanted));
    if (match) {
      pendingSelectRef.current = null;
      setSelection(selectOnly(match));
    }
  }, [orderPaths, location.type]);

  useEffect(() => {
    const wanted = pendingRenameRef.current;
    if (!wanted || location.type !== "folder") return;
    const match = orderPaths.find((path) => samePath(path, wanted));
    if (match) {
      pendingRenameRef.current = null;
      setSelection(selectOnly(match));
      setRenamingPath(match);
    }
  }, [orderPaths, location.type]);

  const summary = useMemo(() => summarizeSelection(selection.selected, (path) => itemByPath.get(path)), [selection.selected, itemByPath]);
  // Selection counts are spoken politely, debounced 250 ms (Step 10f D2).
  // The first render stays silent; only a real change is announced.
  const spokenSelection = useRef(summary.count);
  useEffect(() => {
    if (!announcements || !active || spokenSelection.current === summary.count) return;
    spokenSelection.current = summary.count;
    return debounceAnnouncement(
      announcements,
      "explorer.statusSelected",
      () => ({ count: summary.count }),
      SELECTION_DEBOUNCE_MS,
    );
  }, [active, announcements, summary.count]);
  const selectedPaths = useMemo(() => orderPaths.filter((path) => selection.selected.has(path)), [orderPaths, selection.selected]);
  const selectedItems = useMemo(
    () => selectedPaths.map((path) => itemByPath.get(path)).filter((item): item is ExplorerItem => item !== undefined),
    [selectedPaths, itemByPath],
  );
  const favoriteKeys = useMemo(() => new Set(stateData.favorites.map((path) => displayPath(path).toLowerCase())), [stateData.favorites]);
  const allFavorites = selectedPaths.length > 0 && selectedPaths.every((path) => favoriteKeys.has(displayPath(path).toLowerCase()));

  const currentPinned = location.type === "folder" && stateData.pinned_folders.some((p) => samePath(p, location.path));
  const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;
  const commandCtx: CommandContext = {
    location: location.type,
    currentPath: location.type === "folder" ? location.path : null,
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    selectedPath: singleSelected?.path ?? null,
    selectedKind: singleSelected ? (singleSelected.kind === "drive" ? "other" : singleSelected.kind) : null,
    currentPinned,
    selection: { paths: selectedPaths, count: summary.count, files: summary.files, folders: summary.folders },
    gallerySourceSelected,
    view: {
      showHidden: view.show_hidden,
      showExtensions: view.show_extensions,
      itemCheckboxes: view.item_checkboxes,
      detailsPane: view.details_pane,
      groupBy: activeGroupBy,
      sortKey,
      sortDirection,
      viewMode: viewModeState.mode,
      hiddenViewModes: view.hidden_view_modes,
    },
    allFavorites,
    selectionInCurrentFolder: location.type === "folder",
    canUndo: undoStack.current.canUndo,
    canRedo: undoStack.current.canRedo,
  };
  const commandCtxRef = useRef(commandCtx);
  commandCtxRef.current = commandCtx;
  const presentationMetaRef = useRef({ view_mode: viewModeState.mode, sortKey, sortDirection, groupBy: activeGroupBy });
  presentationMetaRef.current = { view_mode: viewModeState.mode, sortKey, sortDirection, groupBy: activeGroupBy };

  // Folder tabs (Step 09a E6): report the folder and its view to the tab
  // that owns this Explorer instance. The permanent Explorer passes no
  // handler and keeps its old behavior.
  const currentPath = location.type === "folder" ? location.path : null;
  const locationChangeRef = useRef(onLocationChange);
  locationChangeRef.current = onLocationChange;
  const folderStateChangeRef = useRef(onFolderStateChange);
  folderStateChangeRef.current = onFolderStateChange;
  useEffect(() => {
    locationChangeRef.current?.(currentPath);
  }, [currentPath]);
  useEffect(() => {
      if (currentPath === null && location.type !== "home") return;
    folderStateChangeRef.current?.({
        path: currentPath ?? "home",
      view_mode: viewModeState.mode,
      sort: { key: sortKey, direction: sortDirection },
      group_by: activeGroupBy,
      column_root: viewModeState.columnRoot ?? undefined,
      scroll_top: 0,
    });
    }, [activeGroupBy, currentPath, location.type, sortDirection, sortKey, viewModeState.columnRoot, viewModeState.mode]);

  // Restore the folder tab's saved view mode once, after its listing exists.
  const restoredMode = useRef(false);
  useEffect(() => {
    if (restoredMode.current || !initialFolderState) return;
    restoredMode.current = true;
    viewModeRef.current.setMode(initialFolderState.view_mode);
  }, [initialFolderState]);

  // A folder-tab watcher asks for a fresh listing without losing the view.
  const lastRescan = useRef(rescanNonce);
  useEffect(() => {
    if (lastRescan.current === rescanNonce) return;
    lastRescan.current = rescanNonce;
    refresh();
  }, [refresh, rescanNonce]);

  // Actions read the latest state through this ref, so the command list
  // (and every menu built from it) stays stable between renders.
  const live = useRef({ location, orderPaths, selectedPaths, itemByPath, stateData, sortKey, sortDirection, view, allFavorites, menu, listItems, focusedPath: selection.focus });
  live.current = { location, orderPaths, selectedPaths, itemByPath, stateData, sortKey, sortDirection, view, allFavorites, menu, listItems, focusedPath: selection.focus };

  const chooseColumns = useCallback(() => {
    const current = live.current.location;
    if (current.type !== "folder" || !isTauriRuntime()) return;
    void (async () => {
      try {
        const stored = live.current.view.remember_view_per_folder
          ? await getFolderPresentation(current.path)
          : null;
        setColumnChooser(stored?.columns ?? defaultColumns());
      } catch (error) {
        notifyError(error, "presentation");
      }
    })();
  }, [notifyError]);

  const changeColumns = useCallback((columns: ColumnSpec[]) => {
    setColumnChooser(columns);
    const current = live.current.location;
    if (current.type !== "folder" || !live.current.view.remember_view_per_folder || !isTauriRuntime()) return;
    const meta = presentationMetaRef.current;
    const next: FolderPresentation = {
      view_mode: meta.view_mode,
      sort: { key: meta.sortKey, direction: meta.sortDirection },
      group_by: meta.groupBy,
      columns,
    };
    // Serialize per Explorer so an older chooser write cannot overwrite
    // a newer one; a failed save keeps the in-memory choice.
    presentationWrites.current = presentationWrites.current
      .then(() => setFolderPresentation(current.path, next))
      .catch((error: unknown) => notifyError(error, "presentation"));
  }, [notifyError]);

  const openOne = useCallback(
    (item: ExplorerItem, background = false) => {
      if (item.kind === "folder" || item.kind === "drive") {
        if (pickDropEnabled) {
          pickDestRef.current = item.path;
          onPickDropRequest?.();
          return;
        }
        goToFolder(item.path);
        return;
      }
      if (!isTauriRuntime()) return;
      // Files open in the app's tabs (Step 04a); shortcuts keep the Windows
      // path because a shortcut to a folder opens that folder here.
      if (onOpenFile && !item.name.toLowerCase().endsWith(".lnk")) {
        onOpenFile(item.path, background).catch((error: unknown) => notifyError(error, "files"));
        return;
      }
      openItem(item.path)
        .then((outcome) => {
          if (outcome.navigate_to) goToFolder(outcome.navigate_to);
        })
        .catch((error: unknown) => notifyError(error, "open"));
    },
    [goToFolder, notifyError, onOpenFile, onPickDropRequest, pickDropEnabled],
  );

  // "Show in folder" and breadcrumbs from file tabs (Step 04a).
  useEffect(() => {
    if (!navigateRequest) return;
    pendingSelectRef.current = navigateRequest.select;
    goToFolder(navigateRequest.folder);
    // Only a new request (new nonce) navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRequest?.nonce]);


  // -------------------------------------------------------------------
  // File operations (Step 03b): jobs with progress, conflicts, undo.
  // -------------------------------------------------------------------
  const refreshAfterOp = () => {
    refresh();
    if (live.current.location.type === "home") setHomeNonce((value) => value + 1);
  };

  const askPermanent = (count: number) =>
    new Promise<boolean>((resolve) => {
      setPermanentAsk({
        count,
        answer: (confirmed) => {
          setPermanentAsk(null);
          resolve(confirmed);
        },
      });
    });

  const askSystemItems = () => new Promise<boolean>((resolve) => {
    const answer = (confirmed: boolean) => {
      systemQueue.current.shift();
      setSystemAsk(() => systemQueue.current[0] ?? null);
      resolve(confirmed);
    };
    systemQueue.current.push(answer);
    if (systemQueue.current.length === 1) setSystemAsk(() => answer);
  });

  const baseNameOf = (path: string) => displayPath(path).split("\\").filter(Boolean).pop() ?? path;

  /** Select the items an extraction made, and go to their folder when the
   * user asked for a folder (Step 06d). */
  const showResult = (destDir: string, select: string | null, navigate: boolean) => {
    const current = live.current.location;
    if (navigate) {
      pendingSelectRef.current = select;
      goToFolder(destDir);
      return;
    }
    if (current.type === "folder" && samePath(current.path, destDir)) {
      pendingSelectRef.current = select;
      refreshAfterOp();
    }
  };

  /** Run one job in the panel; resolves with its result. */
  const trackJob: TrackJob = async ({ verbKey, count, reasonArea = "ops", start, outcome }) => {
    jobIdRef.current += 1;
    const id = `job-${jobIdRef.current}`;
    const openTimer = window.setTimeout(() => setJobsOpen(true), 400);
    setJobs((list) =>
      [
        {
          id,
          verbKey,
          count,
          progress: null,
          status: "running" as const,
          skipped: [],
          reasonArea,
          onCancel: () => jobCancelRef.current.get(id)?.(),
        },
        ...list,
      ].slice(0, 6),
    );
    try {
      const job = await start((progress) =>
        setJobs((list) => list.map((entry) => (entry.id === id ? { ...entry, progress } : entry))),
      );
      if (job.open) {
        setJobs((list) =>
          list.map((entry) => (entry.id === id ? { ...entry, onOpen: job.open } : entry)),
        );
      }
      jobCancelRef.current.set(id, () => void job.cancel());
      const result = await job.completion;
      window.clearTimeout(openTimer);
      const finished = outcome(result);
      setJobs((list) =>
        list.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                status: finished.cancelled ? ("cancelled" as const) : ("done" as const),
                skipped: finished.skipped,
              }
            : entry,
        ),
      );
      if (finished.cancelled) setJobsOpen(true);
      return result;
    } catch (error) {
      window.clearTimeout(openTimer);
      setJobs((list) =>
        list.map((entry) => (entry.id === id ? { ...entry, status: "failed" as const } : entry)),
      );
      throw error;
    } finally {
      jobCancelRef.current.delete(id);
    }
  };

  /** Run one file operation in the panel; resolves with its report. */
  const runTracked = async (
    verbKey: string,
    kind: "copy" | "move" | "recycle" | "restore" | "permanent",
    sources: string[],
    options: { destDir?: string; conflict?: ConflictPolicy } = {},
  ): Promise<OpReport> => {
    let allowSystem = false;
    for (;;) {
      try {
        return await trackJob<OpReport>({
          verbKey,
          count: sources.length,
          start: (onProgress) =>
            startFileJob(kind, sources, { ...options, allowSystem, onProgress }),
          outcome: (report) => ({ cancelled: report.cancelled, skipped: report.skipped }),
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        if (code !== "ops.system_confirmation_required" || allowSystem) throw error;
        if (!(await askSystemItems())) {
          return { completed: [], skipped: [], replaced: [], created: [], cancelled: true };
        }
        allowSystem = true;
      }
    }
  };

  /** Asking for archive passwords (Step 06e T10). */
  const archivePrompts = useArchivePasswordPrompt();
  useEffect(() => {
    // Navigating away cancels a prompt for what is no longer shown.
    archivePrompts.cancelAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.type, location.type === "folder" ? location.path : ""]);

  /** Extracting archives (Step 06d): a job per archive, one Undo entry for
   * a group. */
  const archive = useArchiveExtract({
    t,
    trackJob,
    undoStack: undoStack.current,
    touchUndo,
    notify,
    notifyAction,
    notifyError,
    currentFolder: () =>
      live.current.location.type === "folder" ? live.current.location.path : null,
    showResult,
    itemFor: (path) => live.current.itemByPath.get(path),
    askPassword: archivePrompts.ask,
  });

  /** Creating archives (Step 06e T11). */
  const archiveCreate = useArchiveCreate({
    t,
    trackJob,
    undoStack: undoStack.current,
    touchUndo,
    notify,
    notifyAction,
    notifyError,
    showResult,
    currentFolder: () =>
      live.current.location.type === "folder" ? live.current.location.path : null,
  });

  // An archive tab asked for an extraction; the App already shows the
  // destination folder (Step 06d).
  useEffect(() => {
    if (!extractRequest) return;
    void archive.runRequest(extractRequest.request);
    // Only a new request (new nonce) runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractRequest?.nonce]);

  /** Record a finished copy/move/recycle in the undo stack; returns the
   * entry to offer in the toast, or null when nothing changed. */
  const recordJob = (
    kind: "copy" | "move" | "recycle",
    report: OpReport,
    destDir: string | null,
  ): UndoEntry | null => {
    const input = entryForJob(kind, report, destDir);
    if (!input) return null;
    undoStack.current.push(input);
    touchUndo();
    return undoStack.current.peekUndo();
  };

  const toastReport = (entry: UndoEntry | null, report: OpReport) => {
    if (entry) notifyAction(t(entry.labelKey, entry.labelArgs), entry);
    if (report.skipped.length > 0) notify(t("jobs.skippedItems", { count: report.skipped.length }));
    if (report.cancelled) notify(t("jobs.cancelled"));
  };

  /** Open a path from the storage or duplicate view through the normal
   * pipeline; failures stay in that view instead of leaving a dead click. */
  const openFileFromStorage = async (path: string) => {
    try {
      if (onOpenFile) await onOpenFile(path, false);
      else if (isTauriRuntime()) await openItem(path);
    } catch (error) {
      notifyError(error, "files");
    }
  };
  /** The storage view's Delete is the ordinary reviewed recycle, with its
   * journal/Undo entry; nothing is deleted permanently or automatically. */
  const storageMutation = async (action: FileAction) => {
    if (action.type !== "recycle") throw new Error("storage.unavailable");
    const report = await runTracked("recycling", "recycle", [...action.paths]);
    refreshAfterOp();
    toastReport(recordJob("recycle", report, null), report);
  };

  /** Copy or move through the one controlled transfer queue. Conflicts,
   * pause/resume, speed/ETA, verification and the paged report live in the
   * transfer window; this function only records the outcome. */
  const runTransfer = async (
    kind: "copy" | "move",
    sources: string[],
    destDir: string,
  ): Promise<OpReport> => {
    const sameFolderCopy =
      kind === "copy" &&
      sources.every((source) => {
        const parent = parentPathOf(source);
        return parent !== null && samePath(parent, destDir);
      });
    let allowSystem = false;
    for (;;) {
      try {
        const report = await trackJob<OpReport>({
          verbKey: kind === "copy" ? "copying" : "moving",
          count: sources.length,
          start: async (onProgress) => {
            const handle = await startHostedTransfer(
              {
                kind,
                sources,
                dest_dir: destDir,
                conflict: sameFolderCopy ? "keepBoth" : "skip",
                allow_system: allowSystem,
              },
              onProgress,
            );
            return {
              cancel: handle.cancel,
              completion: handle.completion.then((page) => toOpReport(page)),
              open: () => openTransfer(handle.id),
            };
          },
          outcome: (result) => ({ cancelled: result.cancelled, skipped: result.skipped }),
        });
        // The native preflight reports this per item. Ask once and run the
        // same request again with the explicit confirmation.
        const needsConfirmation = report.skipped.some(
          (item) => item.reason === "system_confirmation_required",
        );
        if (!allowSystem && needsConfirmation) {
          if (!(await askSystemItems())) return report;
          allowSystem = true;
          continue;
        }
        return report;
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        if (code !== "ops.system_confirmation_required" || allowSystem) throw error;
        if (!(await askSystemItems())) {
          return { completed: [], skipped: [], replaced: [], created: [], cancelled: true };
        }
        allowSystem = true;
      }
    }
  };

  /** Copy or move with the shared queue and its conflict window. */
  const performCopyMove = async (
    kind: "copy" | "move",
    sources: string[],
    destDir: string,
  ): Promise<OpReport | null> => {
    if (sources.length === 0) return null;
    const report = await runTransfer(kind, sources, destDir);
    refreshAfterOp();
    toastReport(recordJob(kind, report, destDir), report);
    return report;
  };
  performCopyMoveRef.current = performCopyMove;

  // While a pick is active this Explorer offers its clicked folder as one
  // ordinary 09c target; accepting delegates to the same copy/move pipeline
  // (and confirmations) as a mouse drag (Step 10f E4/T5).
  useEffect(() => {
    if (!pickDropEnabled) return;
    const actions: TransferAction[] = [
      { id: "copy_files", label_key: "transfer.copy", losses: [], mutates: true },
      { id: "move_files", label_key: "transfer.move", losses: [], mutates: true },
    ];
    return appTransferRegistry.register({
      target_id: PICK_DROP_TARGET_ID,
      accepted_kinds: ["files"],
      describe: (envelope: TransferEnvelope) => {
        const dest = pickDestRef.current;
        if (dest === null || envelope.payload.kind !== "files") return [];
        if (envelope.payload.sources.length === 0) return [];
        if (envelope.payload.sources.some((source) => source.kind !== "disk")) return [];
        const allInDest = envelope.payload.sources.every((source) => {
          if (source.kind !== "disk") return false;
          const parent = parentPathOf(source.path);
          return parent !== null && samePath(parent, dest);
        });
        return allInDest ? [] : actions;
      },
      accept: async (envelope, actionId) => {
        const dest = pickDestRef.current;
        if (dest === null || envelope.payload.kind !== "files") {
          throw transferError("transfer.unsupported");
        }
        const sources = envelope.payload.sources.map((source) =>
          source.kind === "disk" ? source.path : null,
        );
        if (sources.some((path) => path === null)) throw transferError("transfer.unsupported");
        const kind = actionId === "move_files" ? "move" : actionId === "copy_files" ? "copy" : null;
        if (kind === null) throw transferError("transfer.unsupported");
        const report = await performCopyMoveRef.current?.(kind, sources as string[], dest);
        if (!report || report.cancelled) throw transferError("transfer.failed");
        const receipt: TransferReceipt = {
          // The job's exact effect id when the native queue returned one;
          // the receipt is only a proof of completion, never a new effect.
          transaction_id:
            report.transfer_id && isUuid(report.transfer_id)
              ? report.transfer_id
              : crypto.randomUUID(),
          inserted_count: report.completed.length,
          losses: [],
          complete: true,
        };
        return receipt;
      },
    });
  }, [pickDropEnabled]);

  // Leaving pick mode clears the remembered destination; nothing was
  // mutated while the lease existed.
  useEffect(() => {
    if (!pickActive) pickDestRef.current = null;
  }, [pickActive]);

  const performUndo = async () => {
    const entry = undoStack.current.peekUndo();
    if (!entry) return;
    try {
      await executeFileAction(entry.undo, askSystemItems);
      undoStack.current.confirmUndo();
      touchUndo();
      notify(t("toast.actionUndone"));
      refreshAfterOp();
    } catch (error) {
      notifyOpError(error);
    }
  };

  const performRedo = async () => {
    const entry = undoStack.current.peekRedo();
    if (!entry) return;
    try {
      await executeFileAction(entry.redo, askSystemItems);
      undoStack.current.confirmRedo();
      touchUndo();
      notify(t("toast.actionRedone"));
      refreshAfterOp();
    } catch (error) {
      notifyOpError(error);
    }
  };

  /** Undo a specific toast's action (only in stack order, like Ctrl+Z). */
  const undoFromToast = (toastId: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== toastId));
    const entryId = toastEntryRef.current.get(toastId);
    toastEntryRef.current.delete(toastId);
    if (entryId === undefined) return;
    if (undoStack.current.peekUndo()?.id === entryId) void performUndo();
    else notify(t("toast.undoNewerFirst"));
  };

  const afterCreate = (path: string) => {
    undoStack.current.push({
      labelKey: "toast.pasted",
      labelArgs: { name: baseNameOf(path) },
      undo: { type: "recycle", paths: [path] },
      redo: { type: "restore", originals: [path] },
    });
    touchUndo();
    const entry = undoStack.current.peekUndo();
    notifyAction(t("toast.pasted", { name: baseNameOf(path) }), entry);
    pendingRenameRef.current = path;
    refreshAfterOp();
  };

  /** Every new item ends the same way (Step 06c): an undo entry, the
   * "Created" toast, the rename box open and a refreshed list. */
  const recordCreated = (path: string) => {
    undoStack.current.push({
      labelKey: "toast.created",
      labelArgs: { name: baseNameOf(path) },
      undo: { type: "recycle", paths: [path] },
      redo: { type: "restore", originals: [path] },
    });
    touchUndo();
    notifyAction(t("toast.created", { name: baseNameOf(path) }), undoStack.current.peekUndo());
    pendingRenameRef.current = path;
    refreshAfterOp();
  };

  /** Template errors carry `templates.*`; file-operation ones `ops.*`. */
  const notifyTemplatesError = (error: unknown) => {
    const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    if (raw.startsWith("templates.")) notifyError(error, "templates");
    else notifyOpError(error);
  };

  const createNew = async (kind: "folder" | "file") => {
    const current = live.current.location;
    if (current.type !== "folder" || !isTauriRuntime()) return;
    try {
      const wanted = kind === "folder" ? t("files.newFolderName") : t("files.newTextFileName");
      recordCreated(await createItem(current.path, wanted, kind));
    } catch (error) {
      notifyOpError(error);
    }
  };

  /** A blank Markdown, CSV or Office file (Step 06c). */
  const createBlankFile = async (kind: BlankKind) => {
    const current = live.current.location;
    if (current.type !== "folder" || !isTauriRuntime()) return;
    try {
      recordCreated(await createBlank(kind, current.path, t, i18n.language));
    } catch (error) {
      notifyTemplatesError(error);
    }
  };

  const pasteIntoFolder = async () => {
    const current = live.current.location;
    if (current.type !== "folder" || !isTauriRuntime()) return;
    const destDir = current.path;
    try {
      const data = await clipboardRead();
      if (data.files.length > 0) {
        const report = await performCopyMove(data.cut ? "move" : "copy", data.files, destDir);
        if (data.cut && report && report.completed.length > 0) {
          void clipboardClear().catch(() => undefined);
        }
        return;
      }
      if (data.has_image) {
        const base = t("files.pastedImageName", { stamp: pastedStamp(new Date()) });
        afterCreate(await clipboardImageFile(destDir, base, pasteImageFormat));
        return;
      }
      if (data.has_text) {
        const text = await clipboardText();
        if (text) {
          const kind = classifyClipboardText(text);
          const base = t("files.pastedTextName", { stamp: pastedStamp(new Date()) });
          afterCreate(await createTextFile(destDir, `${base}${pastedTextExtension(kind)}`, text));
          return;
        }
      }
      notify(t("toast.nothingToPaste"));
    } catch (error) {
      notifyOpError(error);
    }
  };

  /** Paste one clipboard-history item into the open folder through the
   * normal file actions. Image items still need a snapshot-to-file adapter,
   * so they fail closed until that service exists. */
  const pasteHistoryEnvelope = async (envelope: TransferEnvelope) => {
    const current = live.current.location;
    if (current.type !== "folder" || !isTauriRuntime()) throw new Error("transfer.unsupported");
    // The Explorer has no sensitive-content confirmation route of its own.
    if (envelope.sensitive) throw new Error("transfer.sensitive");
    const payload = envelope.payload;
    if (payload.kind === "files") {
      const sources = payload.sources.flatMap((source) => (source.kind === "disk" ? [source.path] : []));
      if (sources.length === 0 || sources.length !== payload.sources.length) {
        throw new Error("transfer.unsupported");
      }
      await performCopyMove("copy", sources, current.path);
      setClipboardOpen(false);
      return;
    }
    if (payload.kind === "text") {
      const kind = classifyClipboardText(payload.text);
      const base = t("files.pastedTextName", { stamp: pastedStamp(new Date()) });
      afterCreate(await createTextFile(current.path, `${base}${pastedTextExtension(kind)}`, payload.text));
      setClipboardOpen(false);
      return;
    }
    throw new Error("transfer.unsupported");
  };

  const galleryAddFolder = useCallback(
    () =>
      setGalleryRequest((previous) => ({
        kind: "add",
        nonce: (previous?.nonce ?? 0) + 1,
      })),
    [],
  );
  const galleryRemoveFolder = useCallback(
    () =>
      setGalleryRequest((previous) => ({
        kind: "remove",
        nonce: (previous?.nonce ?? 0) + 1,
      })),
    [],
  );

  // Search (Step 11a): the overlay opens with the saved default mode; the
  // ordinary Explorer view stays underneath and untouched.
  const openSearch = useCallback(() => {
    // A palette command runs even when this Explorer is behind another tab.
    if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
    // The first open applies the saved default mode; a later Ctrl+F keeps
    // the query and only focuses the box again.
    if (!searchOpenRef.current) {
      setSearchQuery(emptySearchQuery(searchSettingsRef.current.default_mode));
      setAiSearchMode(null);
    }
    setIndexedView(null);
    setStoragePane(null);
    setSearchNonce((value) => value + 1);
    setSearchOpen(true);
  }, [onActivateTab, paletteOwnerId]);

  /** Read the saved AI block and the native status; a failed or browser-only
   * status is treated as a missing provider, never as a healthy empty index. */
  const refreshAiSearchHost = useCallback(async () => {
    try {
      const loaded = await loadSettings();
      setAiSearchSettings(loaded.ai_search);
    } catch {
      setAiSearchSettings(defaultAiSearchSettings());
    }
    if (!isTauriRuntime()) {
      setAiProviderReady(false);
      return;
    }
    try {
      const status = await semanticStatus();
      setAiProviderReady(status.reason_code !== "ai_search.unavailable");
    } catch {
      setAiProviderReady(false);
    }
  }, []);

  const openAiSearch = useCallback(
    (mode: AiSearchMode) => {
      if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
      void refreshAiSearchHost();
      setIndexedView(null);
      setStoragePane(null);
      setSearchNonce((value) => value + 1);
      setAiSearchMode(mode);
      setSearchOpen(true);
    },
    [onActivateTab, paletteOwnerId, refreshAiSearchHost],
  );

  useEffect(() => {
    void refreshAiSearchHost();
  }, [refreshAiSearchHost]);

  const openIndexSettings = useCallback(() => {
    if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
    setIndexOpen(true);
  }, [onActivateTab, paletteOwnerId]);
  const searchPresentation = useMemo(
    () => legacyPresentation(viewModeState.mode),
    [viewModeState.mode],
  );

  // Saved searches are loaded when the overlay opens; the catalog holds
  // queries only, never results.
  useEffect(() => {
    if (!searchOpen || !isTauriRuntime()) return;
    let cancelled = false;
    void listSavedSearches()
      .then((list) => {
        if (!cancelled) setSavedSearches(list);
      })
      .catch(() => {
        if (!cancelled) setSavedSearches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchOpen]);

  // Index status while the indexing window is open; the native job owns the
  // work and this only displays its latest answer.
  useEffect(() => {
    if (!indexOpen || !isTauriRuntime()) return;
    let cancelled = false;
    const load = () => {
      void getIndexStatus()
        .then((status) => {
          if (!cancelled) setIndexStatus(status);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [indexOpen]);

  const removeSaved = async (id: string) => {
    try {
      await removeSavedSearch(id);
      setSavedSearches((current) => current.filter((saved) => saved.id !== id));
    } catch (error) {
      notifyError(error, "search");
    }
  };

  const addIndexRoot = async (): Promise<string | null> => {
    if (!isTauriRuntime()) return null;
    const path = await archivePickFolder(t("search.addRoot"));
    if (!path) return null;
    if (searchSettingsRef.current.roots.some((root) => samePath(root.path, path))) return null;
    return path;
  };

  const pauseIndexing = async (paused: boolean) => {
    try {
      setIndexStatus(await pauseIndex(paused));
    } catch (error) {
      notifyError(error, "search");
    }
  };

  const rebuildIndexes = async (rootIds: readonly string[]) => {
    try {
      const ids =
        rootIds.length > 0
          ? [...rootIds]
          : searchSettingsRef.current.roots.filter((root) => root.enabled).map((root) => root.id);
      const handle = await rebuildIndex(ids);
      const status = await handle.completion;
      // A rebuilt index has no tag-membership rows; replay them from the
      // authoritative tag store before tag filters are used again.
      await reconcileTagMirrors().catch(() => undefined);
      setIndexStatus(status);
    } catch (error) {
      notifyError(error, "search");
    }
  };

  // Tags (Step 11b): the picker's checked rows are the tags every selected
  // item already carries; applying writes one mutation batch (one Undo).
  const openTagPicker = useCallback(async () => {
    if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
    const paths = live.current.selectedPaths;
    if (paths.length === 0 || !isTauriRuntime()) return;
    try {
      const [catalog, assignments] = await Promise.all([
        getTagCatalog(),
        assignmentsForPaths(paths),
      ]);
      const value =
        assignments.length > 0
          ? catalog.tags
              .map((tag) => tag.id)
              .filter((id) => assignments.every((row) => row.tag_ids.includes(id)))
          : [];
      // The tag windows never stack: opening one closes the other two.
      setTagManager(null);
      setTagImport(null);
      setTagPicker({ paths: [...paths], catalog, value });
    } catch (error) {
      notifyError(error, "tags");
    }
  }, [notifyError, onActivateTab, paletteOwnerId]);

  const applyTagSelection = useCallback(
    async (add: string[], remove: string[]) => {
      if (!tagPicker) return;
      const handle = await mutateTagsForPaths(tagPicker.paths, add, remove);
      const result = await handle.completion;
      // A row whose identity changed is skipped, never re-tagged by name;
      // keep the picker open so the translated error can ask for a retry.
      const skipped = result.skipped[0];
      if (skipped) throw new Error(skipped.code || "tags.changed");
      if (!result.complete) throw new Error("tags.changed");
    },
    [tagPicker],
  );

  const openTagManager = useCallback(async () => {
    if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
    if (!isTauriRuntime()) return;
    try {
      const catalog = await getTagCatalog();
      setTagPicker(null);
      setTagImport(null);
      setTagManager(catalog);
    } catch (error) {
      notifyError(error, "tags");
    }
  }, [notifyError, onActivateTab, paletteOwnerId]);

  const importTagCatalog = useCallback(async () => {
    try {
      const preview = await pickTagImport(t("tags.import"), t("tags.import"));
      if (preview) setTagImport(preview);
    } catch (error) {
      notifyError(error, "tags");
    }
  }, [notifyError, t]);

  const exportTagCatalog = useCallback(async () => {
    try {
      const destination = await pickTagExport(t("tags.export"), "tags.adptags", t("tags.export"));
      if (!destination) return;
      const handle = await exportTags(destination, false);
      await handle.completion;
    } catch (error) {
      notifyError(error, "tags");
    }
  }, [notifyError, t]);

  const applyTagImportChoices = useCallback(
    async (choices: readonly TagImportChoice[], allowPaths: boolean) => {
      if (!tagImport) return;
      const catalog = await applyTagImport(tagImport.preview_id, choices, allowPaths);
      setTagManager((current) => (current ? catalog : current));
      setTagImport(null);
    },
    [tagImport],
  );

  /** Save the live search query first, then the smart folder entry that
   * points at it. The query stays a search view, never a copy destination. */
  const saveSmartFolderFromSearch = useCallback(() => {
    if (!searchOpen) return;
    if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
    setSmartFolderName("");
    setSmartFolderOpen(true);
  }, [onActivateTab, paletteOwnerId, searchOpen]);

  const confirmSmartFolder = useCallback(async () => {
    const name = smartFolderName.trim();
    if (!name) return;
    const now = Math.floor(Date.now() / 1000);
    setSmartFolderBusy(true);
    try {
      const saved = await saveSearch({
        id: globalThis.crypto.randomUUID(),
        name,
        query: searchQuery,
        created_unix: now,
        modified_unix: now,
        version: 1,
      });
      await saveSmartFolder({
        id: globalThis.crypto.randomUUID(),
        name,
        saved_search_id: saved.id,
        created_unix: now,
        modified_unix: now,
      });
      setSavedSearches((current) => [saved, ...current]);
      setSmartFolderOpen(false);
      setSmartFolderName("");
    } catch (error) {
      notifyError(error, "views");
    } finally {
      setSmartFolderBusy(false);
    }
  }, [notifyError, searchQuery, smartFolderName]);

  const actions: ExplorerActions = useMemo(
    () => ({
      back: () => setHistory((current) => goBack(current)),
      forward: () => setHistory((current) => goForward(current)),
      up: () => {
        const current = live.current.location;
        if (current.type !== "folder") return;
        const parent = parentPathOf(current.path);
        if (parent) goToFolder(parent);
        else goToLocation({ type: "drives" });
      },
      refresh,
      galleryAddFolder,
      galleryRemoveFolder,
      addTags: () => void openTagPicker(),
      removeTags: () => void openTagPicker(),
      manageTags: () => void openTagManager(),
      saveSmartFolder: () => void saveSmartFolderFromSearch(),
      canSaveSmartFolder: () => searchOpen,
      isIndexedViewEnabled: (view) => views.enabled_views[view],
      openIndexedView: (view) => {
        if (!isTauriRuntime() || !views.enabled_views[view]) return;
        if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
        setSearchOpen(false);
        setStoragePane(null);
        setIndexedView(view);
      },
      // Step 11c: storage and duplicate scans take over the content area.
      openStorageView: (root: string) => {
        if (!isTauriRuntime()) return;
        if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
        setSearchOpen(false);
        setIndexedView(null);
        setStoragePane((current) => ({
          kind: "storage",
          root,
          nonce: (current?.nonce ?? 0) + 1,
        }));
      },
      openDuplicates: (roots: string[]) => {
        const root = roots[0];
        if (!isTauriRuntime() || !root) return;
        if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
        setSearchOpen(false);
        setIndexedView(null);
        setStoragePane((current) => ({
          kind: "duplicates",
          root,
          nonce: (current?.nonce ?? 0) + 1,
        }));
      },
      openFolderSizes: () => {
        if (!onFolderSizesChange) return;
        if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
        onFolderSizesChange({ ...folderSizes, enabled: !folderSizes.enabled });
      },
      openSelected: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const targets = paths.map((path) => byPath.get(path)).filter((item): item is ExplorerItem => item !== undefined);
        if (targets.length === 1) {
          openOne(targets[0]);
          return;
        }
        const files = targets.filter((entry) => entry.kind === "file");
        for (const item of files.slice(0, OPEN_LIMIT)) openOne(item);
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      quickPreview: () => {
        const { focusedPath, itemByPath: byPath, listItems: list } = live.current;
        const item = focusedPath !== null ? byPath.get(focusedPath) : undefined;
        if (!item || item.kind !== "file") return;
        if (!onPreviewItem) {
          toggleQuickPreview(item, list);
          return;
        }
        // A folder tab owns its preview surface (Step 09a E6); a second
        // Space closes it, like the in-place dialog.
        onPreviewItem(previewItem !== null ? null : item);
      },
      goToPath: (path: string) => {
        const trimmed = path.trim();
        if (!trimmed) return;
        // Place names ("This PC", "Home"...) in any app language.
        const word = plainText(trimmed);
        const isPlace = (key: string) => supportedLanguages.some((lng) => plainText(i18n.t(key, { lng })) === word);
        if (word === "this-pc" || isPlace("explorer.nav.thisPc")) {
          goToLocation({ type: "drives" });
          return;
        }
        if (isPlace("explorer.nav.home")) {
          goToLocation({ type: "home" });
          return;
        }
        if (isPlace("explorer.nav.gallery")) {
          goToLocation({ type: "gallery" });
          return;
        }
        if (isPlace("explorer.nav.network")) {
          goToLocation({ type: "network" });
          return;
        }
        goToFolder(trimmed);
      },
      togglePin: () => {
        const { location: current, stateData: state } = live.current;
        if (current.type !== "folder") return;
        const path = current.path;
        const pinned = state.pinned_folders.some((p) => samePath(p, path));
        void (async () => {
          try {
            const next = pinned ? await unpinFolder(path) : await pinFolder(path);
            setStateData(normalizeState(next));
          } catch {
            // Pinning is best-effort in the UI; state stays unchanged.
          }
        })();
      },
      rename: () => {
        const paths = live.current.selectedPaths;
        if (paths.length === 1) setRenamingPath(paths[0]);
      },
      share: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        if (paths.length === 0 || !isTauriRuntime()) return;
        const title = paths.length === 1 ? (byPath.get(paths[0])?.name ?? paths[0]) : t("explorer.shareTitle", { count: paths.length });
        void shareItems(paths, title).catch((error: unknown) => notifyError(error, "share"));
      },
      openInWindowsApp: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const files = paths.filter((path) => byPath.get(path)?.kind === "file");
        if (!isTauriRuntime()) return;
        for (const path of files.slice(0, OPEN_LIMIT)) void openItem(path).catch((error: unknown) => notifyError(error, "open"));
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openAsText: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const files = paths.filter((path) => byPath.get(path)?.kind === "file");
        for (const path of files.slice(0, OPEN_LIMIT)) onOpenFileWith?.(path, "text");
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openAsHex: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const files = paths.filter((path) => byPath.get(path)?.kind === "file");
        for (const path of files.slice(0, OPEN_LIMIT)) onOpenFileWith?.(path, "hex");
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      extractArchives: (mode) => {
        void archive.extractItems(live.current.selectedPaths, mode);
      },
      convertSelection: () => {
        if (!isTauriRuntime()) return;
        setConversionInputs(live.current.selectedPaths.filter((path) => live.current.itemByPath.get(path)?.kind === "file").map((path) => ({ kind: "file", path })));
      },
      bulkRename: () => {
        const paths = live.current.selectedPaths;
        if (!isTauriRuntime() || paths.length === 0 || paths.length > 1000) return;
        setAiNameReview(null);
        setBulkRenamePaths([...paths]);
      },
      batchActions: () => {
        if (!isTauriRuntime()) return;
        const inputs = live.current.selectedPaths
          .filter((path) => live.current.itemByPath.get(path)?.kind === "file")
          .map((path) => ({ kind: "file" as const, path }));
        if (inputs.length > 0) setBatchInputs(inputs);
        else notify(t("errors.convert.unsupported"));
      },
      compressTo: () => {
        const current = live.current.location;
        const sources = live.current.selectedPaths;
        if (current.type !== "folder" || sources.length === 0 || !isTauriRuntime()) return;
        // The dialog only plans; opening it reads no source bytes.
        setCompressRequest({ sources: [...sources], folder: current.path });
      },
      openWith: () => {
        const paths = live.current.selectedPaths;
        if (paths.length === 1 && isTauriRuntime()) void openWithDialog(paths[0]).catch((error: unknown) => notifyError(error, "openWith"));
      },
      copyPath: () => {
        const { selectedPaths: paths, location: current } = live.current;
        const targets = paths.length > 0 ? paths : current.type === "folder" ? [current.path] : [];
        if (targets.length === 0) return;
        writeClipboard(pathsForClipboard(targets))
          .then(() => notify(t("toast.pathsCopied", { count: targets.length })))
          .catch(() => notify(t("errors.copyPath.other")));
      },
      toggleFavorite: () => {
        const { selectedPaths: paths, allFavorites: all } = live.current;
        if (paths.length === 0 || !isTauriRuntime()) return;
        void (async () => {
          try {
            let next: ExplorerStateData | null = null;
            for (const path of paths) next = all ? await removeFavorite(path) : await addFavorite(path);
            if (next) setStateData(normalizeState(next));
            setFavoritesNonce((value) => value + 1);
          } catch {
            notify(t("errors.favorites.other"));
          }
        })();
      },
      showInFolder: () => {
        const paths = live.current.selectedPaths;
        if (paths.length !== 1) return;
        const parent = parentPathOf(paths[0]);
        if (!parent) return;
        pendingSelectRef.current = paths[0];
        goToFolder(parent);
      },
      properties: () => {
        const { selectedPaths: paths, location: current } = live.current;
        const targets = paths.length > 0 ? paths : current.type === "folder" ? [current.path] : [];
        if (targets.length > 0 && isTauriRuntime()) void showProperties(targets).catch((error: unknown) => notifyError(error, "properties"));
      },
      versionHistory: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        if (paths.length !== 1) return;
        const item = byPath.get(paths[0]);
        if (item && item.kind !== "folder") setHistoryFor(item);
      },
      openInTerminal: () => {
        const current = live.current.location;
        if (current.type === "folder" && isTauriRuntime()) void openInTerminal(current.path).catch((error: unknown) => notifyError(error, "terminal"));
      },
      selectAll: () => setSelection((current) => selectAll(current, live.current.orderPaths)),
      selectNone: () => setSelection((current) => clearSelection(current)),
      invertSelection: () => setSelection((current) => invertSelection(current, live.current.orderPaths)),
      setSortKey: (key: SortKey) => {
        if (key === live.current.sortKey) return;
        // Re-sort in place: the list stays on screen and keeps the selection.
        loadModeRef.current = "soft";
        setSortKey(key);
        setSortDirection("ascending");
      },
      setSortDirection: (direction: SortDirection) => {
        if (direction === live.current.sortDirection) return;
        loadModeRef.current = "soft";
        setSortDirection(direction);
      },
      setGroupBy: (next) => {
        // A folder tab keeps grouping in its own state; the permanent
        // Explorer keeps the global view setting.
        if (folderTab) setFolderGroupBy(next);
        else onViewChange?.({ group_by: next });
      },
      toggleView: (option: ViewToggle) => {
        const key = VIEW_SETTING[option];
        onViewChange?.({ [key]: !live.current.view[key] });
      },
      // Step 05a: runs the view the user chose (or Ctrl+wheel stepped to).
      setViewMode: (mode: ViewModeId) => viewModeRef.current.setMode(mode),
      newFolder: () => void createNew("folder"),
      newTextFile: () => void createNew("file"),
      newBlank: (kind: BlankKind) => void createBlankFile(kind),
      newFromTemplate: () => setTemplatePickerOpen(true),
      cut: () => {
        const paths = live.current.selectedPaths;
        if (paths.length > 0 && isTauriRuntime())
          void clipboardSetFiles(paths, true).catch((error: unknown) => notifyOpError(error));
      },
      copy: () => {
        const paths = live.current.selectedPaths;
        if (paths.length > 0 && isTauriRuntime())
          void clipboardSetFiles(paths, false).catch((error: unknown) => notifyOpError(error));
      },
      paste: () => void pasteIntoFolder(),
      pasteAsFile: () => void pasteIntoFolder(),
      deleteItems: () => {
        const paths = live.current.selectedPaths;
        if (paths.length === 0 || !isTauriRuntime()) return;
        void (async () => {
          try {
            const report = await runTracked("recycling", "recycle", paths);
            refreshAfterOp();
            toastReport(recordJob("recycle", report, null), report);
          } catch (error) {
            notifyOpError(error);
          }
        })();
      },
      deletePermanently: () => {
        const paths = live.current.selectedPaths;
        if (paths.length === 0 || !isTauriRuntime()) return;
        void (async () => {
          if (!(await askPermanent(paths.length))) return;
          try {
            const report = await runTracked("deletingPermanently", "permanent", paths);
            refreshAfterOp();
            if (report.completed.length > 0)
              notify(t("toast.deletedPermanently", { count: report.completed.length }));
            if (report.skipped.length > 0)
              notify(t("jobs.skippedItems", { count: report.skipped.length }));
          } catch (error) {
            notifyOpError(error);
          }
        })();
      },
      undo: () => void performUndo(),
      redo: () => void performRedo(),
      chooseColumns,
      commandPalette: onOpenCommandPalette,
      customizeToolbar: onCustomizeToolbar,
      customizeShortcuts: onCustomizeShortcuts,
      openSearch,
      openIndexSettings,
      recentActions: () => setRecentOpen(true),
      addToShelf: onAddToShelf,
      showFileLocks: onShowFileLocks,
      reportProblem: onReportProblem,
      openRecovery: onOpenRecovery,
      openClipboardHistory: () => {
        // A palette command runs even when this Explorer is behind another tab.
        if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
        setClipboardOpen(true);
      },
      showMoreOptions: () => {
        const { selectedPaths: paths, location: current } = live.current;
        if (!isTauriRuntime()) return;
        const targets = paths.length > 0 ? paths : current.type === "folder" ? [current.path] : [];
        if (targets.length === 0) return;
        // The classic menu works on one folder's items; never act on a part
        // of the selection without saying so.
        if (new Set(targets.map((path) => (parentPathOf(path) ?? path).toLowerCase())).size > 1) {
          notify(t("errors.moreOptions.mixedFolders"));
          return;
        }
        const point = lastPointer.current;
        // Windows can take a moment to load other apps' menu items; say so.
        const timer = window.setTimeout(() => setBusyNote(t("explorer.loadingMoreOptions")), 300);
        void showClassicMenu(targets, paths.length === 0, point.x, point.y)
          .catch((error: unknown) => notifyError(error, "moreOptions"))
          .finally(() => {
            window.clearTimeout(timer);
            setBusyNote(null);
          });
      },
      ...featureActions,
      // Step 17c command hosts. A mode opens the mounted panel; name and
      // destination suggestions only exist after their explicit services run.
      openSearchMode: (mode) => openAiSearch(mode === "semantic" ? "meaning" : mode),
      suggestName: () => {
        // 14c name suggestions need a live document AiInputRef and the 17a
        // outbound-consent host; a bare Explorer selection has neither, so
        // the review stays closed instead of inventing suggestions.
        notify(t("errors.ai_search.unavailable"));
      },
      sortSuggestions: () => {
        const config = aiSearchSettingsRef.current;
        const path = live.current.selectedPaths.find(
          (candidate) => live.current.itemByPath.get(candidate)?.kind === "file",
        );
        if (!config.sort || !aiProviderReadyRef.current || !path) {
          notify(t("errors.ai_search.unavailable"));
          return;
        }
        if (!activeRef.current) onActivateTab?.(paletteOwnerId ?? "explorer");
        void (async () => {
          let lease: AiPathLease | null = null;
          try {
            // History-only path: no prepared model request and no network.
            lease = await acquireAiPathLease(path);
            const handle = await suggestDestination(lease.input, "", null);
            const suggestion = await handle.completion;
            if (!suggestion || aiSortNeverRef.current.has(suggestion.extension)) return;
            if (suggestion.expires_unix <= Math.floor(Date.now() / 1000)) return;
            if (config.disabled_sort_extensions.includes(suggestion.extension)) return;
            const destination = config.destinations.find(
              (entry) => entry.id === suggestion.destination_id,
            );
            if (!destination) return;
            setAiSortChip({
              suggestion,
              sourcePath: path,
              destinationLabel: destination.name || destination.path,
            });
          } catch {
            notify(t("errors.ai_search.unavailable"));
          } finally {
            await lease?.release();
          }
        })();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archive, archiveCreate, chooseColumns, folderSizes, folderTab, galleryAddFolder, galleryRemoveFolder, goToFolder, goToLocation, i18n, notify, notifyError, onActivateTab, onAddToShelf, onFolderSizesChange, onOpenCommandPalette, onCustomizeShortcuts, onCustomizeToolbar, onOpenFileWith, onOpenRecovery, onPreviewItem, onReportProblem, onShowFileLocks, onViewChange, openAiSearch, openIndexSettings, openOne, openSearch, openTagManager, openTagPicker, paletteOwnerId, previewItem, refresh, saveSmartFolderFromSearch, searchOpen, t, pasteImageFormat, toggleQuickPreview, views, featureActions],
  );

  const commands = useMemo(
    () => [
      ...createExplorerCommands(actions),
      ...(shellCommandActions ? createShellCommands(shellCommandActions) : []),
    ],
    [actions, shellCommandActions],
  );
  const registry = useMemo(() => {
    const next = new CommandRegistry();
    for (const command of commands) next.register(command);
    return next;
  }, [commands]);
  const lookup = useCallback((id: string) => registry.get(id), [registry]);
  // The registered bars resolve saved layouts before the dock measures them.
  const commandLayout = COMMAND_LAYOUT_REGISTRY;
  // Only a saved bar changes the command order; without one the bar keeps
  // the definition (including the user's View-menu order).
  const commandBarLayout = useMemo(() => {
    if (!toolbarCustom.bars.some((bar) => bar.bar_id === EXPLORER_COMMAND_BAR_ID)) return undefined;
    return commandLayout.resolve(EXPLORER_COMMAND_BAR_ID, toolbarCustom);
  }, [commandLayout, toolbarCustom]);
  const commandById = useMemo(() => Object.fromEntries(commands.map((c) => [c.id, c])), [commands]);
  const runCommand = useCallback((command: Command, arg?: string) => {
    if (isCommandEnabled(command, commandCtxRef.current)) command.run(commandCtxRef.current, arg);
  }, []);
  const runById = useCallback(
    (id: string, point?: { x: number; y: number }) => {
      if (point) lastPointer.current = point;
      const command = registry.get(id);
      if (command) runCommand(command);
    },
    [registry, runCommand],
  );
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const liveCommandRegistry = useMemo(
    () => new LiveCommandRegistry(() => commandsRef.current),
    [],
  );
  const runByIdRef = useRef(runById);
  runByIdRef.current = runById;

  // Step 10b: the window router asks this surface which scopes are live
  // and sends Vim navigation/filter actions back to the view's own model.
  const shortcutScopes = useCallback(
    (): readonly ShortcutScope[] =>
      activeRef.current ? (searchOpenRef.current ? ["search"] : ["explorer"]) : [],
    [],
  );
  const navigateShortcut = useCallback((direction: ExplorerShortcutDirection) => {
    const root = rootRef.current;
    if (!root) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedList = focused?.closest<HTMLElement>('[role="listbox"]') ?? null;
    const list =
      focusedList && root.contains(focusedList)
        ? focusedList
        : root.querySelector<HTMLElement>('[role="listbox"]');
    if (!list) return;
    list.focus();
    list.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: DIRECTION_KEYS[direction],
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);
  const focusFilterShortcut = useCallback(() => {
    const input = rootRef.current?.querySelector<HTMLInputElement>(".adp-address-search input");
    input?.focus();
    input?.select();
  }, []);

  // The window's command palette lists and runs these commands through
  // this stable bridge; the registry rechecks enablement on every dispatch.
  const paletteBridge = useMemo<ExplorerPaletteBridge>(() => ({
    registry: liveCommandRegistry,
    commandContext: () => commandCtxRef.current,
    dispatchCommand: (id: string) => runByIdRef.current(id),
    shortcutScopes,
    navigate: navigateShortcut,
    focusFilter: focusFilterShortcut,
  }), [focusFilterShortcut, liveCommandRegistry, navigateShortcut, shortcutScopes]);
  useEffect(() => {
    if (!onPaletteBridge) return;
    const owner = paletteOwnerId ?? "explorer";
    onPaletteBridge(owner, paletteBridge);
    return () => onPaletteBridge(owner, null);
  }, [onPaletteBridge, paletteOwnerId, paletteBridge]);

  // Status bar view buttons (Step 05a).
  useEffect(() => {
    if (!viewModeRequest) return;
    runById(VIEW_MODE_COMMANDS[viewModeRequest.mode]);
    // Only a new request (new nonce) runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewModeRequest?.nonce]);

  // Initial shell data: known folders, explorer state, drive roots.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      const [known, state] = await Promise.allSettled([listKnownFolders(), explorerStateGet()]);
      if (cancelled) return;
      if (known.status === "fulfilled") setKnownFolders(known.value);
      if (state.status === "fulfilled") setStateData(normalizeState(state.value));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Drive roots: poll the logical-drive list (cheap, never touches a
  // sleeping drive) so USB add/remove shows up live.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const roots = await listDrives();
        if (!cancelled) {
          setDrives((current) => (JSON.stringify(current) === JSON.stringify(roots) ? current : roots));
        }
      } catch {
        // Keep the last known roots.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Home data.
  useEffect(() => {
    if (location.type !== "home" || !isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      const [recentResult, state] = await Promise.allSettled([listRecentItems(30), explorerStateGet()]);
      if (cancelled) return;
      if (recentResult.status === "fulfilled") setRecent(recentResult.value);
      if (state.status === "fulfilled") setStateData(normalizeState(state.value));
    })();
    return () => {
      cancelled = true;
    };
  }, [location.type, homeNonce]);

  // Favorites list on Home.
  useEffect(() => {
    if (location.type !== "home" || homeTab !== "favorites" || !isTauriRuntime()) return;
    let cancelled = false;
    // Skeleton rows if the list isn't back within 0.1 s.
    const timer = window.setTimeout(() => {
      if (!cancelled) setFavoritesLoading(true);
    }, 100);
    listFavoriteItems()
      .then((list) => {
        if (!cancelled) setFavoriteItems(list);
      })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timer);
        if (!cancelled) setFavoritesLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [location.type, homeTab, favoritesNonce, homeNonce]);

  // Drive details for This PC, each with its own timeout.
  useEffect(() => {
    if (location.type !== "drives" || !isTauriRuntime()) return;
    let cancelled = false;
    for (const drive of drives) {
      setDriveStates((current) => ({ ...current, [drive.root]: { status: "loading" } }));
      const timeout = new Promise<never>((_resolve, reject) => window.setTimeout(() => reject(new Error("timeout")), 3000));
      void Promise.race([fetchDriveInfo(drive.root), timeout])
        .then((info) => {
          if (cancelled) return;
          setDriveStates((current) => ({
            ...current,
            [drive.root]: info.ready ? { status: "ready", info } : { status: "not-available" },
          }));
        })
        .catch(() => {
          if (!cancelled) setDriveStates((current) => ({ ...current, [drive.root]: { status: "not-available" } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [location.type, drives, refreshNonce]);

  // Folder loading + watching.
  useEffect(() => {
    if (location.type !== "folder") {
      void watchStop();
      return;
    }
    if (!isTauriRuntime()) {
      setLoadError(true);
      return;
    }
    const path = location.path;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    benchRef.current = { generation, startedAt: performance.now(), done: false };
    const soft = loadModeRef.current === "soft";
    loadModeRef.current = "hard";
    setLoading(true);
    setSkeletonVisible(false);
    setSlowLoad(false);
    setLoadTimedOut(false);
    setLoadError(false);
    const skeletonTimer = window.setTimeout(() => {
      if (generationRef.current === generation) setSkeletonVisible(true);
    }, 100);
    const slowTimer = window.setTimeout(() => {
      if (generationRef.current === generation) setSlowLoad(true);
    }, 1000);
    const timeoutTimer = window.setTimeout(() => {
      if (generationRef.current === generation) setLoadTimedOut(true);
    }, 15000);
    let receivedFirst = false;
    let cancelled = false;
    const collected: ExplorerItem[] = [];
    let watchRefreshTimer = 0;
    let watchUnlisten: (() => void) | null = null;

    void (async () => {
      try {
        const handle = await startListDir(path, { key: sortKey, direction: sortDirection }, (batch) => {
          if (generationRef.current !== generation || cancelled) return;
          if (soft) {
            // Soft refresh (watch / manual refresh): keep the current
            // rows, scroll and focus on screen; swap atomically at the
            // end instead of shrinking the list batch by batch.
            collected.push(...batch);
            return;
          }
          if (!receivedFirst) {
            receivedFirst = true;
            setItems(batch);
          } else {
            setItems((current) => [...current, ...batch]);
          }
        });
        cancelRef.current = handle.cancel;
        const outcome = await handle.completion;
        if (generationRef.current !== generation || cancelled) return;
        if (soft) setItems(collected);
        else setItems((current) => (receivedFirst ? current : []));
        setPartialCount(outcome.skipped.length);
        setLoading(false);
        setSlowLoad(false);
        setLoadTimedOut(false);
        if (!soft) {
          void recordRecentFolder(path)
            .then((next) => setStateData(normalizeState(next)))
            .catch(() => undefined);
        }
        watchUnlisten = await watchStart(path, () => {
          if (generationRef.current !== generation || cancelled) return;
          window.clearTimeout(watchRefreshTimer);
          watchRefreshTimer = window.setTimeout(() => {
            if (generationRef.current === generation && !cancelled) {
              loadModeRef.current = "soft";
              setRefreshNonce((value) => value + 1);
            }
          }, 300);
        }).catch(() => null);
        if (cancelled && watchUnlisten) {
          watchUnlisten();
          watchUnlisten = null;
          void watchStop();
        }
      } catch {
        if (generationRef.current !== generation || cancelled) return;
        setLoading(false);
        if (!soft) setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(skeletonTimer);
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(watchRefreshTimer);
      if (cancelRef.current) void cancelRef.current();
      if (watchUnlisten) watchUnlisten();
      void watchStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.type === "folder" ? location.path : null, sortKey, sortDirection, refreshNonce]);

  useEffect(() => {
    const total =
      location.type === "folder"
        ? visibleItems.length
        : location.type === "home"
          ? homeItems.length
          : location.type === "drives"
            ? drives.length
            : location.type === "gallery"
              ? galleryCount
              : 0;
    onStatsChange?.({
      total,
      selected: summary.count,
      selectedBytes: summary.bytes,
      selectedFiles: summary.files,
      selectedPaths: [...selection.selected],
      viewMode: location.type === "folder" ? viewModeState.mode : null,
      helpSlug: location.type === "gallery" ? "the-gallery" : "browsing-folders",
    });
  }, [onStatsChange, visibleItems.length, homeItems.length, drives.length, galleryCount, location.type, summary, selection.selected, viewModeState.mode]);

  const onFirstPaint = useCallback(() => {
    const bench = benchRef.current;
    if (bench.done) return;
    bench.done = true;
    const elapsed = performance.now() - bench.startedAt;
    (window as unknown as Record<string, unknown>).__adperastraLastFolderOpenMs = elapsed;
    document.querySelector(".adp-explorer")?.setAttribute("data-last-folder-open-ms", String(Math.round(elapsed)));
  }, []);

  const onSort = (key: SortKey) => {
    loadModeRef.current = "soft";
    if (key === sortKey) {
      setSortDirection((value) => (value === "ascending" ? "descending" : "ascending"));
    } else {
      setSortKey(key);
      setSortDirection("ascending");
    }
  };

  const openContextMenu = useCallback((point: { x: number; y: number }, item: ExplorerItem | null) => {
    lastPointer.current = point;
    setRenamingPath(null);
    setMenu({ kind: item ? "item" : "background", anchor: { kind: "point", x: point.x, y: point.y }, startedAt: performance.now(), focusFirst: false });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Opening a folder from Column view (Step 05b): select an item in it,
  // then open its menu once it is selected.
  const navigateColumns = useColumnNavigation({
    location,
    orderPaths,
    selection,
    itemByPath,
    goToFolder,
    setSelection,
    pendingSelectRef,
    openContextMenu,
  });
  const onMenuShown = useCallback(() => {
    const opened = live.current.menu;
    if (!opened) return;
    const elapsed = performance.now() - opened.startedAt;
    (window as unknown as Record<string, unknown>).__adperastraLastMenuOpenMs = elapsed;
    document.querySelector(".adp-explorer")?.setAttribute("data-last-menu-open-ms", String(Math.round(elapsed)));
  }, []);

  const commitRename = useCallback(
    async (item: ExplorerItem, newName: string): Promise<string | null> => {
      try {
        const newPath = displayPath(await renameItem(item.path, newName));
        setItems((list) => list.map((entry) => (entry.path === item.path ? { ...entry, path: newPath, name: newName } : entry)));
        setSelection(selectOnly(newPath));
        undoStack.current.push({
          labelKey: "toast.renamed",
          labelArgs: { name: newName },
          undo: { type: "rename", from: newPath, to: item.path },
          redo: { type: "rename", from: item.path, to: newPath },
        });
        touchUndo();
        notifyAction(t("toast.renamed", { name: newName }), undoStack.current.peekUndo());
        setRenamingPath(null);
        if (live.current.location.type === "home") setHomeNonce((value) => value + 1);
        // Rust moved any favorites along with the item.
        void explorerStateGet()
          .then((state) => setStateData(normalizeState(state)))
          .catch(() => undefined);
        return null;
      } catch (error) {
        const reason = errorReason(error, "rename");
        return t(`errors.rename.${reason}`, { defaultValue: t("errors.rename.other") });
      }
    },
    [t, notifyAction, touchUndo],
  );


  // -------------------------------------------------------------------
  // Drag and drop (Step 03b): a mouse-driven session inside the app,
  // handed to a native Windows drag when the pointer leaves the window;
  // drops from other apps arrive through Tauri's drag-drop event.
  // -------------------------------------------------------------------
  type DragEffect = "copy" | "move" | "link" | "none";
  interface DragSession {
    mode: "idle" | "pending" | "dragging" | "external";
    paths: string[];
    x: number;
    y: number;
  }
  const dragSession = useRef<DragSession>({ mode: "idle", paths: [], x: 0, y: 0 });
  const dragTargetEl = useRef<Element | null>(null);
  const opsRef = useRef({
    performCopyMove,
    createShortcuts: (_paths: string[], _target: string) => {},
    finishExternalMove: (_paths: string[]) => {},
    onActivateTab: (_tabId: string) => {},
    onDropFilesOnTab: (_tabId: string, _paths: readonly string[]): Promise<unknown> => Promise.resolve(),
  });
  opsRef.current = {
    performCopyMove,
    onActivateTab: (tabId: string) => onActivateTab?.(tabId),
    onDropFilesOnTab: (tabId: string, paths: readonly string[]) =>
      onDropFilesOnTab?.(tabId, paths) ?? Promise.resolve(),
    createShortcuts: (paths: string[], target: string) => {
      void (async () => {
        try {
          const created: string[] = [];
          for (const path of paths) {
            created.push(await createShortcut(path, target, t("files.shortcutName", { name: baseNameOf(path) })));
          }
          if (created.length > 0) {
            undoStack.current.push({
              labelKey: "toast.created",
              labelArgs: { name: baseNameOf(created[0]) },
              undo: { type: "recycle", paths: created },
              redo: { type: "restore", originals: created },
            });
            touchUndo();
            notifyAction(t("toast.created", { name: baseNameOf(created[0]) }), undoStack.current.peekUndo());
            refreshAfterOp();
          }
        } catch (error) {
          notifyOpError(error);
        }
      })();
    },
    finishExternalMove: (paths: string[]) => {
      // The drop target copied the files; a Windows move is finished by
      // removing the sources. Where they went is not reported back, so
      // this one action cannot be offered as an undo - the sources go to
      // the Recycle Bin, never away for good, in case the target failed.
      // (After an optimized same-drive move they are already gone.)
      void (async () => {
        try {
          const report = await runFileJob("recycle", paths);
          if (report.completed.length > 0) notify(t("toast.moved", { count: report.completed.length }));
          refreshAfterOp();
        } catch (error) {
          notifyOpError(error);
        }
      })();
    },
  };

  useEffect(() => {
    const driveRoot = (path: string) => {
      const shown = displayPath(path);
      if (shown.startsWith("\\\\")) return shown.split("\\").slice(0, 4).join("\\").toUpperCase();
      return `${shown.split("\\")[0]}\\`.toUpperCase();
    };
    const targetFromPoint = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y)?.closest?.("[data-drop-folder]");
      if (!element) return null;
      const path = element.getAttribute("data-drop-folder");
      if (!path) return null;
      return { element, path, name: element.getAttribute("data-drop-name") ?? path };
    };
    const effectFor = (paths: string[], targetPath: string, event: MouseEvent): DragEffect => {
      const sameFolder = paths.every((path) => {
        const parent = parentPathOf(path);
        return parent !== null && samePath(parent, targetPath);
      });
      if (sameFolder) return "none";
      if (event.altKey) return "link";
      if (event.ctrlKey || event.metaKey) return "copy";
      if (event.shiftKey) return "move";
      return driveRoot(paths[0]) === driveRoot(targetPath) ? "move" : "copy";
    };
    const clearTarget = () => {
      dragTargetEl.current?.classList.remove("adp-drop-target");
      dragTargetEl.current = null;
    };
    const hoverScheduler = createTabHoverScheduler((tabId) => opsRef.current.onActivateTab(tabId));
    const hoverMs = normalizeHoverMs(dragHoverMs ?? 600);
    let hoveredTab: string | null = null;
    const endSession = () => {
      dragSession.current = { mode: "idle", paths: [], x: 0, y: 0 };
      clearTarget();
      hoverScheduler.end();
      hoveredTab = null;
      setDragBadge(null);
    };
    const onMove = (event: MouseEvent) => {
      const session = dragSession.current;
      if (session.mode === "pending") {
        if (Math.hypot(event.clientX - session.x, event.clientY - session.y) < 6) return;
        session.mode = "dragging";
      }
      if (session.mode !== "dragging") return;
      const target = targetFromPoint(event.clientX, event.clientY);
      clearTarget();
      if (target) {
        dragTargetEl.current = target.element;
        target.element.classList.add("adp-drop-target");
      }
      const effect = target ? effectFor(session.paths, target.path, event) : "none";
      if (target && effect !== "none") {
        const key = effect === "copy" ? "drag.copyTo" : effect === "move" ? "drag.moveTo" : "drag.shortcutTo";
        setDragBadge({ x: event.clientX, y: event.clientY, key, name: target.name });
      } else {
        setDragBadge(null);
      }
      const hovered =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest?.("[data-tab-target]")
          ?.getAttribute("data-tab-target") ?? null;
      if (hovered === null) {
        if (hoveredTab !== null) {
          hoveredTab = null;
          hoverScheduler.leave();
        }
      } else if (hovered !== hoveredTab) {
        hoveredTab = hovered;
        hoverScheduler.enter(hovered, hoverMs);
      }
      session.x = event.clientX;
      session.y = event.clientY;
    };
    const onUp = (event: MouseEvent) => {
      const session = dragSession.current;
      if (session.mode === "pending") {
        session.mode = "idle";
        return;
      }
      if (session.mode !== "dragging") return;
      const tabId =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest?.("[data-tab-target]")
          ?.getAttribute("data-tab-target") ?? null;
      const paths = session.paths;
      if (tabId !== null) {
        endSession();
        void opsRef.current.onDropFilesOnTab(tabId, paths).catch(() => undefined);
        return;
      }
      const target = targetFromPoint(event.clientX, event.clientY);
      const effect = target ? effectFor(session.paths, target.path, event) : "none";
      endSession();
      if (!target || effect === "none") return;
      if (effect === "link") opsRef.current.createShortcuts(paths, target.path);
      else void opsRef.current.performCopyMove(effect, paths, target.path);
    };
    const onLeave = () => {
      const session = dragSession.current;
      if (session.mode !== "dragging" || !isTauriRuntime()) return;
      const paths = session.paths;
      session.mode = "external";
      clearTarget();
      hoverScheduler.end();
      hoveredTab = null;
      setDragBadge(null);
      startExternalDrag(paths)
        .then((effect) => {
          if (effect === "move") opsRef.current.finishExternalMove(paths);
          if (effect !== "none") refreshAfterOp();
        })
        .catch((error: unknown) => notifyOpError(error))
        .finally(() => {
          dragSession.current.mode = "idle";
        });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragSession.current.mode === "dragging") endSession();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mouseleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drops from other apps (Explorer, desktop): Tauri reports the paths
  // and the window position; the folder under the pointer is the target.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
          // Hidden behind another tab: a drop must not land in this folder.
          if (!activeRef.current) return;
          const scale = window.devicePixelRatio || 1;
          const x = event.payload.position.x / scale;
          const y = event.payload.position.y / scale;
          // The strip owns drops over its own targets (Step 09c T4).
          const rawHit = document.elementFromPoint(x, y);
          if (rawHit?.closest?.("[data-tab-bar]")) return;
          const element = rawHit?.closest?.("[data-drop-folder]");
          const attr = element?.getAttribute("data-drop-folder");
          const current = live.current.location;
          const dest = attr ?? (current.type === "folder" ? current.path : null);
          if (!dest) return;
          const paths = event.payload.paths.map(displayPath);
          void routeFileDrop(
            { kind: "folder", destDir: dest },
            paths,
            { ctrl: false, shift: false, alt: false },
            {
              copyMove: (kind, sources, destDir) =>
                opsRef.current.performCopyMove(kind, [...sources], destDir).then(() => undefined),
            },
          );
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const segments =
    location.type === "folder"
      ? pathSegments(location.path)
      : [{ label: location.type === "drives" ? t("explorer.nav.thisPc") : location.type === "home" ? t("explorer.nav.home") : t(`explorer.nav.${location.type}`), path: location.type }];
  const placeLabel =
    location.type === "folder"
      ? (segments[segments.length - 1]?.label ?? location.path)
      : segments[0].label;
  const labelFor = (loc: ExplorerLocation): string =>
    loc.type === "folder"
      ? loc.path
      : loc.type === "drives"
        ? t("explorer.nav.thisPc")
        : loc.type === "gallery"
          ? t("explorer.nav.gallery")
          : loc.type === "network"
            ? t("explorer.nav.network")
            : t("explorer.nav.home");
  const historyEntries = history.back
    .map((entry, index) => ({ label: labelFor(entry), distance: history.back.length - index }))
    .reverse();

  const pinnedCards = useMemo(() => {
    const knownByPath = new Map(knownFolders.map((f) => [f.path.toLowerCase(), f]));
    const seen = new Set<string>();
    const cards: { name: string; path: string; location: string }[] = [];
    const push = (name: string, path: string) => {
      const key = displayPath(path).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const parent = parentPathOf(displayPath(path));
      cards.push({ name, path: displayPath(path), location: parent ?? "" });
    };
    for (const folder of knownFolders.filter((f) => f.id !== "home")) push(folder.name, folder.path);
    for (const pinned of stateData.pinned_folders) {
      const known = knownByPath.get(displayPath(pinned).toLowerCase());
      if (!known) push(displayPath(pinned).split("\\").filter(Boolean).pop() ?? pinned, pinned);
    }
    return cards;
  }, [knownFolders, stateData.pinned_folders]);

  // Step 05a: the View menu and command bar follow the chosen order.
  const commandBar = useMemo(() => commandBarFor(view.view_mode_order), [view.view_mode_order]);
  const backgroundMenu = useMemo(() => backgroundMenuFor(view.view_mode_order), [view.view_mode_order]);

  const listProps = {
    doubleClickMs,
    pickActive: pickDropEnabled,
    onPickTarget: (item: ExplorerItem) => {
      if (item.kind !== "folder" && item.kind !== "drive") return;
      pickDestRef.current = item.path;
      onPickDropRequest?.();
    },
    onPickCurrentTarget:
      pickDropEnabled && location.type === "folder"
        ? () => {
            pickDestRef.current = location.path;
            onPickDropRequest?.();
          }
        : undefined,
    folderPath: location.type === "folder" ? location.path : undefined,
    folderBackgrounds: view.folder_backgrounds,
    columnSetsEnabled: view.column_sets_enabled,
    selection,
    onSelectionChange: setSelection,
    sortKey,
    sortDirection,
    showExtensions: view.show_extensions,
    checkboxes: view.item_checkboxes,
    folderSizeText:
      location.type === "folder"
        ? (item: ExplorerItem) =>
            item.kind === "folder" ? folderSizeState.textFor(item.path) : null
        : undefined,
    typeLabel,
    renamingPath,
    onStartRename: (item: ExplorerItem) => {
      if (commandById["explorer.rename"] && isCommandEnabled(commandById["explorer.rename"], commandCtxRef.current)) setRenamingPath(item.path);
    },
    onRenameCommit: commitRename,
    onRenameCancel: () => setRenamingPath(null),
    onOpen: openOne,
    onOpenInBackground: (item: ExplorerItem) => openOne(item, true),
    onContextMenu: openContextMenu,
    onCommandKey: runById,
    onPreview: (item: ExplorerItem) => {
      // A folder tab owns its preview surface (Step 09a E6), so Space and
      // the preview command toggle its dialog instead of a hidden local one.
      if (!onPreviewItem) toggleQuickPreview(item, listItems);
      else onPreviewItem(previewItem !== null ? null : item);
    },
    onItemMouseDown: (event: ReactMouseEvent, item: ExplorerItem) => {
      if (event.button !== 0) return;
      const selected = live.current.selectedPaths;
      const paths = selected.includes(item.path) ? selected : [item.path];
      if (!selected.includes(item.path)) setSelection(selectOnly(item.path));
      dragSession.current = { mode: "pending", paths, x: event.clientX, y: event.clientY };
    },
  };

  let folderContent = null;
  if (location.type === "folder") {
    if (!isTauriRuntime()) {
      folderContent = <p className="adp-empty-note">{t("explorer.browserPreview")}</p>;
    } else if (loadError) {
      folderContent = (
        <>
          <p className="adp-empty-note">{t("explorer.loadError")}</p>
          <p>
            <button type="button" className="adp-btn" onClick={refresh}>
              {t("commands.refresh")}
            </button>
          </p>
        </>
      );
    } else {
      const showSkeleton = skeletonVisible && loading && items.length === 0;
      const showSlow = slowLoad && loading;
      const showTimedOut = loadTimedOut && loading;
      const showEmpty = !loading && visibleItems.length === 0 && !search;
      const showNoResults = !loading && items.length > 0 && visibleItems.length === 0 && Boolean(search);
      const columnsMode = viewModeState.mode === "columns";
      const showList = visibleItems.length > 0 || columnsMode;
      const columnOptions: ColumnViewOptions = {
        folder: location.path,
        root: viewModeState.columnRoot ?? location.path,
        note: showSkeleton ? "loading" : showEmpty ? "empty" : showNoResults ? "noResults" : null,
        loading,
        showHidden: view.show_hidden,
        groupBy: activeGroupBy,
        refreshKey: columnsNonce,
        width: view.column_width,
        showPreview: view.column_preview,
        onWidthChange: (width) => onViewChange?.({ column_width: width }),
        onNavigate: navigateColumns,
        onDragItem: (event, item) => {
          if (event.button !== 0) return;
          dragSession.current = { mode: "pending", paths: [item.path], x: event.clientX, y: event.clientY };
        },
      };
      folderContent = (
        <>
          {!columnsMode && showSkeleton ? <Skeleton variant={skeletonVariant(viewModeState.mode)} count={10} /> : null}
          {showSlow ? <p className="adp-note">{t("explorer.stillLoading")}</p> : null}
          {showTimedOut ? <p className="adp-note">{t("explorer.notAvailable")}</p> : null}
          {partialCount > 0 ? <p className="adp-note" role="status">{t("explorer.someItemsUnreadable")}</p> : null}
          {!columnsMode && showEmpty ? <p className="adp-empty-note">{t("explorer.emptyFolder")}</p> : null}
          {!columnsMode && showNoResults ? <p className="adp-empty-note">{t("explorer.noSearchResults")}</p> : null}
          {showList ? (
            <ItemView
              active={active}
              {...listProps}
              items={visibleItems}
              groups={groups}
              onSort={onSort}
              onFirstPaint={onFirstPaint}
              label={t("explorer.fileListLabel")}
              mode={viewModeState.mode}
              onZoomStep={viewModeState.zoomStep}
              columnOptions={columnsMode ? columnOptions : undefined}
            />
          ) : null}
        </>
      );
    }
  }

  let homeList;
  if (homeTab === "favorites" && favoritesLoading && homeItems.length === 0) {
    homeList = <Skeleton variant="rows" count={5} />;
  } else if (homeItems.length === 0) {
    homeList = <p className="adp-empty-note">{t(homeTab === "favorites" ? "explorer.favoritesEmpty" : "explorer.recentEmpty")}</p>;
  } else {
    homeList = (
      <FileList
        {...listProps}
        items={homeItems}
        groups={null}
        virtual={false}
        label={t(homeTab === "favorites" ? "explorer.favorites" : "explorer.recent")}
      />
    );
  }

  const detailsFolder =
    location.type === "folder"
      ? { path: location.path, name: placeLabel, itemCount: visibleItems.length }
      : null;

  // The Details pane goes on the right or under the files (Step 05c).
  const detailsPane = (placement: "right" | "bottom") =>
    view.details_pane ? (
      <DetailsPane
        selected={selectedItems}
        summary={summary}
        folder={detailsFolder}
        showExtensions={view.show_extensions}
        typeLabel={typeLabel}
        onCopyPath={(path) => {
          writeClipboard(pathsForClipboard([path]))
            .then(() => notify(t("toast.pathsCopied", { count: 1 })))
            .catch(() => notify(t("errors.copyPath.other")));
        }}
        onOpenHelp={(slug) => onOpenHelp(slug ?? "details-pane")}
        onOpen={(item) => openOne(item)}
        onOpenDrive={onOpenMountedDrive ?? goToFolder}
        onShowHistory={(path) => {
          const item = live.current.itemByPath.get(path);
          if (item && item.kind !== "folder") setHistoryFor(item);
        }}
        placement={placement}
        columnSetsEnabled={view.column_sets_enabled}
        folderSizeText={
          folderSizes.enabled && folderSizes.details
            ? folderSizeState.textFor
            : undefined
        }
      />
    ) : null;

  return (
    <div className="adp-explorer" ref={rootRef}>
      <AddressBar
        backCommand={commandById["explorer.back"]}
        forwardCommand={commandById["explorer.forward"]}
        upCommand={commandById["explorer.up"]}
        refreshCommand={commandById["explorer.refresh"]}
        commandCtx={commandCtx}
        onRun={runCommand}
        onNavigatePath={(path) => actions.goToPath(path)}
        segments={segments}
        rootSiblings={drives.map((d) => ({ label: d.root, path: d.root }))}
        editablePath={location.type === "folder" ? location.path : null}
        shortcutsEnabled={active}
        placeLabel={placeLabel}
        historyEntries={historyEntries}
        onHistory={(distance) => {
          setHistory((current) => {
            let next = current;
            for (let i = 0; i < distance; i += 1) next = goBack(next);
            return next;
          });
        }}
        search={search}
        onSearch={setSearch}
        extra={
          <Suspense fallback={null}>
            <AiActionsLauncher
              trigger="icon"
              items={selectedItems
                .filter((item) => item.kind === "file")
                .map((item) => ({ path: item.path, name: item.name }))}
              onOpenStorage={onOpenAppStorage}
              onOpenHelp={onOpenHelp}
              onNotify={notify}
            />
            <ExtractionLauncher
              trigger="icon"
              items={selectedItems
                .filter((item) => item.kind === "file")
                .map((item) => ({ path: item.path, name: item.name }))}
              onOpenHelp={(slug) => onOpenHelp(slug)}
              onOpenFile={
                onOpenFile
                  ? (path) => onOpenFile(path, false)
                  : undefined
              }
              onNotify={notify}
            />
          </Suspense>
        }
      />
      <ToolbarDock
        toolbar={
          <>
            <div
              className="adp-toolbar-leading"
              style={{
                display: "flex",
                flexDirection:
                  layout.toolbar_position === "left" || layout.toolbar_position === "right"
                    ? "column"
                    : "row",
                alignItems: "center",
                gap: 4,
                flex: "0 0 auto",
                minWidth: 0,
              }}
            >
              {toolbarCustom.classic_menu ? (
                <ClassicMenuBar groups={CLASSIC_MENU_GROUPS} commands={commands} ctx={commandCtx} />
              ) : null}
              <QuickAccessBar
                settings={toolbarCustom}
                registry={commandLayout}
                commands={commands}
                ctx={commandCtx}
              />
            </div>
            <CommandBar entries={commandBar} layout={commandBarLayout} ctx={commandCtx} lookup={lookup} onRun={runCommand} onOpenHelp={() => onOpenHelp("command-bar")} />
          </>
        }
        contentClassName="adp-explorer-main"
      >
        <div className={`adp-explorer-body${layout.nav_pane_position === "right" ? " adp-explorer-body--nav-right" : ""}`}>
          {layout.nav_pane_position === "hidden" ? null : (
            <NavPane
              knownFolders={knownFolders}
              pinnedFolders={stateData.pinned_folders}
              drives={drives}
              location={location}
              onHome={() => goToLocation({ type: "home" })}
              onGallery={() => goToLocation({ type: "gallery" })}
              onDrives={() => goToLocation({ type: "drives" })}
              onNetwork={() => goToLocation({ type: "network" })}
              onOpenFolder={goToFolder}
              onUnpin={(path) => {
                void unpinFolder(path).then((next) => setStateData(normalizeState(next))).catch(() => undefined);
              }}
              navigation={shellCustom?.navigation}
              onSavedGroups={onSavedGroups}
            />
          )}
          <div className="adp-explorer-center">
            {aiSortChip && !searchOpen && !indexedView && !storagePane ? (
              <SortSuggestionChip
                suggestion={aiSortChip.suggestion}
                destinationLabel={aiSortChip.destinationLabel}
                onMove={async () => {
                  const current = aiSortChip;
                  if (!current) return;
                  const handle = await moveWithSuggestion({
                    suggestion: current.suggestion,
                    sourcePath: current.sourcePath,
                    sourceStamp: current.suggestion.source_stamp,
                    destinations: aiSearchSettingsRef.current.destinations,
                  });
                  openTransfer(handle.id);
                  await handle.completion;
                  setAiSortChip(null);
                  refresh();
                }}
                onNotNow={() => setAiSortChip(null)}
                onNever={async () => {
                  // The native history write is not exposed as a UI command
                  // yet; remember the opt-out for this session and dismiss.
                  const extension = aiSortChip?.suggestion.extension;
                  if (!extension) return;
                  aiSortNeverRef.current.add(extension);
                  setAiSortChip(null);
                }}
                onOpenHelp={onOpenHelp}
              />
            ) : null}
            <section
              className="adp-explorer-content"
              onContextMenu={(event) => {
                // The file list handles its own right-clicks; this covers empty
                // folders, loading states, and messages.
                if (event.defaultPrevented) return;
                event.preventDefault();
                // Search results and indexed views are not a folder listing;
                // no background menu.
                if (searchOpen || indexedView || storagePane) return;
                if (live.current.location.type !== "folder") return;
                setSelection((current) => clearSelection(current));
                openContextMenu({ x: event.clientX, y: event.clientY }, null);
              }}
            >
              {indexedView ? (
                <div className="adp-explorer-search-pane">
                  <div className="adp-explorer-search-head">
                    <h2 className="adp-explorer-search-title">{t("views.title")}</h2>
                    <button
                      type="button"
                      className="adp-icon-btn"
                      aria-label={t("common.close")}
                      title={t("common.close")}
                      onClick={() => setIndexedView(null)}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <Suspense fallback={<Skeleton variant="tiles" count={8} />}>
                    <IndexedViews
                      key={indexedView}
                      query={searchQuery}
                      active={active}
                      initialView={indexedView}
                      enabled={views.enabled_views}
                      dateSource={views.date_source}
                      onOpenFile={(path) => {
                        if (onOpenFile) void onOpenFile(path, false).catch((error: unknown) => notifyError(error, "files"));
                        else if (isTauriRuntime()) void openItem(path).catch((error: unknown) => notifyError(error, "open"));
                      }}
                      onOpenHelp={() => onOpenHelp("timeline-calendar-kind-views")}
                    />
                  </Suspense>
                </div>
              ) : storagePane ? (
                <div className="adp-explorer-search-pane">
                  <Suspense fallback={<Skeleton variant="rows" count={6} />}>
                    {storagePane.kind === "storage" ? (
                      <StorageView
                        key={`storage-${storagePane.nonce}`}
                        request={{
                          root: storagePane.root,
                          allow_network: false,
                          include_hidden: view.show_hidden,
                          max_entries: 1_000_000,
                        }}
                        active={active}
                        onOpenFolder={async (path) => {
                          setStoragePane(null);
                          goToFolder(path);
                        }}
                        onOpenFile={openFileFromStorage}
                        onMutation={storageMutation}
                        onOpenHelp={onOpenHelp}
                        onClose={() => setStoragePane(null)}
                      />
                    ) : (
                      <DuplicateFinder
                        key={`duplicates-${storagePane.nonce}`}
                        request={{
                          roots: [storagePane.root],
                          include_hidden: view.show_hidden,
                          allow_network: false,
                          minimum_bytes: 0,
                        }}
                        active={active}
                        onOpenFile={openFileFromStorage}
                        onOpenHelp={onOpenHelp}
                        onClose={() => setStoragePane(null)}
                      />
                    )}
                  </Suspense>
                </div>
              ) : searchOpen ? (
                <div className="adp-explorer-search-pane">
                  <div className="adp-explorer-search-head">
                    <h2 className="adp-explorer-search-title">{t("search.title")}</h2>
                    {savedSearches.length > 0 ? (
                      <div className="adp-search-saved" role="group" aria-label={t("search.savedName")}>
                        {savedSearches.map((saved) => (
                          <span className="adp-search-saved__item" key={saved.id}>
                            <button
                              type="button"
                              className="adp-btn"
                              title={saved.name}
                              onClick={() => setSearchQuery(saved.query)}
                            >
                              {saved.name}
                            </button>
                            <button
                              type="button"
                              className="adp-icon-btn"
                              aria-label={`${t("commands.delete")}: ${saved.name}`}
                              title={t("commands.delete")}
                              onClick={() => void removeSaved(saved.id)}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="adp-icon-btn"
                      aria-label={t("common.close")}
                      title={t("common.close")}
                      onClick={() => setSearchOpen(false)}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {aiSearchMode ? (
                    <AiSearchPanel
                      key={aiSearchMode}
                      initialMode={aiSearchMode}
                      settings={aiSearchSettings}
                      indexRoots={searchConfig.roots}
                      providerAvailable={aiProviderReady}
                      onOpenFile={
                        onOpenFile
                          ? (path) => onOpenFile(path, false)
                          : async (path) => {
                              await openItem(path);
                            }
                      }
                      onNaturalResults={(_page, query) => {
                        setSearchQuery(query);
                        setSearchNonce((value) => value + 1);
                        setAiSearchMode(null);
                      }}
                      onOpenHelp={onOpenHelp}
                    />
                  ) : (
                    <SearchResultsView
                      key={searchNonce}
                      query={searchQuery}
                      viewFolderPresentation={searchPresentation}
                      active={active && searchOpen}
                      onOpenFile={
                        onOpenFile
                          ? (path) => onOpenFile(path, false)
                          : async (path) => {
                              await openItem(path);
                            }
                      }
                      onQueryChange={setSearchQuery}
                      onOpenHelp={onOpenHelp}
                      indexRoots={searchConfig.roots}
                      onSaved={() => {
                        void listSavedSearches()
                          .then(setSavedSearches)
                          .catch(() => undefined);
                      }}
                    />
                  )}
                </div>
              ) : (
                <>
              {location.type === "home" ? (
                <>
                  <HomePage
                  knownFolders={knownFolders}
                  pinnedCards={pinnedCards}
                  onOpenFolder={goToFolder}
                  onOpenHelp={() => onOpenHelp("home-page")}
                  tab={homeTab}
                  onTabChange={(tab) => {
                    setSelection(EMPTY_SELECTION);
                    setRenamingPath(null);
                    setHomeTab(tab);
                  }}
                >
                  {homeList}
                </HomePage>
                </>
              ) : null}

              {location.type === "drives" ? (
                <DriveList drives={drives} states={driveStates} onOpenDrive={goToFolder} />
              ) : null}

              {location.type === "gallery" ? (
                <Suspense fallback={<Skeleton variant="tiles" count={8} />}>
                  <GalleryContent
                    settings={gallery}
                    active={active}
                    showHidden={view.show_hidden}
                    showSystem={false}
                    showExtensions={view.show_extensions}
                    onOpenFile={
                      onOpenFile ??
                      (async (path) => {
                        await openItem(path);
                      })
                    }
                    onSettingsChange={
                      onGallerySettingsChange ??
                      (async () => {
                        throw new Error("settings.unavailable");
                      })
                    }
                    onOpenHelp={onOpenHelp}
                    request={galleryRequest}
                    onSourceSelected={setGallerySourceSelected}
                    onCountChange={setGalleryCount}
                  />
                </Suspense>
              ) : null}
              {location.type === "network" ? <p className="adp-empty-note">{t("explorer.networkPlaceholder")}</p> : null}
              {folderContent}
                </>
              )}
            </section>
            {layout.details_pane_position === "bottom" ? detailsPane("bottom") : null}
          </div>
          {layout.details_pane_position === "right" ? detailsPane("right") : null}
        </div>
      </ToolbarDock>
      {clipboardOpen ? (
        <ClipboardHistoryPanel
          targetId={location.type === "folder" ? location.path : null}
          onPaste={pasteHistoryEnvelope}
          onClose={() => setClipboardOpen(false)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {quickPreviewSelection ? (
        <QuickPreviewDialog
          selection={quickPreviewSelection}
          onClose={closeQuickPreview}
          onOpen={async (path) => {
            const item = live.current.itemByPath.get(path);
            if (item) openOne(item);
          }}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {permanentAsk ? <PermanentDialog count={permanentAsk.count} onAnswer={permanentAsk.answer} /> : null}
      {systemAsk ? <SystemItemsDialog onAnswer={systemAsk} onOpenHelp={() => onOpenHelp("copying-and-moving")} /> : null}
      {historyFor ? (
        <VersionHistoryDialog
          path={historyFor.path}
          name={historyFor.name}
          currentModified={historyFor.modified_unix}
          currentSize={historyFor.size}
          versionsEnabled={versionsEnabled}
          onOpenCopy={(path) => {
            if (onOpenFile) void onOpenFile(path, false).catch((error: unknown) => notifyError(error, "files"));
          }}
          onShowWindowsVersions={() => {
            if (isTauriRuntime())
              void showProperties([historyFor.path]).catch((error: unknown) => notifyError(error, "properties"));
          }}
          onRestored={(result, version) => {
            if (result.previous_id !== null) {
              undoStack.current.push({
                labelKey: "toast.versionRestored",
                labelArgs: { name: historyFor.name },
                undo: { type: "restoreVersion", path: historyFor.path, versionId: result.previous_id },
                redo: { type: "restoreVersion", path: historyFor.path, versionId: version.id },
              });
              touchUndo();
              notifyAction(
                t("toast.versionRestored", { name: historyFor.name }),
                undoStack.current.peekUndo(),
              );
            }
            refresh();
          }}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}
      {columnChooser !== null ? (
        <ColumnChooser
          value={columnChooser}
          onChange={changeColumns}
          onClose={() => setColumnChooser(null)}
        />
      ) : null}
      {recentOpen ? (
        <RecentActionsDialog
          items={undoStack.current.recent(20)}
          onUndo={(entry) => {
            if (undoStack.current.isTopUndo(entry)) void performUndo();
            else notify(t("toast.undoNewerFirst"));
          }}
          onRedo={(entry) => {
            if (undoStack.current.isTopRedo(entry)) void performRedo();
            else notify(t("toast.undoNewerFirst"));
          }}
          onClose={() => setRecentOpen(false)}
        />
      ) : null}
      {templatePickerOpen ? (
        <TemplatePickerDialog
          lang={i18n.language}
          onCreate={async (templatePath, name, options) => {
            const current = live.current.location;
            if (current.type !== "folder" || !isTauriRuntime()) throw new Error("templates.not_found");
            recordCreated(await createFromTemplate(templatePath, current.path, name, options));
          }}
          onFolderChange={(folder) => onTemplatesFolderChange?.(folder)}
          onOpenFolder={goToFolder}
          onClose={() => setTemplatePickerOpen(false)}
        />
      ) : null}
      {indexOpen ? (
        <Dialog
          title={t("search.index")}
          onClose={() => setIndexOpen(false)}
          className="adp-search-index-dialog"
        >
          {indexStatus ? (
            <IndexSettings
              settings={searchConfig}
              status={indexStatus}
              onChange={(next) => onSearchSettingsChange?.(next)}
              onAddRoot={addIndexRoot}
              onPause={pauseIndexing}
              onRebuild={rebuildIndexes}
              onOpenStorage={() => onOpenAppStorage?.()}
              onOpenHelp={onOpenHelp}
            />
          ) : (
            <p role="status">
              {isTauriRuntime() ? t("search.loading") : t("errors.search.unavailable")}
            </p>
          )}
        </Dialog>
      ) : null}
      {tagPicker ? (
        <TagPicker
          catalog={tagPicker.catalog}
          value={tagPicker.value}
          onApply={applyTagSelection}
          onClose={() => setTagPicker(null)}
          onOpenHelp={() => onOpenHelp("tags")}
        />
      ) : null}
      {tagManager ? (
        <TagManager
          catalog={tagManager}
          onCatalogChange={setTagManager}
          onImport={() => void importTagCatalog()}
          onExport={() => void exportTagCatalog()}
          onClose={() => setTagManager(null)}
          onOpenHelp={() => onOpenHelp("managing-tags")}
        />
      ) : null}
      {tagImport ? (
        <TagImportDialog
          preview={tagImport}
          onApply={applyTagImportChoices}
          onClose={() => setTagImport(null)}
          onOpenHelp={() => onOpenHelp("managing-tags")}
        />
      ) : null}
      {smartFolderOpen ? (
        <Dialog title={t("smartFolders.save")} onClose={() => setSmartFolderOpen(false)}>
          <label className="adp-field">
            <span className="adp-field-label">{t("smartFolders.name")}</span>
            <TextInput
              value={smartFolderName}
              onChange={setSmartFolderName}
              maxLength={60}
              disabled={smartFolderBusy}
            />
          </label>
          <div className="adp-dialog-actions">
            <button
              type="button"
              className="adp-btn"
              onClick={() => setSmartFolderOpen(false)}
              disabled={smartFolderBusy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="adp-btn adp-btn--primary"
              onClick={() => void confirmSmartFolder()}
              disabled={smartFolderBusy || !smartFolderName.trim()}
            >
              {t("common.save")}
            </button>
          </div>
        </Dialog>
      ) : null}
      {dragBadge ? (
        <div
          className="adp-drag-badge"
          style={{ left: dragBadge.x + 14, top: dragBadge.y + 18 }}
        >
          {t(dragBadge.key, { name: dragBadge.name })}
        </div>
      ) : null}
      {jobsOpen ? (
        <JobsPanel
          jobs={jobs}
          onDismiss={(id) => setJobs((list) => list.filter((job) => job.id !== id))}
          onClose={() => setJobsOpen(false)}
        />
      ) : jobs.length > 0 ? (
        <button type="button" className="adp-jobs-button" onClick={() => setJobsOpen(true)}>
          {t("jobs.title")}
          {` (${jobs.length})`}
        </button>
      ) : null}
      {menu ? (
        <Menu
          entries={resolveMenu(
            menu.kind === "item"
              ? resolveCustomMenu(
                  commandCtx.selectedKind === "folder" ? "folder" : "file",
                  shellCustom?.menus ?? [],
                  ITEM_MENU,
                  liveCommandRegistry,
                )
              : resolveCustomMenu("background", shellCustom?.menus ?? [], backgroundMenu, liveCommandRegistry),
            commandCtx,
            lookup,
            simpleMode,
          )}
          ctx={commandCtx}
          lookup={lookup}
          anchor={menu.anchor}
          focusFirst={menu.focusFirst}
          ariaLabel={t("explorer.contextMenu")}
          onRun={runCommand}
          onClose={closeMenu}
          onShown={onMenuShown}
        />
      ) : null}
      {busyNote ? (
        <div className="adp-busy-note" role="status">
          {busyNote}
        </div>
      ) : null}
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((list) => list.filter((toast) => toast.id !== id))}
        onUndo={undoFromToast}
      />
      {bulkRenamePaths ? (
        <BulkRenameDialog
          paths={bulkRenamePaths}
          executeAvailable={false}
          aiReview={aiNameReview}
          onClose={() => {
            setBulkRenamePaths(null);
            setAiNameReview(null);
          }}
          onCompleted={() => refresh()}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {batchInputs ? (
        <ConversionProvider value={{ trackJob, notify, notifyAction, notifyError, undoStack: undoStack.current, touchUndo, currentFolder: () => live.current.location.type === "folder" ? live.current.location.path : null, showResult }}>
          <BatchActionsDialog
            inputs={batchInputs}
            onClose={() => setBatchInputs(null)}
            onCompleted={(report) => {
              if (report.created_paths.length > 0) refresh();
            }}
            onOpenHelp={onOpenHelp}
          />
        </ConversionProvider>
      ) : null}
      {conversionInputs && conversionInputs.length > 0 ? (
        <ConversionProvider value={{ trackJob, notify, notifyAction, notifyError, undoStack: undoStack.current, touchUndo, currentFolder: () => live.current.location.type === "folder" ? live.current.location.path : null, showResult }}>
          <QuickConvertDialog inputs={conversionInputs} onClose={() => { setConversionInputs(null); const release = conversionRelease.current; conversionRelease.current = null; void release?.(); }} onCompleted={() => refresh()} onOpenHelp={onOpenHelp} />
        </ConversionProvider>
      ) : null}
      {archivePrompts.dialog}
      {compressRequest ? (
        <CompressDialog
          sources={compressRequest.sources}
          initialFolder={compressRequest.folder}
          onCreate={(request) => archiveCreate.create(request)}
          onClose={() => setCompressRequest(null)}
          onOpenHelp={() => onOpenHelp("creating-archives")}
        />
      ) : null}
    </div>
  );
}
