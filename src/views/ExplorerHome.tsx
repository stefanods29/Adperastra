import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import { createExplorerCommands, type ExplorerActions } from "../commands/explorerCommands";
import type { Command, CommandContext } from "../commands/registry";
import {
  displayPath,
  driveInfo as fetchDriveInfo,
  explorerStateGet,
  startListDir,
  listDrives,
  listKnownFolders,
  listRecentItems,
  mergeRecentItems,
  parentPathOf,
  pathSegments,
  pinFolder,
  recordRecentFolder,
  samePath,
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
import { isTauriRuntime } from "../services/settings";
import {
  canGoBack,
  canGoForward,
  createHistory,
  goBack,
  goForward,
  locationKey,
  navigate,
  type ExplorerLocation,
  type NavHistory,
} from "../services/navigation";
import AddressBar from "./explorer/AddressBar";
import DriveList, { type DriveLoadState } from "./explorer/DriveList";
import FileList from "./explorer/FileList";
import HomePage from "./explorer/HomePage";
import NavPane from "./explorer/NavPane";

export interface ExplorerHomeProps {
  onStatsChange?: (total: number, selected: number) => void;
  onOpenHelp: (slug?: string) => void;
}

function normalizeState(state: ExplorerStateData): ExplorerStateData {
  return {
    ...state,
    pinned_folders: state.pinned_folders.map(displayPath),
    recent_folders: state.recent_folders.map(displayPath),
  };
}

function locationLabel(location: ExplorerLocation, homeLabel: string, drivesLabel: string): string {
  if (location.type === "folder") return location.path;
  if (location.type === "drives") return drivesLabel;
  if (location.type === "gallery") return "gallery";
  if (location.type === "network") return "network";
  return homeLabel;
}

export default function ExplorerHome({ onStatsChange, onOpenHelp }: ExplorerHomeProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<NavHistory>(() => createHistory({ type: "home" }));
  const location = history.current;
  const [knownFolders, setKnownFolders] = useState<KnownFolder[]>([]);
  const [stateData, setStateData] = useState<ExplorerStateData>({ schema_version: 1, pinned_folders: [], recent_folders: [] });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveStates, setDriveStates] = useState<Record<string, DriveLoadState>>({});
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [loading, setLoading] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [homeNonce, setHomeNonce] = useState(0);
  const generationRef = useRef(0);
  type CancelFn = Awaited<ReturnType<typeof startListDir>>["cancel"];
  const cancelRef = useRef<CancelFn | null>(null);
  const benchRef = useRef<{ generation: number; startedAt: number; done: boolean }>({ generation: 0, startedAt: 0, done: false });
  const selectedItem = items.find((item) => item.path === selectedPath) ?? null;

  const goToLocation = useCallback((next: ExplorerLocation) => {
    setSearch("");
    setSelectedPath(null);
    setItems([]);
    setHistory((current) => navigate(current, next));
  }, []);

  const goToFolder = useCallback((path: string) => goToLocation({ type: "folder", path: displayPath(path) }), [goToLocation]);

  const refresh = useCallback(() => {
    if (location.type === "folder") setRefreshNonce((value) => value + 1);
    else if (location.type === "home") setHomeNonce((value) => value + 1);
    else if (location.type === "drives") setRefreshNonce((value) => value + 1);
  }, [location.type]);

  const actions: ExplorerActions = useMemo(
    () => ({
      back: () => setHistory((current) => goBack(current)),
      forward: () => setHistory((current) => goForward(current)),
      up: () => {
        if (location.type !== "folder") return;
        const parent = parentPathOf(location.path);
        if (parent) goToFolder(parent);
        else goToLocation({ type: "drives" });
      },
      refresh,
      openSelected: () => {
        if (selectedItem?.kind === "folder") goToFolder(selectedItem.path);
      },
      goToPath: (path: string) => {
        const trimmed = path.trim();
        if (!trimmed) return;
        if (trimmed.toLowerCase() === "this pc" || trimmed === "this-pc") {
          goToLocation({ type: "drives" });
          return;
        }
        goToFolder(trimmed);
      },
      togglePin: () => {
        if (location.type !== "folder") return;
        const path = location.path;
        const pinned = stateData.pinned_folders.some((p) => samePath(p, path));
        void (async () => {
          try {
            const next = pinned ? await unpinFolder(path) : await pinFolder(path);
            setStateData(normalizeState(next));
          } catch {
            // Pinning is best-effort in the UI; state stays unchanged.
          }
        })();
      },
    }),
    [goToFolder, goToLocation, location, refresh, selectedItem, stateData.pinned_folders],
  );

  const commands = useMemo(() => createExplorerCommands(actions), [actions]);
  const commandById = useMemo(() => Object.fromEntries(commands.map((c) => [c.id, c])), [commands]);
  const runCommand = useCallback(
    (command: Command, arg?: string) => command.run(commandCtxRef.current, arg),
    [],
  );

  const currentPinned = location.type === "folder" && stateData.pinned_folders.some((p) => samePath(p, location.path));
  const commandCtx: CommandContext = {
    location: location.type,
    currentPath: location.type === "folder" ? location.path : null,
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    selectedPath,
    selectedKind: selectedItem ? (selectedItem.kind === "drive" ? "other" : selectedItem.kind) : null,
    currentPinned,
  };
  const commandCtxRef = useRef(commandCtx);
  commandCtxRef.current = commandCtx;

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
    setLoading(true);
    setSlowLoad(false);
    setLoadTimedOut(false);
    setLoadError(false);
    const slowTimer = window.setTimeout(() => {
      if (generationRef.current === generation) setSlowLoad(true);
    }, 1000);
    const timeoutTimer = window.setTimeout(() => {
      if (generationRef.current === generation) setLoadTimedOut(true);
    }, 15000);
    let receivedFirst = false;
    let cancelled = false;
    let watchRefreshTimer = 0;
    let watchUnlisten: (() => void) | null = null;

    void (async () => {
      try {
        const handle = await startListDir(path, { key: sortKey, direction: sortDirection }, (batch) => {
          if (generationRef.current !== generation || cancelled) return;
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
        setItems((current) => (receivedFirst ? current : []));
        setLoading(false);
        setSlowLoad(false);
        setLoadTimedOut(false);
        void outcome;
        void recordRecentFolder(path)
          .then((next) => setStateData(normalizeState(next)))
          .catch(() => undefined);
        watchUnlisten = await watchStart(path, () => {
          if (generationRef.current !== generation || cancelled) return;
          window.clearTimeout(watchRefreshTimer);
          watchRefreshTimer = window.setTimeout(() => {
            if (generationRef.current === generation && !cancelled) setRefreshNonce((value) => value + 1);
          }, 300);
        }).catch(() => null);
      } catch {
        if (generationRef.current !== generation || cancelled) return;
        setLoading(false);
        setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(watchRefreshTimer);
      if (cancelRef.current) void cancelRef.current();
      if (watchUnlisten) watchUnlisten();
      void watchStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.type === "folder" ? location.path : null, sortKey, sortDirection, refreshNonce]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [items, search]);

  const recentMerged = useMemo(
    () => mergeRecentItems(recent, stateData.recent_folders),
    [recent, stateData.recent_folders],
  );

  useEffect(() => {
    const total =
      location.type === "folder"
        ? visibleItems.length
        : location.type === "home"
          ? recentMerged.length
          : location.type === "drives"
            ? drives.length
            : 0;
    onStatsChange?.(total, location.type === "folder" && selectedPath ? 1 : 0);
  }, [onStatsChange, visibleItems.length, selectedPath, location.type, recentMerged.length, drives.length]);

  const onFirstPaint = useCallback(() => {
    const bench = benchRef.current;
    if (bench.done) return;
    bench.done = true;
    const elapsed = performance.now() - bench.startedAt;
    (window as unknown as Record<string, unknown>).__adperastraLastFolderOpenMs = elapsed;
    document.querySelector(".adp-explorer")?.setAttribute("data-last-folder-open-ms", String(Math.round(elapsed)));
  }, []);

  const onSort = (key: SortKey) => {
    setItems([]);
    if (key === sortKey) {
      setSortDirection((value) => (value === "ascending" ? "descending" : "ascending"));
    } else {
      setSortKey(key);
      setSortDirection("ascending");
    }
  };

  const segments =
    location.type === "folder"
      ? pathSegments(location.path)
      : [{ label: location.type === "drives" ? t("explorer.nav.thisPc") : location.type === "home" ? t("explorer.nav.home") : t(`explorer.nav.${location.type}`), path: location.type }];
  const placeLabel =
    location.type === "folder"
      ? (segments[segments.length - 1]?.label ?? location.path)
      : segments[0].label;
  const historyEntries = history.back
    .map((entry, index) => ({ label: locationLabel(entry, t("explorer.nav.home"), t("explorer.nav.thisPc")), distance: history.back.length - index }))
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

  let folderContent = null;
  if (location.type === "folder") {
    if (!isTauriRuntime()) {
      folderContent = <p className="adp-empty-note">{t("explorer.browserPreview")}</p>;
    } else if (loadError) {
      folderContent = <p className="adp-empty-note">{t("explorer.loadError")}</p>;
    } else {
      const showSkeleton = loading && items.length === 0;
      const showSlow = slowLoad && loading;
      const showTimedOut = loadTimedOut && loading;
      const showEmpty = !loading && items.length === 0;
      const showNoResults = !loading && items.length > 0 && visibleItems.length === 0;
      folderContent = (
        <>
          {showSkeleton ? <Skeleton variant="rows" count={10} /> : null}
          {showSlow ? <p className="adp-note">{t("explorer.stillLoading")}</p> : null}
          {showTimedOut ? <p className="adp-note">{t("explorer.notAvailable")}</p> : null}
          {showEmpty ? <p className="adp-empty-note">{t("explorer.emptyFolder")}</p> : null}
          {showNoResults ? <p className="adp-empty-note">{t("explorer.noSearchResults")}</p> : null}
          {visibleItems.length > 0 ? (
            <FileList
              items={visibleItems}
              selectedPath={selectedPath}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={onSort}
              onSelect={(item) => setSelectedPath(item.path)}
              onOpen={(item) => {
                if (item.kind === "folder") goToFolder(item.path);
              }}
              onFirstPaint={onFirstPaint}
            />
          ) : null}
        </>
      );
    }
  }

  return (
    <div className="adp-explorer">
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
      <section className="adp-explorer-content">
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

        {location.type === "folder" ? (
          <div className="adp-folder-toolbar">
            <button
              type="button"
              className="adp-btn adp-btn--subtle"
              disabled={!commandById["explorer.togglePin"].enabledWhen(commandCtx)}
              onClick={() => runCommand(commandById["explorer.togglePin"])}
            >
              {currentPinned ? t("commands.unpinFolder") : t("commands.pinFolder")}
            </button>
            <HelpButton onOpenHelp={() => onOpenHelp("browsing-folders")} />
          </div>
        ) : null}

        {location.type === "home" ? (
          <HomePage
            knownFolders={knownFolders}
            pinnedCards={pinnedCards}
            recent={recentMerged}
            onOpenFolder={goToFolder}
            onOpenRecent={(item) => {
              if (item.kind === "folder") goToFolder(item.path);
            }}
            onOpenHelp={() => onOpenHelp("home-page")}
          />
        ) : null}

        {location.type === "drives" ? (
          <DriveList drives={drives} states={driveStates} onOpenDrive={goToFolder} />
        ) : null}

        {location.type === "gallery" ? <p className="adp-empty-note">{t("explorer.galleryPlaceholder")}</p> : null}
        {location.type === "network" ? <p className="adp-empty-note">{t("explorer.networkPlaceholder")}</p> : null}
        {folderContent}
      </section>
    </div>
  );
}