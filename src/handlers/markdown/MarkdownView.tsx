import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BookOpen, Code, Columns2, History, Redo2, Save, SaveAll, Scan, SpellCheck, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { Command } from "../../commands/registry";
import { SAVE_ENCODING_LABELS, SAVE_ENCODINGS, spellcheckDefault, type SaveEncodingId } from "../../editor/saveEncoding";
import { useTextDocument } from "../../editor/useTextDocument";
import { showProperties } from "../../services/explorer";
import { formatDate, formatSize } from "../../services/format";
import { isExternalUrl, openExternalUrl } from "../../services/links";
import { isTauriRuntime } from "../../services/settings";
import VersionHistoryDialog from "../../versions/VersionHistoryDialog";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { lineNumbers, runFind, runReplace } from "../text/editorSetup";
import { ENCODING_LABELS, ENCODINGS, type EncodingName } from "../text/encoding";
import { loadLanguage } from "../text/languages";
import type { HandlerViewProps } from "../types";
import { findInPage, renderMarkdownPage, type DocColors } from "./render";

/** How long after typing the page follows the source. */
export const PREVIEW_DELAY_MS = 300;

interface SavedMarkdownState {
  mode: "rendered" | "source" | "split";
  zoom: number;
  spellcheck: boolean;
}

interface MarkdownCtx {
  mode: "rendered" | "source" | "split";
  zoom: number;
  ready: boolean;
  editable: boolean;
  dirty: boolean;
  canSaveAs: boolean;
  canUndo: boolean;
  canRedo: boolean;
  spellcheck: boolean;
}

function readSaved(state: unknown, ext: string): SavedMarkdownState {
  const value = (state ?? {}) as Partial<SavedMarkdownState>;
  return {
    mode: value.mode === "source" ? "source" : value.mode === "split" ? "split" : "rendered",
    zoom: typeof value.zoom === "number" ? Math.min(3, Math.max(0.5, value.zoom)) : 1,
    spellcheck: typeof value.spellcheck === "boolean" ? value.spellcheck : spellcheckDefault(ext),
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

/** Markdown viewer and source editor (Steps 04b, 06a): the formatted page
 * in a frame that cannot run scripts, the source in an editor, or both side
 * by side. Links ask before opening in the browser. */
export default function MarkdownView({
  info,
  url,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenInWindowsApp,
  find,
  protectedView,
  onDirtyChange,
  registerSave,
  onPathChange,
  onOpenFile,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<SavedMarkdownState>(() => readSaved(savedState, info.ext));
  const [source, setSource] = useState<string | null>(null);
  const [colors, setColors] = useState<DocColors>(() => themeColors());
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [matches, setMatches] = useState(0);
  const [frameLoads, setFrameLoads] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const languageCompartment = useRef(new Compartment());
  const matchIndex = useRef(0);
  const previewTimer = useRef<number | null>(null);
  const sourceRef = useRef<string | null>(null);
  /** Reading position (0 to 1), kept when the page is rebuilt (zoom, theme). */
  const scrollRatio = useRef(0);
  /** Protected view (Step 04c): links do nothing. */
  const protectedRef = useRef(protectedView);
  protectedRef.current = protectedView;

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

  // The page follows the editor's text, shortly after the typing stops.
  const onTextChange = useCallback((text: string) => {
    if (sourceRef.current === null) {
      sourceRef.current = text;
      setSource(text);
      return;
    }
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      sourceRef.current = text;
      setSource(text);
    }, PREVIEW_DELAY_MS);
  }, []);

  const doc = useTextDocument({
    info,
    url,
    active,
    protectedView,
    paged: false,
    part: 0,
    extensions: [languageCompartment.current.of([]), lineNumbers(), EditorView.lineWrapping],
    phrases: { "current match": t("text.cm.currentMatch"), "on line": t("text.cm.onLine") },
    spellcheck: settings.spellcheck,
    lang: i18n.language,
    onDirtyChange,
    registerSave,
    onPathChange,
    onTextChange,
  });
  const { viewRef, readOnly, dirty } = doc;
  const editable = readOnly === null;

  useEffect(() => {
    let cancelled = false;
    void loadLanguage("markdown").then((language) => {
      const view = viewRef.current;
      if (!cancelled && view) view.dispatch({ effects: languageCompartment.current.reconfigure(language) });
    });
    return () => {
      cancelled = true;
    };
  }, [viewRef]);

  // Follow theme changes (the page's colors are fixed when it is built).
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(themeColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  // A pending preview timer stops with the tab (plan/pitfalls.md P-28).
  useEffect(
    () => () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  const page = useMemo(
    () => (source === null ? "" : renderMarkdownPage(source, colors, settings.zoom, i18n.language)),
    [source, colors, settings.zoom, i18n.language],
  );

  // The page frame shares our origin but cannot run scripts. We pass its
  // shortcut keys to the app and turn its link clicks into a question.
  const attachFrame = useCallback(() => {
    const frame = frameRef.current;
    const docFrame = frame?.contentDocument;
    if (!docFrame) return;
    const scroller = docFrame.scrollingElement;
    if (scroller) scroller.scrollTop = scrollRatio.current * scroller.scrollHeight;
    docFrame.addEventListener("scroll", () => {
      const element = docFrame.scrollingElement;
      if (element) scrollRatio.current = element.scrollTop / Math.max(1, element.scrollHeight);
    });
    docFrame.addEventListener("keydown", (event) => {
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
    docFrame.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href") ?? "";
      if (isExternalUrl(href) && !protectedRef.current) setPendingLink(href);
    });
    // A new page is ready: run the search again on it.
    setFrameLoads((count) => count + 1);
  }, []);

  // The file tab's search box: the page in Reading view, the editor otherwise.
  const lastFind = useRef({ request: find.request, text: find.text });
  useEffect(() => {
    const moved = find.request !== lastFind.current.request;
    const retyped = find.text !== lastFind.current.text;
    lastFind.current = { request: find.request, text: find.text };
    if (settings.mode !== "rendered") {
      const view = viewRef.current;
      if (view) runFind(view, find.text, moved ? (find.backwards ? "previous" : "next") : "here", find.options);
      return;
    }
    const docFrame = frameRef.current?.contentDocument;
    if (!docFrame) return;
    if (moved) matchIndex.current += find.backwards ? -1 : 1;
    else if (retyped) matchIndex.current = 0;
    setMatches(findInPage(docFrame, find.text, matchIndex.current).count);
  }, [find.text, find.request, find.backwards, find.options, settings.mode, frameLoads, viewRef]);

  // Replace: a new request number asks for one match or all of them.
  const firstReplaceRun = useRef(true);
  useEffect(() => {
    if (firstReplaceRun.current) {
      firstReplaceRun.current = false;
      return;
    }
    const request = find.replace;
    const view = viewRef.current;
    if (!request || !view || readOnly !== null) return;
    if (settings.mode === "rendered") return;
    runReplace(view, find.text, request.text, request.all, find.options);
  }, [find.replace?.request]);

  useEffect(() => {
    const modeKey =
      settings.mode === "rendered" ? "markdown.renderedMode" : settings.mode === "source" ? "markdown.sourceMode" : "markdown.splitMode";
    const items: string[] = [];
    if (dirty) items.push(t("editor.unsaved"));
    items.push(t(modeKey), formatSize(info.size, i18n.language));
    if (find.text !== "" && settings.mode === "rendered") items.unshift(t("viewer.matches", { count: matches }));
    onStatus({ items });
  }, [settings.mode, dirty, info.size, i18n.language, find.text, matches, onStatus, t]);

  const ctx: MarkdownCtx = {
    mode: settings.mode,
    zoom: settings.zoom,
    ready: doc.encoding !== null,
    editable,
    dirty,
    canSaveAs: true,
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
    spellcheck: settings.spellcheck,
  };
  const commands = useMemo<Command<MarkdownCtx>[]>(
    () => [
      { id: "markdown.save", labelKey: "editor.save", icon: Save, shortcut: "Ctrl+S", risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.editable && c.dirty, run: () => void doc.save() },
      { id: "markdown.saveAs", labelKey: "editor.saveAs", icon: SaveAll, shortcut: "Ctrl+Shift+S", risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.ready, run: () => void doc.saveAs() },
      { id: "markdown.versionHistory", labelKey: "commands.versionHistory", icon: History, risk: "read-only", helpSlug: "version-history", enabledWhen: () => true, run: () => setShowHistory(true) },
      { id: "markdown.undo", labelKey: "editor.undoHint", icon: Undo2, risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.editable && c.canUndo, run: () => doc.undo() },
      { id: "markdown.redo", labelKey: "editor.redoHint", icon: Redo2, risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.editable && c.canRedo, run: () => doc.redo() },
      { id: "markdown.spellcheck", labelKey: "editor.spellcheck", icon: SpellCheck, risk: "read-only", helpSlug: "editing-text-and-code", checkKind: "toggle", checkedWhen: (c) => c.spellcheck, enabledWhen: () => true, run: (c) => update({ spellcheck: !c.spellcheck }) },
      { id: "markdown.rendered", labelKey: "markdown.renderedMode", icon: BookOpen, risk: "read-only", helpSlug: "viewing-markdown", checkKind: "radio", checkedWhen: (c) => c.mode === "rendered", enabledWhen: () => true, run: () => update({ mode: "rendered" }) },
      { id: "markdown.source", labelKey: "markdown.sourceMode", icon: Code, risk: "read-only", helpSlug: "viewing-markdown", checkKind: "radio", checkedWhen: (c) => c.mode === "source", enabledWhen: () => true, run: () => update({ mode: "source" }) },
      { id: "markdown.split", labelKey: "markdown.splitMode", icon: Columns2, risk: "read-only", helpSlug: "editing-text-and-code", checkKind: "radio", checkedWhen: (c) => c.mode === "split", enabledWhen: () => true, run: () => update({ mode: "split" }) },
      { id: "markdown.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom < 3, run: (c) => update({ zoom: Math.min(3, Math.round(c.zoom * 11) / 10) }) },
      { id: "markdown.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom > 0.5, run: (c) => update({ zoom: Math.max(0.5, Math.round((c.zoom / 1.1) * 10) / 10) }) },
      { id: "markdown.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom !== 1, run: () => update({ zoom: 1 }) },
    ],
    // update only reads state through its argument; doc calls read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update, editable, dirty, doc.canUndo, doc.canRedo],
  );
  useCommandShortcuts(commands, ctx, active);

  const note =
    readOnly === null
      ? null
      : readOnly === "protected"
        ? t("editor.readOnlyProtected")
        : readOnly === "attribute"
          ? t("editor.readOnlyAttribute")
          : t("editor.readOnlyEncoding", { encoding: doc.encoding ? ENCODING_LABELS[doc.encoding] : "" });

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "file",
            labelKey: "editor.file",
            controls: [
              { type: "button", command: "markdown.save", keyTip: "S" },
              { type: "button", command: "markdown.saveAs", keyTip: "A" },
              { type: "button", command: "markdown.versionHistory", keyTip: "H" },
            ],
          },
          {
            id: "edit",
            labelKey: "editor.edit",
            controls: [
              { type: "button", command: "markdown.undo", showLabel: false, keyTip: "Z" },
              { type: "button", command: "markdown.redo", showLabel: false, keyTip: "Y" },
            ],
          },
          {
            id: "mode",
            labelKey: "ribbon.show",
            controls: [
              { type: "toggle", command: "markdown.rendered", keyTip: "D" },
              { type: "toggle", command: "markdown.source", keyTip: "C" },
              { type: "toggle", command: "markdown.split", keyTip: "L" },
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
          {
            id: "saving",
            labelKey: "editor.saveWith",
            controls: [
              {
                type: "custom",
                id: "saveEncoding",
                render: () => (
                  <label className="adp-ribbon-custom">
                    {t("editor.saveWith")}
                    <select
                      aria-label={t("editor.saveWith")}
                      value={doc.saveEncoding}
                      disabled={!editable}
                      onChange={(event) => doc.setSaveEncoding(event.target.value as SaveEncodingId)}
                    >
                      {SAVE_ENCODINGS.map((name) => (
                        <option key={name} value={name}>
                          {SAVE_ENCODING_LABELS[name]}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              },
              {
                type: "custom",
                id: "lineEndings",
                render: () => (
                  <label className="adp-ribbon-custom">
                    {t("editor.lineEndings")}
                    <select
                      aria-label={t("editor.lineEndings")}
                      value={doc.lineEnding}
                      disabled={!editable}
                      onChange={(event) => doc.setLineEnding(event.target.value as "crlf" | "lf")}
                    >
                      <option value="crlf">{t("editor.lineEndingCrlf")}</option>
                      <option value="lf">{t("editor.lineEndingLf")}</option>
                    </select>
                  </label>
                ),
              },
            ],
          },
          {
            id: "spelling",
            labelKey: "ribbon.show",
            controls: [{ type: "toggle", command: "markdown.spellcheck", keyTip: "K" }],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {note ? (
        <div className="adp-text-notice" role="note">
          {note}
        </div>
      ) : null}
      {doc.draft ? (
        <div className="adp-editor-bar" role="status">
          <span>
            {t(info.modified_unix > doc.draft.file_modified_unix ? "editor.recoveredChanged" : "editor.recovered", {
              time: formatDate(doc.draft.saved_unix, i18n.language),
            })}
          </span>
          <Button variant="primary" onClick={doc.restoreDraft}>
            {t("editor.restore")}
          </Button>
          <Button onClick={doc.discardDraft}>{t("editor.discard")}</Button>
        </div>
      ) : null}
      {doc.notice ? (
        <div className="adp-editor-bar adp-editor-bar--error" role="alert">
          <span>{doc.notice}</span>
          <Button onClick={doc.clearNotice}>{t("common.dismiss")}</Button>
        </div>
      ) : null}
      {doc.failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("text.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : null}
      <div className={`adp-md-pane${settings.mode === "split" ? " adp-md-split" : ""}`} hidden={doc.failed}>
        <div ref={doc.hostRef} className="adp-text-host" hidden={settings.mode === "rendered"} />
        {settings.mode !== "source" ? (
          <iframe
            ref={frameRef}
            className="adp-markdown-frame"
            sandbox="allow-same-origin"
            srcDoc={page}
            title={info.name}
            onLoad={attachFrame}
          />
        ) : null}
      </div>
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
      {showHistory ? (
        <VersionHistoryDialog
          path={info.path}
          name={info.name}
          currentModified={doc.expected.modified_unix}
          currentSize={doc.expected.size}
          versionsEnabled={true}
          hasUnsavedChanges={dirty}
          onOpenCopy={(path) => {
            if (onOpenFile) void onOpenFile(path).catch(() => undefined);
          }}
          onShowWindowsVersions={() => {
            if (isTauriRuntime()) void showProperties([info.path]).catch(() => undefined);
          }}
          onRestored={() => {
            doc.discard();
            void doc.reloadFromDisk();
          }}
          onClose={() => setShowHistory(false)}
        />
      ) : null}
      {doc.conflict ? (
        <Dialog title={t("editor.changedTitle")} onClose={() => doc.resolveConflict("cancel")}>
          <p className="adp-dialog-text">{t("editor.changedBody", { name: info.name })}</p>
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={() => doc.resolveConflict("overwrite")}>
              {t("editor.overwrite")}
            </Button>
            <Button onClick={() => doc.resolveConflict("reload")}>{t("editor.reload")}</Button>
            <Button onClick={() => doc.resolveConflict("cancel")}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </ViewerFrame>
  );
}
