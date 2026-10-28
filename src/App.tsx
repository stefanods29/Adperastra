import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleHelp, Copy, Home, LayoutGrid, Minus, Plus, Settings as SettingsIcon, Square, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DropdownMenu from "./components/DropdownMenu";
import IconButton from "./components/IconButton";
import { applyLanguage } from "./i18n";
import {
  defaultSettings,
  isTauriRuntime,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "./services/settings";
import ExplorerHome from "./views/ExplorerHome";
const GalleryView = lazy(() => import("./views/GalleryView"));
const HelpCenter = lazy(() => import("./views/HelpCenter"));
const SettingsView = lazy(() => import("./views/SettingsView"));

type TabKind = "explorer" | "help" | "settings" | "gallery";
interface TabState {
  id: string;
  kind: TabKind;
  title?: string;
}
interface SessionData {
  tabs: TabState[];
  active_tab: string;
  saved_unix: number;
}

const EXPLORER_TAB: TabState = { id: "explorer", kind: "explorer" };
const SESSION_KEY = "adperastra-session";
const TAB_KINDS: TabKind[] = ["explorer", "help", "settings", "gallery"];
const HELP_SLUGS: Record<TabKind, string> = {
  explorer: "browsing-folders",
  settings: "changing-language-and-theme",
  help: "using-help",
  gallery: "using-help",
};

function normalizeTabs(input: unknown): TabState[] {
  const raw =
    input !== null && typeof input === "object" && Array.isArray((input as SessionData).tabs)
      ? ((input as SessionData).tabs as unknown[])
      : [];
  const seen = new Set<string>();
  const tabs: TabState[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as TabState;
    if (!TAB_KINDS.includes(candidate.kind) || typeof candidate.id !== "string") continue;
    if (candidate.kind === "explorer" || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    tabs.push({
      id: candidate.id,
      kind: candidate.kind,
      title: typeof candidate.title === "string" ? candidate.title : undefined,
    });
  }
  return [EXPLORER_TAB, ...tabs];
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

export default function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
  const [tabs, setTabs] = useState([EXPLORER_TAB]);
  const [activeId, setActiveId] = useState("explorer");
  const [helpSlug, setHelpSlug] = useState("getting-started");
  const [showKeyTips, setShowKeyTips] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const maximizeRef = useRef<HTMLButtonElement | null>(null);
  const [explorerTotal, setExplorerTotal] = useState(0);
  const [explorerSelected, setExplorerSelected] = useState(0);
  const readyRef = useRef(false);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(activeId);
  tabsRef.current = tabs;
  activeRef.current = activeId;

  const applyVisual = useCallback(async (next: AppSettings) => {
    const resolved =
      next.theme.mode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next.theme.mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.lang = next.language;
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

  const persistSession = useCallback(async () => {
    if (!readyRef.current) return;
    const data: SessionData = {
      tabs: tabsRef.current.map((tab) => ({ id: tab.id, kind: tab.kind, title: tab.title })),
      active_tab: activeRef.current,
      saved_unix: Math.floor(Date.now() / 1000),
    };
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
      const restored = normalizeTabs(session);
      const storedActive =
        session !== null && typeof session === "object"
          ? (session as SessionData).active_tab
          : undefined;
      setTabs(restored);
      setActiveId(
        typeof storedActive === "string" && restored.some((tab) => tab.id === storedActive)
          ? storedActive
          : "explorer",
      );
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

  const openTab = useCallback(
    (kind: TabKind, slug?: string) => {
      if (kind === "help" && slug) setHelpSlug(slug);
      if (kind === "explorer") {
        setActiveId("explorer");
        return;
      }
      const existing = tabsRef.current.find((tab) => tab.kind === kind);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const id = `${kind}-${Date.now()}`;
      setTabs((current) => [...current, { id, kind }]);
      setActiveId(id);
    },
    [],
  );

  const closeTab = useCallback((id: string) => {
    if (id === "explorer") return;
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      if (index === -1) return current;
      const next = current.filter((tab) => tab.id !== id);
      if (activeRef.current === id) {
        const fallback = next[Math.max(0, index - 1)] ?? EXPLORER_TAB;
        setActiveId(fallback.id);
      }
      return next;
    });
  }, []);

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
        const kind = tabsRef.current.find((tab) => tab.id === activeRef.current)?.kind ?? "explorer";
        openTab("help", HELP_SLUGS[kind]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "w" || event.key === "W")) {
        event.preventDefault();
        if (activeRef.current !== "explorer") closeTab(activeRef.current);
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

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? EXPLORER_TAB;
  const tabLabel = (tab: TabState): string => {
    if (tab.kind === "explorer") return t("tabs.explorer");
    if (tab.kind === "help") return t("help.title");
    if (tab.kind === "settings") return t("settings.title");
    return t("gallery.title");
  };
  const TabIcon =
    activeTab.kind === "help"
      ? CircleHelp
      : activeTab.kind === "settings"
        ? SettingsIcon
        : activeTab.kind === "gallery"
          ? LayoutGrid
          : Home;

  return (
    <div className="adp-shell">
      <header className="adp-titlebar" data-tauri-drag-region="">
        <div className="adp-tabbar" role="tablist">
          {tabs.map((tab) => {
            const Icon =
              tab.kind === "explorer"
                ? Home
                : tab.kind === "help"
                  ? CircleHelp
                  : tab.kind === "settings"
                    ? SettingsIcon
                    : LayoutGrid;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeId}
                className={tab.id === activeId ? "adp-tab adp-tab--active" : "adp-tab"}
                draggable={false}
                onClick={() => setActiveId(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.id);
                }}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="adp-tab-label">{tab.title ?? tabLabel(tab)}</span>
                {tab.kind !== "explorer" ? (
                  <button
                    type="button"
                    className="adp-tab-close"
                    aria-label={t("tabs.close")}
                    title={t("tabs.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
          <DropdownMenu
            ariaLabel={t("tabs.newTab")}
            icon={Plus}
            items={[
              { id: "help", label: t("help.title") },
              { id: "settings", label: t("settings.title") },
              { id: "gallery", label: t("gallery.title") },
            ]}
            onSelect={(id) => openTab(id as TabKind)}
          />
        </div>
        <div className="adp-button-row">
          <IconButton
            icon={CircleHelp}
            labelKey="help.title"
            keyTip="H"
            showKeyTip={showKeyTips}
            onClick={() => openTab("help", HELP_SLUGS[activeTab.kind])}
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

      <main className="adp-main">
        {activeTab.kind === "explorer" ? (
          <ExplorerHome
            onStatsChange={(total, selected) => {
              setExplorerTotal(total);
              setExplorerSelected(selected);
            }}
            onOpenHelp={(slug) => openTab("help", slug ?? "browsing-folders")}
          />
        ) : null}
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
          /></Suspense>
        ) : null}
        {activeTab.kind === "gallery" ? (
          <Suspense fallback={null}><GalleryView onOpenHelp={() => openTab("help", "using-help")} /></Suspense>
        ) : null}
      </main>

      <footer className="adp-statusbar">
        {activeTab.kind === "explorer" ? (
          <>
            <span>{t("explorer.statusItems", { count: explorerTotal })}</span>
            <span>{t("explorer.statusSelected", { count: explorerSelected })}</span>
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
