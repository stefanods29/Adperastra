import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "../i18n";
import Menu, { type MenuAnchor } from "../components/Menu";
import Skeleton from "../components/Skeleton";
import ToastStack, { type ToastData } from "../components/Toast";
import { createExplorerCommands, type ExplorerActions, type ViewToggle } from "../commands/explorerCommands";
import { BACKGROUND_MENU, COMMAND_BAR, ITEM_MENU, resolveMenu } from "../commands/menus";
import { CommandRegistry, isCommandEnabled, type Command, type CommandContext } from "../commands/registry";
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
import { groupItems } from "../services/grouping";
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
import { isTauriRuntime, type ExplorerViewSettings } from "../services/settings";
import AddressBar from "./explorer/AddressBar";
import CommandBar from "./explorer/CommandBar";
import DetailsPane from "./explorer/DetailsPane";
import DriveList, { type DriveLoadState } from "./explorer/DriveList";
import FileList from "./explorer/FileList";
import { fileExtension } from "./explorer/fileTile";
import HomePage, { type HomeTab } from "./explorer/HomePage";
import NavPane from "./explorer/NavPane";

/** What the status bar shows for the Explorer tab. */
export interface ExplorerStats {
  total: number;
  selected: number;
  selectedBytes: number;
  selectedFiles: number;
}

export interface ExplorerHomeProps {
  onStatsChange?: (stats: ExplorerStats) => void;
  onOpenHelp: (slug?: string) => void;
  /** View options from settings (schema 3); defaults when absent. */
  view?: ExplorerViewSettings;
  onViewChange?: (patch: Partial<ExplorerViewSettings>) => void;
}

const DEFAULT_VIEW: ExplorerViewSettings = {
  show_hidden: false,
  show_extensions: true,
  item_checkboxes: false,
  details_pane: false,
  group_by: "none",
};

const VIEW_SETTING: Record<ViewToggle, keyof Omit<ExplorerViewSettings, "group_by">> = {
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

export default function ExplorerHome({ onStatsChange, onOpenHelp, view: viewProp, onViewChange }: ExplorerHomeProps) {
  const { t, i18n } = useTranslation();
  const view = viewProp ?? DEFAULT_VIEW;
  const [history, setHistory] = useState<NavHistory>(() => createHistory({ type: "home" }));
  const location = history.current;
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
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [loading, setLoading] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [partialCount, setPartialCount] = useState(0);
  const [skeletonVisible, setSkeletonVisible] = useState(false);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const loadModeRef = useRef<"hard" | "soft">("hard");
  const [refreshNonce, setRefreshNonce] = useState(0);
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

  const goToLocation = useCallback((next: ExplorerLocation) => {
    setSearch("");
    setSelection(EMPTY_SELECTION);
    setRenamingPath(null);
    setMenu(null);
    setPartialCount(0);
    setItems([]);
    setHistory((current) => navigate(current, next));
  }, []);

  const goToFolder = useCallback((path: string) => goToLocation({ type: "folder", path: displayPath(path) }), [goToLocation]);

  const refresh = useCallback(() => {
    if (location.type === "folder") {
      loadModeRef.current = "soft";
      setRefreshNonce((value) => value + 1);
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
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) => (view.show_hidden || !(item.hidden || item.system)) && (!query || item.name.toLowerCase().includes(query)),
    );
  }, [items, search, view.show_hidden]);

  const recentMerged = useMemo(() => mergeRecentItems(recent, stateData.recent_folders), [recent, stateData.recent_folders]);

  const homeItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = homeTab === "favorites" ? favoriteItems : recentMerged;
    return source.map(toExplorerItem).filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [homeTab, favoriteItems, recentMerged, search]);

  const groups = useMemo(
    () => (location.type === "folder" && view.group_by !== "none" ? groupItems(visibleItems, view.group_by, new Date(), typeLabel) : null),
    [location.type, view.group_by, visibleItems, typeLabel],
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

  const summary = useMemo(() => summarizeSelection(selection.selected, (path) => itemByPath.get(path)), [selection.selected, itemByPath]);
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
    view: {
      showHidden: view.show_hidden,
      showExtensions: view.show_extensions,
      itemCheckboxes: view.item_checkboxes,
      detailsPane: view.details_pane,
      groupBy: view.group_by,
      sortKey,
      sortDirection,
    },
    allFavorites,
    selectionInCurrentFolder: location.type === "folder",
  };
  const commandCtxRef = useRef(commandCtx);
  commandCtxRef.current = commandCtx;

  // Actions read the latest state through this ref, so the command list
  // (and every menu built from it) stays stable between renders.
  const live = useRef({ location, orderPaths, selectedPaths, itemByPath, stateData, sortKey, sortDirection, view, allFavorites, menu });
  live.current = { location, orderPaths, selectedPaths, itemByPath, stateData, sortKey, sortDirection, view, allFavorites, menu };

  const openOne = useCallback(
    (item: ExplorerItem) => {
      if (item.kind === "folder" || item.kind === "drive") {
        goToFolder(item.path);
        return;
      }
      if (!isTauriRuntime()) return;
      openItem(item.path)
        .then((outcome) => {
          if (outcome.navigate_to) goToFolder(outcome.navigate_to);
        })
        .catch((error: unknown) => notifyError(error, "open"));
    },
    [goToFolder, notifyError],
  );

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
      setGroupBy: (groupBy) => onViewChange?.({ group_by: groupBy }),
      toggleView: (option: ViewToggle) => {
        const key = VIEW_SETTING[option];
        onViewChange?.({ [key]: !live.current.view[key] });
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
    }),
    [goToFolder, goToLocation, i18n, notify, notifyError, onViewChange, openOne, refresh, t],
  );

  const commands = useMemo(() => createExplorerCommands(actions), [actions]);
  const registry = useMemo(() => {
    const next = new CommandRegistry();
    for (const command of commands) next.register(command);
    return next;
  }, [commands]);
  const lookup = useCallback((id: string) => registry.get(id), [registry]);
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

  // Window-level shortcuts from the registry metadata, unless typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && (event.key === "a" || event.key === "A")) {
        // Select all files, never the page's own text.
        event.preventDefault();
        runById("explorer.selectAll");
      } else if (event.altKey && event.shiftKey && (event.key === "p" || event.key === "P")) {
        event.preventDefault();
        runById("explorer.toggleDetailsPane");
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        runById("explorer.back");
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        runById("explorer.forward");
      } else if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        runById("explorer.up");
      } else if (event.key === "F5" || ((event.ctrlKey || event.metaKey) && (event.key === "r" || event.key === "R"))) {
        event.preventDefault();
        runById("explorer.refresh");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runById]);

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
            : 0;
    onStatsChange?.({ total, selected: summary.count, selectedBytes: summary.bytes, selectedFiles: summary.files });
  }, [onStatsChange, visibleItems.length, homeItems.length, drives.length, location.type, summary]);

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
    [t],
  );

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

  const listProps = {
    selection,
    onSelectionChange: setSelection,
    sortKey,
    sortDirection,
    showExtensions: view.show_extensions,
    checkboxes: view.item_checkboxes,
    typeLabel,
    renamingPath,
    onStartRename: (item: ExplorerItem) => {
      if (commandById["explorer.rename"] && isCommandEnabled(commandById["explorer.rename"], commandCtxRef.current)) setRenamingPath(item.path);
    },
    onRenameCommit: commitRename,
    onRenameCancel: () => setRenamingPath(null),
    onOpen: openOne,
    onContextMenu: openContextMenu,
    onCommandKey: runById,
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
      folderContent = (
        <>
          {showSkeleton ? <Skeleton variant="rows" count={10} /> : null}
          {showSlow ? <p className="adp-note">{t("explorer.stillLoading")}</p> : null}
          {showTimedOut ? <p className="adp-note">{t("explorer.notAvailable")}</p> : null}
          {partialCount > 0 ? <p className="adp-note" role="status">{t("explorer.someItemsUnreadable")}</p> : null}
          {showEmpty ? <p className="adp-empty-note">{t("explorer.emptyFolder")}</p> : null}
          {showNoResults ? <p className="adp-empty-note">{t("explorer.noSearchResults")}</p> : null}
          {visibleItems.length > 0 ? (
            <FileList
              {...listProps}
              items={visibleItems}
              groups={groups}
              onSort={onSort}
              onFirstPaint={onFirstPaint}
              label={t("explorer.fileListLabel")}
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

  return (
    <div className="adp-explorer">
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
      />
      <CommandBar entries={COMMAND_BAR} ctx={commandCtx} lookup={lookup} onRun={runCommand} onOpenHelp={() => onOpenHelp("command-bar")} />
      <div className="adp-explorer-body">
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
        />
        <section
          className="adp-explorer-content"
          onContextMenu={(event) => {
            // The file list handles its own right-clicks; this covers empty
            // folders, loading states, and messages.
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (live.current.location.type !== "folder") return;
            setSelection((current) => clearSelection(current));
            openContextMenu({ x: event.clientX, y: event.clientY }, null);
          }}
        >
          {location.type === "home" ? (
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
          ) : null}

          {location.type === "drives" ? (
            <DriveList drives={drives} states={driveStates} onOpenDrive={goToFolder} />
          ) : null}

          {location.type === "gallery" ? <p className="adp-empty-note">{t("explorer.galleryPlaceholder")}</p> : null}
          {location.type === "network" ? <p className="adp-empty-note">{t("explorer.networkPlaceholder")}</p> : null}
          {folderContent}
        </section>
        {view.details_pane ? (
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
            onOpenHelp={() => onOpenHelp("details-pane")}
          />
        ) : null}
      </div>
      {menu ? (
        <Menu
          entries={resolveMenu(menu.kind === "item" ? ITEM_MENU : BACKGROUND_MENU, commandCtx, lookup)}
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
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((list) => list.filter((toast) => toast.id !== id))} />
    </div>
  );
}
