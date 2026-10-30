import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BookOpen, Code, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import { isExternalUrl, openExternalUrl } from "../../services/links";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { lineNumbers, readOnlyExtensions, runFind } from "../text/editorSetup";
import { decodeText, detectEncoding } from "../text/encoding";
import { loadLanguage } from "../text/languages";
import type { HandlerViewProps } from "../types";
import { findInPage, renderMarkdownPage, type DocColors } from "./render";

interface SavedMarkdownState {
  mode: "rendered" | "source";
  zoom: number;
}

interface MarkdownCtx {
  mode: "rendered" | "source";
  zoom: number;
}

function readSaved(state: unknown): SavedMarkdownState {
  const value = (state ?? {}) as Partial<SavedMarkdownState>;
  return {
    mode: value.mode === "source" ? "source" : "rendered",
    zoom: typeof value.zoom === "number" ? Math.min(3, Math.max(0.5, value.zoom)) : 1,
  };
}

/** The page colors come from the app's current theme. */
function themeColors(): DocColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name);
  return {
    text: read("--adp-color-text-primary"),
    muted: read("--adp-color-text-secondary"),
    background: read("--adp-color-surface-window"),
    border: read("--adp-color-border-subtle"),
    link: read("--adp-accent-explorer"),
    codeBackground: read("--adp-color-surface-pane"),
    mark: read("--adp-syntax-match"),
    markCurrent: read("--adp-syntax-match-selected"),
  };
}

/** Markdown viewer (Step 04b): the rendered page in a frame that cannot
 * run scripts, or the source in CodeMirror. Links ask before opening in
 * the browser. */
export default function MarkdownView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp, find }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<SavedMarkdownState>(() => readSaved(savedState));
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [colors, setColors] = useState<DocColors>(() => themeColors());
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [matches, setMatches] = useState(0);
  const [frameLoads, setFrameLoads] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceHost = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const matchIndex = useRef(0);
  /** Reading position (0 to 1), kept when the page is rebuilt (zoom, theme). */
  const scrollRatio = useRef(0);

  const update = useCallback(
    (patch: Partial<SavedMarkdownState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("files.read_failed"))))
      .then((buffer) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        setSource(decodeText(bytes, detectEncoding(bytes.subarray(0, 65536)).encoding));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Follow theme changes (the page's colors are fixed when it is built).
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(themeColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  const page = useMemo(
    () => (source === null ? "" : renderMarkdownPage(source, colors, settings.zoom, i18n.language)),
    [source, colors, settings.zoom, i18n.language],
  );

  // The page frame shares our origin but cannot run scripts. We pass its
  // shortcut keys to the app and turn its link clicks into a question.
  const attachFrame = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const scroller = doc.scrollingElement;
    if (scroller) scroller.scrollTop = scrollRatio.current * scroller.scrollHeight;
    doc.addEventListener("scroll", () => {
      const element = doc.scrollingElement;
      if (element) scrollRatio.current = element.scrollTop / Math.max(1, element.scrollHeight);
    });
    doc.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.altKey || event.metaKey || /^F\d+$/.test(event.key))) return;
      const forwarded = new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) event.preventDefault();
    });
    doc.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href") ?? "";
      if (isExternalUrl(href)) setPendingLink(href);
    });
    // A new page is ready: run the search again on it.
    setFrameLoads((count) => count + 1);
  }, []);

  // Source mode: a read-only CodeMirror with Markdown colors.
  useEffect(() => {
    if (settings.mode !== "source" || source === null || !sourceHost.current) return;
    const view = new EditorView({
      parent: sourceHost.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          readOnlyExtensions({ phrases: { "current match": t("text.cm.currentMatch"), "on line": t("text.cm.onLine") } }),
          lineNumbers(),
          EditorView.lineWrapping,
        ],
      }),
    });
    editorRef.current = view;
    void loadLanguage("markdown").then((language) => {
      if (editorRef.current === view) view.dispatch({ effects: StateEffect.appendConfig.of(language) });
    });
    return () => {
      view.destroy();
      if (editorRef.current === view) editorRef.current = null;
    };
    // The editor is rebuilt when the mode or the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, source]);

  // The file tab's search box, in both modes. A new search text starts at
  // the first match; Enter and F3 move; a rebuilt page keeps the match.
  const lastFind = useRef({ request: find.request, text: find.text });
  useEffect(() => {
    const moved = find.request !== lastFind.current.request;
    const retyped = find.text !== lastFind.current.text;
    lastFind.current = { request: find.request, text: find.text };
    if (settings.mode === "source") {
      if (editorRef.current) runFind(editorRef.current, find.text, moved ? (find.backwards ? "previous" : "next") : "here");
      return;
    }
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    if (moved) matchIndex.current += find.backwards ? -1 : 1;
    else if (retyped) matchIndex.current = 0;
    setMatches(findInPage(doc, find.text, matchIndex.current).count);
  }, [find.text, find.request, find.backwards, settings.mode, frameLoads]);

  useEffect(() => {
    const items = [t(settings.mode === "rendered" ? "markdown.renderedMode" : "markdown.sourceMode"), formatSize(info.size, i18n.language)];
    if (find.text !== "" && settings.mode === "rendered") items.unshift(t("viewer.matches", { count: matches }));
    onStatus({ items });
  }, [settings.mode, info.size, i18n.language, find.text, matches, onStatus, t]);

  const ctx: MarkdownCtx = { mode: settings.mode, zoom: settings.zoom };
  const commands = useMemo<Command<MarkdownCtx>[]>(
    () => [
      { id: "markdown.rendered", labelKey: "markdown.renderedMode", icon: BookOpen, risk: "read-only", helpSlug: "viewing-markdown", checkKind: "radio", checkedWhen: (c) => c.mode === "rendered", enabledWhen: () => true, run: () => update({ mode: "rendered" }) },
      { id: "markdown.source", labelKey: "markdown.sourceMode", icon: Code, risk: "read-only", helpSlug: "viewing-markdown", checkKind: "radio", checkedWhen: (c) => c.mode === "source", enabledWhen: () => true, run: () => update({ mode: "source" }) },
      { id: "markdown.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom < 3, run: (c) => update({ zoom: Math.min(3, Math.round(c.zoom * 11) / 10) }) },
      { id: "markdown.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom > 0.5, run: (c) => update({ zoom: Math.max(0.5, Math.round((c.zoom / 1.1) * 10) / 10) }) },
      { id: "markdown.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom !== 1, run: () => update({ zoom: 1 }) },
    ],
    [update],
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
            id: "mode",
            labelKey: "ribbon.show",
            controls: [
              { type: "toggle", command: "markdown.rendered", keyTip: "D" },
              { type: "toggle", command: "markdown.source", keyTip: "C" },
            ],
          },
          {
            id: "zoom",
            labelKey: "ribbon.zoom",
            controls: [
              { type: "button", command: "markdown.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "markdown.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "markdown.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("text.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : null}
      {!failed && settings.mode === "rendered" ? (
        <iframe ref={frameRef} className="adp-markdown-frame" sandbox="allow-same-origin" srcDoc={page} title={info.name} onLoad={attachFrame} />
      ) : null}
      {!failed && settings.mode === "source" ? <div ref={sourceHost} className="adp-text-host" /> : null}
      {pendingLink ? (
        <Dialog title={t("links.openTitle")} onClose={() => setPendingLink(null)}>
          <p className="adp-dialog-text">{t("links.openBody")}</p>
          <p className="adp-dialog-text adp-link-preview">{pendingLink}</p>
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              onClick={() => {
                const link = pendingLink;
                setPendingLink(null);
                void openExternalUrl(link).catch(() => undefined);
              }}
            >
              {t("links.open")}
            </Button>
            <Button onClick={() => setPendingLink(null)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </ViewerFrame>
  );
}
