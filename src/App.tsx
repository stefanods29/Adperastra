import type { ConversionOpenRequest } from "./convert/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleHelp, Copy, Home, LayoutGrid, List, Minus, Settings as SettingsIcon, Square, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyAppearanceAttributes, applyThemeAttributes } from "./appearance/applyAppearance";
import { AppearanceContext } from "./appearance/density";
import { setUiZoom } from "./services/appearance";
import { LayoutContext } from "./layout/LayoutContext";
import TabStrip from "./layout/TabStrip";
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
  setTabPath,
  setTabView,
  tabsFromSession,
  type TabKind,
  type TabState,
  type TabsState,
} from "./services/tabs";
import { viewModeShortcut } from "./commands/explorerCommands";
import type { ArchiveExtractRequest } from "./services/archive";
import ExplorerHome, {
  type ExplorerNavigateRequest,
  type ExplorerStats,
  type ExplorerViewModeRequest,
} from "./views/ExplorerHome";
import type { ExplorerExtractRequest } from "./views/explorer/useArchiveExtract";
import FileTabView from "./views/FileTabView";
import { useUnsavedChanges } from "./views/useUnsavedChanges";
const GalleryView = lazy(() => import("./views/GalleryView"));
const HelpCenter = lazy(() => import("./views/HelpCenter"));
const SettingsView = lazy(() => import("./views/SettingsView"));

const SESSION_KEY = "adperastra-session";
const HELP_SLUGS: Record<TabKind, string> = {
  explorer: "browsing-folders",
  settings: "the-settings-page",
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
  const [conversionRequest, setConversionRequest] = useState<ConversionOpenRequest | null>(null);
  const [extractRequest, setExtractRequest] = useState<ExplorerExtractRequest | null>(null);
  const [helpSlug, setHelpSlug] = useState("getting-started");
  const [showKeyTips, setShowKeyTips] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const maximizeRef = useRef<HTMLButtonElement | null>(null);
  const [explorerStats, setExplorerStats] = useState<ExplorerStats>({ total: 0, selected: 0, selectedBytes: 0, selectedFiles: 0, viewMode: null, helpSlug: "browsing-folders" });
  const readyRef = useRef(false);
  const tabsRef = useRef(tabsState);
  tabsRef.current = tabsState;
  // Unsaved changes in file tabs (Step 06a): the dots and the close questions.
  const unsaved = useUnsavedChanges(tabs);

  const applyVisual = useCallback(async (next: AppSettings) => {
    applyThemeAttributes(
      document.documentElement,
      next.theme,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    applyAppearanceAttributes(document.documentElement, next.appearance);
    void setUiZoom(next.appearance.ui_scale).catch(() => undefined);
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
  const layoutValue = useMemo(() => ({ layout: settings.layout, onLayoutChange }), [settings.layout, onLayoutChange]);

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
    void unsaved.confirmClose([id]).then((proceed) => {
      if (proceed) setTabsState((current) => closeTabIn(current, id));
    });
  }, [unsaved.confirmClose]);

  /** The title bar's close button and Windows' close request ask once for
   * every file tab with unsaved changes (Step 06a). */
  const closeWindow = useCallback(async () => {
    const ids = tabsRef.current.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.id);
    const proceed = await unsaved.confirmClose(ids);
    if (!proceed || !isTauriRuntime()) return;
    try {
      await getCurrentWindow().destroy();
    } catch {
      // No Tauri window in a plain browser.
    }
  }, [unsaved.confirmClose]);
  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeWindowRef.current();
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

  /** An archive tab asked for an extraction (Step 06d): show the folder in
   * the Explorer, then let it run the job and select what it made. */
  const extractArchive = useCallback(
    (request: ArchiveExtractRequest) => {
      showInExplorer(request.dest_dir, null);
      setExtractRequest((previous) => ({ request, nonce: (previous?.nonce ?? 0) + 1 }));
    },
    [showInExplorer],
  );

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
        const helpSlug =
          tab?.kind === "file"
            ? handler?.helpSlug
            : tab?.kind === "explorer"
              ? explorerStats.helpSlug
              : HELP_SLUGS[tab?.kind ?? "explorer"];
        openTab("help", helpSlug);
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
  }, [closeTab, openTab, explorerStats.helpSlug]);

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
  const tabLabel = (tab: TabState): string => {
    if (tab.kind === "explorer") return t("tabs.explorer");
    if (tab.kind === "help") return t("help.title");
    if (tab.kind === "settings") return t("settings.title");
    if (tab.kind === "file") return tab.title ?? t("tabs.file");
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
          : activeTab.kind === "file" && activeTab.handler
            ? (handlers.get(activeTab.handler)?.icon ?? LayoutGrid)
            : Home;

  return (
    <AppearanceContext.Provider value={settings.appearance.density}>
    <LayoutContext.Provider value={layoutValue}>
    <div className="adp-shell">
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
            onNewTab={openTab}
            onToggleCollapsed={() =>
              onLayoutChange({ ...settings.layout, tab_bar_collapsed: !settings.layout.tab_bar_collapsed })
            }
            dirtyIds={unsaved.dirtyIds}
          />
        ) : (
          <span className="adp-titlebar-title" data-tauri-drag-region="">
            {tabLabel(activeTab)}
          </span>
        )}
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
            onNewTab={openTab}
            onToggleCollapsed={() =>
              onLayoutChange({ ...settings.layout, tab_bar_collapsed: !settings.layout.tab_bar_collapsed })
            }
            dirtyIds={unsaved.dirtyIds}
          />
        )}
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
            extractRequest={extractRequest}
            conversionRequest={conversionRequest}
            view={settings.explorer}
            onViewChange={onViewChange}
            pasteImageFormat={settings.files?.paste_image_format ?? "png"}
            templatesFolder={settings.templates?.my_folder ?? ""}
            onTemplatesFolderChange={onTemplatesFolderChange}
            versionsEnabled={settings.versions.enabled}
            gallery={settings.gallery}
            onGallerySettingsChange={onGallerySettingsChange}
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
              isDirty={unsaved.dirtyIds.has(tab.id)}
              onDirtyChange={(dirty) => unsaved.onDirtyChange(tab.id, dirty)}
              registerSave={(handle) => unsaved.registerSave(tab.id, handle)}
              onPathChange={(newPath) =>
                setTabsState((current) =>
                  setTabPath(current, tab.id, newPath, newPath.split(/[\\/]/).pop() ?? tab.title ?? ""),
                )
              }
              onConfirmDiscard={() => unsaved.confirmClose([tab.id])}
              ocrLanguage={settings.ocr.language}
              onOpenFile={(path) => openFile(path, false)}
              onExtractArchive={extractArchive}
              onConvert={(request) => {
                setConversionRequest((previous) => ({ ...request, nonce: (previous?.nonce ?? 0) + 1 }));
                setTabsState((current) => activateTab(current, "explorer"));
              }}
              onOpenAsText={() => openFileWith(tab.path ?? "", "text")}
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
            active={activeTab.kind === "settings"}
            settings={settings}
            onApply={applySettings}
            onOpenHelp={() => openTab("help", "the-settings-page")}
            onOpenHelpPage={(slug) => openTab("help", slug)}
          /></Suspense>
        ) : null}
        {activeTab.kind === "gallery" ? (
          <Suspense fallback={null}><GalleryView onOpenHelp={() => openTab("help", "using-help")} /></Suspense>
        ) : null}
      </main>
      </KeyTipsContext.Provider>
      </div>

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
      {unsaved.dialog}
    </div>
    </LayoutContext.Provider>
    </AppearanceContext.Provider>
  );
}
