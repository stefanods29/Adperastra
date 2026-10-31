import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronLeft, ChevronRight, Hash, Redo2, Save, SaveAll, Scan, SpellCheck, Undo2, WrapText, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { Command } from "../../commands/registry";
import { useTextDocument } from "../../editor/useTextDocument";
import { SAVE_ENCODING_LABELS, SAVE_ENCODINGS, spellcheckDefault, type SaveEncodingId } from "../../editor/saveEncoding";
import { formatDate, formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { lineNumbers, runFind, runReplace } from "./editorSetup";
import { ENCODING_LABELS, ENCODINGS, type EncodingName } from "./encoding";
import { languageIdFor, loadLanguage } from "./languages";

/** Files above this size open in parts ("large file mode", read-only). */
export const LARGE_TEXT_BYTES = 10 * 1024 * 1024;
/** Size of one part in large file mode. */
export const PART_BYTES = 1024 * 1024;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3;

interface SavedTextState {
  wrap: boolean;
  numbers: boolean;
  zoom: number;
  spellcheck: boolean;
}

interface TextCtx {
  ready: boolean;
  wrap: boolean;
  numbers: boolean;
  zoom: number;
  paged: boolean;
  part: number;
  parts: number;
  editable: boolean;
  dirty: boolean;
  canSaveAs: boolean;
  canUndo: boolean;
  canRedo: boolean;
  spellcheck: boolean;
}

function readSaved(state: unknown, ext: string): SavedTextState {
  const value = (state ?? {}) as Partial<SavedTextState>;
  return {
    wrap: typeof value.wrap === "boolean" ? value.wrap : false,
    numbers: typeof value.numbers === "boolean" ? value.numbers : true,
    zoom: typeof value.zoom === "number" ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value.zoom)) : 1,
    spellcheck: typeof value.spellcheck === "boolean" ? value.spellcheck : spellcheckDefault(ext),
  };
}

/** Text and code viewer and editor (Steps 04b, 06a): CodeMirror, syntax
 * colors loaded per type, word wrap, line numbers, zoom, encodings, find,
 * find and replace, saving, and a large-file mode that shows the file in
 * 1 MB parts. */
export default function TextView({
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
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const compartments = useRef({ language: new Compartment(), wrap: new Compartment(), numbers: new Compartment() });
  const [settings, setSettings] = useState<SavedTextState>(() => readSaved(savedState, info.ext));
  const [part, setPart] = useState(0);
  const paged = info.size > LARGE_TEXT_BYTES;
  const parts = paged ? Math.ceil(info.size / PART_BYTES) : 1;

  const update = useCallback(
    (patch: Partial<SavedTextState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  const doc = useTextDocument({
    info,
    url,
    active,
    protectedView,
    paged,
    part,
    extensions: [
      compartments.current.language.of([]),
      compartments.current.wrap.of(settings.wrap ? EditorView.lineWrapping : []),
      compartments.current.numbers.of(settings.numbers ? lineNumbers() : []),
    ],
    phrases: {
      "current match": t("text.cm.currentMatch"),
      "on line": t("text.cm.onLine"),
      "Control character": t("text.cm.controlCharacter"),
    },
    spellcheck: settings.spellcheck,
    lang: i18n.language,
    onDirtyChange,
    registerSave,
    onPathChange,
  });
  const { viewRef, encoding, readOnly, dirty, cursor } = doc;
  const editable = readOnly === null;

  // Syntax colors, loaded once per file type.
  useEffect(() => {
    const id = languageIdFor(info.name);
    if (!id) return;
    let cancelled = false;
    void loadLanguage(id).then((language) => {
      const view = viewRef.current;
      if (!cancelled && view) view.dispatch({ effects: compartments.current.language.reconfigure(language) });
    });
    return () => {
      cancelled = true;
    };
  }, [info.name, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        compartments.current.wrap.reconfigure(settings.wrap ? EditorView.lineWrapping : []),
        compartments.current.numbers.reconfigure(settings.numbers ? lineNumbers() : []),
      ],
    });
  }, [settings.wrap, settings.numbers, viewRef]);

  // The file tab's search box.
  const lastRequest = useRef(find.request);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const moved = find.request !== lastRequest.current;
    lastRequest.current = find.request;
    runFind(view, find.text, moved ? (find.backwards ? "previous" : "next") : "here", find.options);
  }, [find.text, find.request, find.backwards, find.options, viewRef]);

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
    runReplace(view, find.text, request.text, request.all, find.options);
  }, [find.replace?.request]);

  // Status bar.
  useEffect(() => {
    const items: string[] = [];
    if (dirty) items.push(t("editor.unsaved"));
    items.push(t("text.position", { line: cursor.line, column: cursor.column }), t("text.lines", { count: cursor.lines }));
    if (encoding) items.push(ENCODING_LABELS[encoding]);
    if (doc.lineEnding) items.push(t(`editor.lineEnding${doc.lineEnding === "crlf" ? "Crlf" : "Lf"}`));
    if (paged) items.push(t("text.part", { part: part + 1, parts }));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [dirty, cursor, encoding, doc.lineEnding, paged, part, parts, info.size, i18n.language, onStatus, t]);

  const ctx: TextCtx = {
    ready: encoding !== null,
    wrap: settings.wrap,
    numbers: settings.numbers,
    zoom: settings.zoom,
    paged,
    part,
    parts,
    editable,
    dirty,
    canSaveAs: !paged,
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
    spellcheck: settings.spellcheck,
  };
  const zoomBy = (factor: number) => update({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(settings.zoom * factor * 10) / 10)) });

  const commands = useMemo<Command<TextCtx>[]>(
    () => [
      { id: "text.save", labelKey: "editor.save", icon: Save, shortcut: "Ctrl+S", risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.editable && c.dirty, run: () => void doc.save() },
      { id: "text.saveAs", labelKey: "editor.saveAs", icon: SaveAll, shortcut: "Ctrl+Shift+S", risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.canSaveAs, run: () => void doc.saveAs() },
      { id: "text.undo", labelKey: "editor.undoHint", icon: Undo2, risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.editable && c.canUndo, run: () => doc.undo() },
      { id: "text.redo", labelKey: "editor.redoHint", icon: Redo2, risk: "change", helpSlug: "editing-text-and-code", enabledWhen: (c) => c.editable && c.canRedo, run: () => doc.redo() },
      { id: "text.spellcheck", labelKey: "editor.spellcheck", icon: SpellCheck, risk: "read-only", helpSlug: "editing-text-and-code", checkKind: "toggle", checkedWhen: (c) => c.spellcheck, enabledWhen: () => true, run: (c) => update({ spellcheck: !c.spellcheck }) },
      { id: "text.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom < ZOOM_MAX, run: () => zoomBy(1.1) },
      { id: "text.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom > ZOOM_MIN, run: () => zoomBy(1 / 1.1) },
      { id: "text.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom !== 1, run: () => update({ zoom: 1 }) },
      { id: "text.wordWrap", labelKey: "text.wordWrap", icon: WrapText, risk: "read-only", helpSlug: "viewing-text", checkKind: "toggle", checkedWhen: (c) => c.wrap, enabledWhen: () => true, run: (c) => update({ wrap: !c.wrap }) },
      { id: "text.lineNumbers", labelKey: "text.lineNumbers", icon: Hash, risk: "read-only", helpSlug: "viewing-text", checkKind: "toggle", checkedWhen: (c) => c.numbers, enabledWhen: () => true, run: (c) => update({ numbers: !c.numbers }) },
      { id: "text.previousPart", labelKey: "text.previousPart", icon: ChevronLeft, shortcut: "Alt+PageUp", risk: "read-only", helpSlug: "viewing-text", visibleWhen: (c) => c.paged, enabledWhen: (c) => c.part > 0, run: () => setPart((value) => Math.max(0, value - 1)) },
      { id: "text.nextPart", labelKey: "text.nextPart", icon: ChevronRight, shortcut: "Alt+PageDown", risk: "read-only", helpSlug: "viewing-text", visibleWhen: (c) => c.paged, enabledWhen: (c) => c.part < c.parts - 1, run: () => setPart((value) => Math.min(parts - 1, value + 1)) },
    ],
    // zoomBy and update only read state through their arguments and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.zoom, parts, update, editable, dirty, doc.canUndo, doc.canRedo],
  );
  useCommandShortcuts(commands, ctx, active);

  const note =
    paged || readOnly === null
      ? null
      : readOnly === "protected"
        ? t("editor.readOnlyProtected")
        : readOnly === "attribute"
          ? t("editor.readOnlyAttribute")
          : t("editor.readOnlyEncoding", { encoding: encoding ? ENCODING_LABELS[encoding] : "" });

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
              { type: "button", command: "text.save", keyTip: "S" },
              { type: "button", command: "text.saveAs", keyTip: "A" },
            ],
          },
          {
            id: "edit",
            labelKey: "editor.edit",
            controls: [
              { type: "button", command: "text.undo", showLabel: false, keyTip: "Z" },
              { type: "button", command: "text.redo", showLabel: false, keyTip: "Y" },
            ],
          },
          {
            id: "zoom",
            labelKey: "ribbon.zoom",
            controls: [
              { type: "button", command: "text.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "text.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "text.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
          {
            id: "show",
            labelKey: "ribbon.show",
            controls: [
              { type: "toggle", command: "text.wordWrap", keyTip: "W" },
              { type: "toggle", command: "text.lineNumbers", keyTip: "N" },
              { type: "toggle", command: "text.spellcheck", keyTip: "K" },
            ],
          },
          {
            id: "encoding",
            labelKey: "text.encoding",
            controls: [
              {
                type: "custom",
                id: "encoding",
                render: () => (
                  <label className="adp-ribbon-custom">
                    {t("text.encoding")}
                    <select
                      aria-label={t("text.encoding")}
                      value={encoding ?? "utf-8"}
                      disabled={dirty}
                      onChange={(event) => doc.setReadEncoding(event.target.value as EncodingName)}
                    >
                      {ENCODINGS.map((name) => (
                        <option key={name} value={name}>
                          {ENCODING_LABELS[name]}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              },
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
            id: "parts",
            labelKey: "text.parts",
            controls: [
              { type: "button", command: "text.previousPart", keyTip: "P" },
              { type: "button", command: "text.nextPart", keyTip: "X" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {paged ? (
        <div className="adp-text-notice" role="note">
          {t("text.largeFileNotice", { size: formatSize(PART_BYTES, i18n.language) })}
        </div>
      ) : note ? (
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
      <div
        ref={doc.hostRef}
        className="adp-text-host"
        hidden={doc.failed}
        style={{ ["--adp-text-zoom" as string]: String(settings.zoom) }}
      />
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
