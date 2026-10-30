import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleHelp, Copy, Home, LayoutGrid, List, Minus, Plus, Settings as SettingsIcon, Square, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { tabKeyTarget } from "./services/tabKeys";
import DropdownMenu from "./components/DropdownMenu";
import { KeyTipsContext } from "./ribbon/keyTips";
import IconButton from "./components/IconButton";
import { applyLanguage } from "./i18n";
import {
  defaultSettings,
  isTauriRuntime,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "./services/settings";
import { formatSize } from "./services/format";
import { handlers } from "./handlers";
import { planOpen } from "./handlers/openPipeline";
import { openItem, parentPathOf } from "./services/explorer";
import {
  activateTab,
  closeTab as closeTabIn,
  initialTabs,
  mountedFileTabs,
  openFileTab,
  openSingleTab,
  sessionFromTabs,
  setTabView,
  tabsFromSession,
  type TabKind,
  type TabState,
  type TabsState,
} from "./services/tabs";
import { viewModeShortcut } from "./commands/explorerCommands";
import ExplorerHome, {
  type ExplorerNavigateRequest,
  type ExplorerStats,
  type ExplorerViewModeRequest,
} from "./views/ExplorerHome";
import FileTabView from "./views/FileTabView";
const GalleryView = lazy(() => import("./views/GalleryView"));
const HelpCenter = lazy(() => import("./views/HelpCenter"));
const SettingsView = lazy(() => import("./views/SettingsView"));

const SESSION_KEY = "adperastra-session";
const HELP_SLUGS: Record<TabKind, string> = {
  explorer: "browsing-folders",
  settings: "changing-language-and-theme",
  help: "using-help",
  gallery: "using-help",
  file: "opening-files",
};

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

export default function App() {
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
  const [tabsState, setTabsState] = useState<TabsState>(() => initialTabs());
  const { tabs, activeId } = tabsState;
  const [navigateRequest, setNavigateRequest] = useState<ExplorerNavigateRequest | null>(null);
  const [viewModeRequest, setViewModeRequest] = useState<ExplorerViewModeRequest | null>(null);
  const [helpSlug, setHelpSlug] = useState("getting-started");
  const [showKeyTips, setShowKeyTips] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const maximizeRef = useRef<HTMLButtonElement | null>(null);
  const [explorerStats, setExplorerStats] = useState<ExplorerStats>({ total: 0, selected: 0, selectedBytes: 0, selectedFiles: 0, viewMode: null });
  const readyRef = useRef(false);
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;

  const applyVisual = useCallback(async (next: AppSettings) => {
    const resolved =
      next.theme.mode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next.theme.mode;
    document.documentElement.dataset.theme = resolved;
    await applyLanguage(next.language);
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
    document.documentElement.style.setProperty("--adp-accent-current", accent);
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
  const onViewChange = useCallback(
    (patch: Partial<AppSettings["explorer"]>) =>
      applySettings({ ...settingsRef.current, explorer: { ...settingsRef.current.explorer, ...patch } }),
    [applySettings],
  );

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
      try {
        await invoke("save_session", { session: data });
      } catch {
        // Session persistence is best-effort.
      }
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
      let session: unknown = null;
      if (isTauriRuntime()) {
        try {
          session = await invoke("get_session");
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
    })();
    return () => {
      cancelled = true;
    };
  }, [applyVisual]);

  useEffect(() => {
    void persistSession();
  }, [tabs, activeId, persistSession]);

  useEffect(() => {
    const timer = window.setInterval(() => void persistSession(), 5000);
    return () => window.clearInterval(timer);
  }, [persistSession]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (settings.theme.mode === "system") void applyVisual(settings);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settings, applyVisual]);

  const openTab = useCallback((kind: "explorer" | "help" | "settings" | "gallery", slug?: string) => {
    if (kind === "help" && slug) setHelpSlug(slug);
    setTabsState((current) => (kind === "explorer" ? activateTab(current, "explorer") : openSingleTab(current, kind)));
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabsState((current) => closeTabIn(current, id));
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

  /** "Open as text" and "Open as hex" (Step 04c): a chosen viewer for a
   * file, whatever its type. The same file can have one tab per viewer. */
  const openFileWith = useCallback((path: string, handlerId: string) => {
    const title = path.split(/[\\/]/).pop() ?? path;
    setTabsState((current) => openFileTab(current, { path, handler: handlerId, title }, false));
  }, []);

  /** Switch to the Explorer tab and open a folder there, optionally
   * selecting one item in it. */
  const showInExplorer = useCallback((folder: string, select: string | null) => {
    setNavigateRequest((previous) => ({ folder, select, nonce: (previous?.nonce ?? 0) + 1 }));
    setTabsState((current) => activateTab(current, "explorer"));
  }, []);

  const mounted = useMemo(() => mountedFileTabs(tabsState), [tabsState]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setShowKeyTips(true);
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        const state = tabsRef.current;
        const tab = state.tabs.find((entry) => entry.id === state.activeId);
        const handler = tab?.kind === "file" && tab.handler ? handlers.get(tab.handler) : undefined;
        openTab("help", handler?.helpSlug ?? HELP_SLUGS[tab?.kind ?? "explorer"]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "w" || event.key === "W")) {
        event.preventDefault();
        if (tabsRef.current.activeId !== "explorer") closeTab(tabsRef.current.activeId);
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
  }, [closeTab, openTab]);

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
      if (action === "close") void win.close();
    } catch {
      // No Tauri window in a plain browser.
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const hasFileTabs = tabs.some((tab) => tab.kind === "file");
  const tabLabel = (tab: TabState): string => {
    if (tab.kind === "explorer") return t("tabs.explorer");
    if (tab.kind === "help") return t("help.title");
    if (tab.kind === "settings") return t("settings.title");
    if (tab.kind === "file") return tab.title ?? t("tabs.file");
    return t("gallery.title");
  };
  const TabIcon =
    activeTab.kind === "help"
      ? CircleHelp
      : activeTab.kind === "settings"
        ? SettingsIcon
        : activeTab.kind === "gallery"
          ? LayoutGrid
          : activeTab.kind === "file" && activeTab.handler
            ? (handlers.get(activeTab.handler)?.icon ?? LayoutGrid)
            : Home;

  return (
    <div className="adp-shell">
      <header className="adp-titlebar" data-tauri-drag-region="">
        <div className="adp-tabbar">
          <div className="adp-tablist" role="tablist">
          {tabs.map((tab, tabIndex) => {
            const handler = tab.kind === "file" && tab.handler ? handlers.get(tab.handler) : undefined;
            const Icon =
              tab.kind === "explorer"
                ? Home
                : tab.kind === "help"
                  ? CircleHelp
                  : tab.kind === "settings"
                    ? SettingsIcon
                    : tab.kind === "file"
                      ? (handler?.icon ?? LayoutGrid)
                      : LayoutGrid;
            const iconOnly = tab.kind === "explorer" && hasFileTabs;
            const classes = ["adp-tab", tab.id === activeId ? "adp-tab--active" : "", iconOnly ? "adp-tab--icon-only" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeId}
                aria-label={tabLabel(tab)}
                title={tab.kind === "file" ? tab.path : undefined}
                tabIndex={tab.id === activeId ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const target = tabKeyTarget(event.key, tabIndex, tabs.length);
                  if (target === null) return;
                  event.preventDefault();
                  const nextId = tabs[target].id;
                  setTabsState((current) => activateTab(current, nextId));
                  (event.currentTarget.parentElement?.children[target] as HTMLElement | undefined)?.focus();
                }}
                className={classes}
                draggable={false}
                onClick={() => setTabsState((current) => activateTab(current, tab.id))}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.id);
                }}
              >
                <Icon
                  size={14}
                  aria-hidden="true"
                  style={handler ? { color: `var(--adp-accent-${handler.accent})` } : undefined}
                />
                {iconOnly ? null : <span className="adp-tab-label">{tabLabel(tab)}</span>}
                {tab.kind !== "explorer" ? (
                  // A mouse target only: a tab may not contain another control.
                  // The keyboard closes the current tab with Ctrl+W.
                  <span
                    className="adp-tab-close"
                    aria-hidden="true"
                    title={t("tabs.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </span>
                ) : null}
              </div>
            );
          })}
          </div>
          <DropdownMenu
            ariaLabel={t("tabs.newTab")}
            icon={Plus}
            items={[
              { id: "help", label: t("help.title") },
              { id: "settings", label: t("settings.title") },
              { id: "gallery", label: t("gallery.title") },
            ]}
            onSelect={(id) => openTab(id as "help" | "settings" | "gallery")}
          />
        </div>
        <div className="adp-button-row">
          <IconButton
            icon={CircleHelp}
            labelKey="help.title"
            keyTip="H"
            showKeyTip={showKeyTips}
            onClick={() => {
              const handler = activeTab.kind === "file" && activeTab.handler ? handlers.get(activeTab.handler) : undefined;
              openTab("help", handler?.helpSlug ?? HELP_SLUGS[activeTab.kind]);
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

      <KeyTipsContext.Provider value={showKeyTips}>
      <main className="adp-main">
        {/* The Explorer stays mounted so it keeps its folder, selection and
            scroll position; it ignores shortcuts and drops while hidden. */}
        <div className="adp-tabpane" hidden={activeTab.kind !== "explorer"}>
          <ExplorerHome
            active={activeTab.kind === "explorer"}
            onStatsChange={setExplorerStats}
            onOpenHelp={(slug) => openTab("help", slug ?? "browsing-folders")}
            onOpenFile={openFile}
            onOpenFileWith={openFileWith}
            navigateRequest={navigateRequest}
            viewModeRequest={viewModeRequest}
            view={settings.explorer}
            onViewChange={onViewChange}
            pasteImageFormat={settings.files?.paste_image_format ?? "png"}
          />
        </div>
        {tabs
          .filter((tab) => tab.kind === "file" && mounted.has(tab.id))
          .map((tab) => (
            <FileTabView
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onShowInFolder={(path) => showInExplorer(parentPathOf(path) ?? path, path)}
              onOpenFolder={(folder) => showInExplorer(folder, null)}
              onClose={() => closeTab(tab.id)}
              onViewState={(view) => setTabsState((current) => setTabView(current, tab.id, view))}
              onOpenHelp={(slug) => openTab("help", slug)}
              protectedViewEnabled={settings.open.protected_view}
            />
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
            settings={settings}
            onApply={applySettings}
            onOpenHelp={() => openTab("help", "changing-language-and-theme")}
            onOpenHelpPage={(slug) => openTab("help", slug)}
          /></Suspense>
        ) : null}
        {activeTab.kind === "gallery" ? (
          <Suspense fallback={null}><GalleryView onOpenHelp={() => openTab("help", "using-help")} /></Suspense>
        ) : null}
      </main>
      </KeyTipsContext.Provider>

      <footer className="adp-statusbar" hidden={activeTab.kind === "file"}>
        {activeTab.kind === "explorer" ? (
          <>
            <span>{t("explorer.statusItems", { count: explorerStats.total })}</span>
            {explorerStats.selected > 0 ? (
              <>
                <span className="adp-status-divider" aria-hidden="true" />
                <span>
                  {t("explorer.statusSelected", { count: explorerStats.selected })}
                  {explorerStats.selectedFiles > 0 ? <span className="adp-status-size">{formatSize(explorerStats.selectedBytes, i18n.language)}</span> : null}
                </span>
              </>
            ) : null}
            {explorerStats.viewMode !== null ? (
              <span className="adp-status-views">
                <IconButton
                  icon={List}
                  labelKey="commands.viewDetails"
                  className="adp-status-view-btn"
                  pressed={explorerStats.viewMode === "details"}
                  shortcut={viewModeShortcut("details")}
                  onClick={() => setViewModeRequest({ mode: "details", nonce: (viewModeRequest?.nonce ?? 0) + 1 })}
                />
                {settings.explorer.hidden_view_modes.includes("largeIcons") ? null : (
                  <IconButton
                    icon={LayoutGrid}
                    labelKey="commands.viewLargeIcons"
                    className="adp-status-view-btn"
                    pressed={explorerStats.viewMode === "largeIcons"}
                    shortcut={viewModeShortcut("largeIcons")}
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
    </div>
  );
}
