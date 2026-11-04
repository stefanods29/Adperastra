import { BookOpen, ChevronLeft, ChevronRight, List, Moon, Sun, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import SafeMarkupFrame from "../../components/SafeMarkupFrame";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { errorCode, errorText } from "../../services/errors";
import { bookContents, type BookContentsItem } from "../../services/extraViews";
import { formatSize } from "../../services/format";
import { loadSettings, type ReadingSettings } from "../../services/settings";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { useExtraView } from "../extraView/useExtraView";

interface SavedBookState {
  section: number;
  page: number;
  font_px: number;
  theme: ReadingSettings["theme"];
  contents_open: boolean;
}

interface BookCtx {
  ready: boolean;
  page: number;
  pageCount: number;
  fontPx: number;
  theme: ReadingSettings["theme"];
  contentsOpen: boolean;
}

function readSaved(state: unknown): Partial<SavedBookState> {
  const value = (state ?? {}) as Partial<SavedBookState>;
  const next: Partial<SavedBookState> = {};
  if (typeof value.section === "number" && Number.isInteger(value.section) && value.section >= 0) {
    next.section = value.section;
  } else {
    next.section = 0;
  }
  if (typeof value.page === "number" && Number.isInteger(value.page) && value.page >= 0) {
    next.page = value.page;
  }
  if (typeof value.font_px === "number") {
    next.font_px = Math.min(32, Math.max(12, Math.round(value.font_px)));
  }
  if (value.theme === "app" || value.theme === "light" || value.theme === "dark") {
    next.theme = value.theme;
  }
  if (typeof value.contents_open === "boolean") next.contents_open = value.contents_open;
  return next;
}

function pageText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").slice(0, 65_536);
}

function countMatches(text: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = 0;
  while (count < 10_000) {
    const found = text.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + Math.max(1, needle.length);
  }
  return count;
}

export default function BookView({
  info,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenInWindowsApp,
  find,
  previewOnly,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const saved = useMemo(() => readSaved(savedState), [savedState]);
  const [fontPx, setFontPx] = useState(saved.font_px ?? 18);
  const [theme, setTheme] = useState<ReadingSettings["theme"]>(saved.theme ?? "app");
  const [contentsOpen, setContentsOpen] = useState(saved.contents_open ?? true);
  const [contents, setContents] = useState<BookContentsItem[]>([]);
  const [contentsCursor, setContentsCursor] = useState<string | null>(null);
  const [contentsComplete, setContentsComplete] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [matches, setMatches] = useState(0);
  const firstRequest = useRef({ section: saved.section ?? 0, page: saved.page ?? 0 });
  const view = useExtraView(info.path, "book", active, firstRequest.current);
  const payload = view.page?.payload;
  const page = payload && payload.kind === "book" ? payload.page : null;
  const lastFind = useRef({ request: 0, text: "" });
  const savedStateRef = useRef(JSON.stringify(saved));

  // The saved defaults are the settings' new schema-15 section; tab state
  // wins when the user already changed this book.
  useEffect(() => {
    if (saved.font_px !== undefined && saved.theme !== undefined) return;
    let cancelled = false;
    void loadSettings().then((settings) => {
      if (cancelled) return;
      if (saved.font_px === undefined) setFontPx(settings.reading.font_px);
      if (saved.theme === undefined) setTheme(settings.reading.theme);
    });
    return () => {
      cancelled = true;
    };
  }, [saved.font_px, saved.theme]);

  // The tab state follows page, font and theme so reopening returns here.
  useEffect(() => {
    const next: SavedBookState = {
      section: page?.section ?? firstRequest.current.section,
      page: page?.page ?? firstRequest.current.page,
      font_px: fontPx,
      theme,
      contents_open: contentsOpen,
    };
    const text = JSON.stringify(next);
    if (text !== savedStateRef.current) {
      savedStateRef.current = text;
      onStateChange(next);
    }
  }, [page?.section, page?.page, fontPx, theme, contentsOpen, onStateChange]);

  const loadContents = useCallback(
    async (cursor: string | null) => {
      if (!view.session) return;
      try {
        const reply = await bookContents(view.session.session_id, cursor);
        setContents((current) => (cursor === null ? reply.items : [...current, ...reply.items]));
        setContentsCursor(reply.next_cursor);
        setContentsComplete(reply.complete);
      } catch {
        setContentsComplete(true);
      }
    },
    [view.session],
  );

  useEffect(() => {
    if (view.phase !== "ready" || !view.session) return;
    void loadContents(null);
    // Only a newly opened session reloads the table of contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase, view.session?.session_id]);

  // Words appear only when waiting becomes noticeable.
  useEffect(() => {
    if (view.phase !== "loading") {
      setShowReading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReading(true), 1000);
    return () => window.clearTimeout(timer);
  }, [view.phase]);

  // Bounded find over the current page only; a book is never read whole.
  useEffect(() => {
    if (!page) return;
    const requestMoved = find.request !== lastFind.current.request;
    const textChanged = find.text !== lastFind.current.text;
    if (!requestMoved && !textChanged) return;
    lastFind.current = { request: find.request, text: find.text };
    setMatches(countMatches(pageText(page.html), find.text));
  }, [find.request, find.text, page]);

  const go = useCallback(
    async (section: number, target: number) => {
      if (!page) return;
      const bounded = Math.max(0, Math.min(target, page.page_count - 1));
      await view.request({ section, page: bounded });
    },
    [page, view],
  );

  const cycleTheme = () => {
    setTheme((current) => (current === "app" ? "light" : current === "light" ? "dark" : "app"));
  };

  useEffect(() => {
    const items: string[] = [];
    if (page) {
      items.push(t("extra_view.page", { page: page.page + 1, count: page.page_count }));
    }
    items.push(t("extra_view.theme"), t(`extra_view.theme${theme === "app" ? "App" : theme === "light" ? "Light" : "Dark"}`));
    if (find.text !== "") items.push(t("viewer.matches", { count: matches }));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [page, theme, find.text, matches, info.size, i18n.language, onStatus, t]);

  const ctx: BookCtx = {
    ready: page !== null,
    page: page?.page ?? 0,
    pageCount: page?.page_count ?? 0,
    fontPx,
    theme,
    contentsOpen,
  };
  const commands = useMemo<Command<BookCtx>[]>(
    () => [
      {
        id: "book.previous",
        labelKey: "extra_view.previous",
        icon: ChevronLeft,
        risk: "read-only",
        helpSlug: "reading-e-books",
        enabledWhen: (current) => current.ready && current.page > 0,
        run: () => void go(page?.section ?? 0, (page?.page ?? 0) - 1),
      },
      {
        id: "book.next",
        labelKey: "extra_view.next",
        icon: ChevronRight,
        risk: "read-only",
        helpSlug: "reading-e-books",
        enabledWhen: (current) => current.ready && current.page + 1 < current.pageCount,
        run: () => void go(page?.section ?? 0, (page?.page ?? 0) + 1),
      },
      {
        id: "book.contents",
        labelKey: "extra_view.contents",
        icon: List,
        risk: "read-only",
        helpSlug: "reading-e-books",
        checkKind: "toggle",
        checkedWhen: (current) => current.contentsOpen,
        enabledWhen: () => true,
        run: () => setContentsOpen((value) => !value),
      },
      {
        id: "book.fontSmaller",
        labelKey: "extra_view.fontSize",
        icon: Type,
        risk: "read-only",
        helpSlug: "reading-e-books",
        enabledWhen: (current) => current.fontPx > 12,
        run: () => setFontPx((value) => Math.max(12, value - 1)),
      },
      {
        id: "book.fontLarger",
        labelKey: "extra_view.fontSize",
        icon: Type,
        risk: "read-only",
        helpSlug: "reading-e-books",
        enabledWhen: (current) => current.fontPx < 32,
        run: () => setFontPx((value) => Math.min(32, value + 1)),
      },
      {
        id: "book.theme",
        labelKey: "extra_view.theme",
        icon: theme === "dark" ? Moon : Sun,
        risk: "read-only",
        helpSlug: "reading-e-books",
        enabledWhen: () => true,
        run: cycleTheme,
      },
      {
        id: "book.openInWindowsApp",
        labelKey: "fileTab.openInWindowsApp",
        icon: BookOpen,
        risk: "read-only",
        helpSlug: "opening-files",
        enabledWhen: () => true,
        run: () => onOpenInWindowsApp(),
      },
    ],
    // The callbacks read the current page through this closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, theme, go],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "page",
            labelKey: "handlers.book",
            controls: [
              { type: "button", command: "book.previous", keyTip: "P" },
              { type: "button", command: "book.next", keyTip: "N" },
              { type: "toggle", command: "book.contents", keyTip: "C" },
            ],
          },
          {
            id: "reading",
            labelKey: "extra_view.theme",
            controls: [
              { type: "button", command: "book.fontSmaller", showLabel: false, keyTip: "S" },
              { type: "button", command: "book.fontLarger", showLabel: false, keyTip: "L" },
              { type: "button", command: "book.theme", showLabel: false, keyTip: "T" },
            ],
          },
        ],
      },
    ],
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      if (page && page.page > 0) void go(page.section, page.page - 1);
    } else if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      if (page && page.page + 1 < page.page_count) void go(page.section, page.page + 1);
    }
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-book" tabIndex={0} onKeyDown={onKeyDown}>
        {view.phase === "loading" ? (
          <div className="adp-viewer-message" role="status">
            <Skeleton variant="rows" count={8} />
            {showReading ? (
              <>
                <p>{t("components.loading")}</p>
                <Button onClick={view.cancelOpen}>{t("common.cancel")}</Button>
              </>
            ) : null}
          </div>
        ) : null}
        {view.phase === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{errorText(t, view.error, "extra_view")}</p>
            <div className="adp-dialog-actions">
              <Button onClick={view.reload}>{t("common.retry")}</Button>
              {/* common.retry is added by the coordinator proposal. */}
              <Button variant="primary" onClick={onOpenInWindowsApp}>
                {t("fileTab.openInWindowsApp")}
              </Button>
            </div>
          </div>
        ) : null}
        {page ? (
          <div className={`adp-book-layout${contentsOpen ? " adp-book-layout--contents" : ""}`}>
            {contentsOpen ? (
              <aside className="adp-book-contents" aria-label={t("extra_view.contents")}>
                <h2>{t("extra_view.contents")}</h2>
                <ol>
                  {contents.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={page.section === item.section ? "adp-book-toc--current" : ""}
                        onClick={() => void view.request({ section: item.section, page: 0 })}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ol>
                {!contentsComplete ? (
                  <Button onClick={() => void loadContents(contentsCursor)}>{t("commands.more")}</Button>
                ) : null}
              </aside>
            ) : null}
            <div className="adp-book-main">
              <SafeMarkupFrame
                className="adp-book-frame"
                html={page.html}
                resources={page.resource_refs}
                title={info.name}
                fontPx={fontPx}
                readingTheme={theme}
                direction={page.direction}
              />
              {view.page?.partial ? (
                <p className="adp-viewer-note" role="note">
                  {t("extra_view.partial")}
                </p>
              ) : null}
              {previewOnly ? (
                <p className="adp-viewer-note" role="note">
                  {t("preview.readOnly")}
                </p>
              ) : null}
              <div className="adp-book-nav">
                <Button disabled={page.page === 0} onClick={() => void go(page.section, page.page - 1)}>
                  {t("extra_view.previous")}
                </Button>
                <span>{t("extra_view.page", { page: page.page + 1, count: page.page_count })}</span>
                <Button
                  disabled={page.page + 1 >= page.page_count}
                  onClick={() => void go(page.section, page.page + 1)}
                >
                  {t("extra_view.next")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ViewerFrame>
  );
}

/** Used by tests: the saved state never carries a path, bytes or token. */
export function readBookStateForTest(state: unknown): Partial<SavedBookState> {
  return readSaved(state);
}

/** The error area is translated under `errors.extra_view`; the helper above
 * is exported so a wrong area cannot silently show an unrelated message. */
export function bookErrorArea(error: unknown): "extra_view" | "unknown" {
  return errorCode(error).startsWith("extra_view.") ? "extra_view" : "unknown";
}
