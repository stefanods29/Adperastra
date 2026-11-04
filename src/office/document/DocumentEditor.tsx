import OfficePaperEditor from "../paper/OfficePaperEditor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandRegistry } from "../../commands/registry";
import Skeleton from "../../components/Skeleton";
import type { SerializableViewState, VirtualViewProps } from "../../documents/types";
import { extractionAvailability } from "../../extraction/extractionAvailability";
import Ribbon from "../../ribbon/Ribbon";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { errorText } from "../../services/errors";
import { listPacks } from "../../services/packs";
import { loadSettings } from "../../services/settings";
import type { OfficeController } from "../OfficeController";
import { canOfficeCommand } from "../officeCompatibility";
import { saveOfficeCopy } from "../saveOfficeCopy";
import type {
  DocumentOperation, DocumentStatistics, OfficeCapability, OfficeColor, OfficeEditComment, OfficeFont,
  OfficeFormatting, OfficeSessionState, OfficeStyleItem, OfficeValue,
} from "../types";
import { DocumentCanvas } from "./DocumentCanvas";
import { DocumentComments } from "./DocumentComments";
import { DocumentAiPanel } from "./ai/DocumentAiPanel";
import type { DocumentAiAction } from "./ai/documentAiTypes";
import { canDocumentMutate, openDocumentController } from "./documentController";
import {
  documentEditorAppHost, registerDocumentCommands, setDocumentEditorHost, type DocumentEditorHost,
} from "./documentCommands";
import DocumentDialogs from "./DocumentDialogs";
import { DocumentFontControls } from "./DocumentFontControls";
import { DocumentHeader } from "./DocumentHeader";
import { DocumentNavigation } from "./DocumentNavigation";
import { documentRibbon, DocumentRibbonControls } from "./documentRibbon";
import { DocumentRuler } from "./DocumentRuler";
import { DocumentSpelling } from "./DocumentSpelling";
import { DocumentDictation } from "./DocumentDictation";
import { readDocumentStatistics } from "./documentStatistics";
import {
  documentTabIds, type DocumentDialogId, type DocumentEditorProps, type DocumentEditorViewState,
  type OfficeCommandContext,
} from "./documentUiTypes";
import { normalizeDocumentViewState } from "./documentViewState";

const EMPTY_VIEW: DocumentEditorViewState = {
  selection: null,
  viewport: {
    x_px: 0, y_px: 0, width_px: 640, height_px: 800,
    zoom_percent: 100, device_scale: 1, view_revision: 0,
  },
  navigation_open: false, comments_open: false, ruler: true, active_ribbon_tab: documentTabIds[1],
};

const AI_CAPABILITIES: readonly OfficeCapability[] = ["ai_context", "proposal_clone", "proposal_apply"];

function clampZoom(value: number): number {
  return Math.max(10, Math.min(400, Math.round(value)));
}

/** The document editor (20b E1). One shared OfficeController serves every view
 * of the document; this component owns only view-local selection, panels and
 * dialog state. A missing native engine, a protected/read-only document or a
 * preview-only view never becomes an editable model. */
export default function DocumentEditor({
  document, active, savedState, onStateChange, onStatus, onOpenHelp, previewOnly = false,
}: DocumentEditorProps) {
  const { t } = useTranslation();
  const preview = previewOnly || document.info.read_only;
  const [controller, setController] = useState<OfficeController | null>(null);
  const [state, setState] = useState<OfficeSessionState | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [view, setView] = useState<DocumentEditorViewState>(() => normalizeDocumentViewState(savedState ?? EMPTY_VIEW));
  const [formatting, setFormatting] = useState<OfficeFormatting | null>(null);
  const [comments, setComments] = useState<OfficeEditComment[]>([]);
  const [styles, setStyles] = useState<OfficeStyleItem[]>([]);
  const [statistics, setStatistics] = useState<DocumentStatistics | null>(null);
  const [dialog, setDialog] = useState<DocumentDialogId | null>(null);
  const [textKind, setTextKind] = useState<"footnote" | "citation" | null>(null);
  const [spellingOpen, setSpellingOpen] = useState(false);
  const [dictationOpen, setDictationOpen] = useState(false);
  const [speechReady, setSpeechReady] = useState(false);
  const [aiAction, setAiAction] = useState<DocumentAiAction | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiReturnFocus = useRef<HTMLElement | null>(null);
  const colorInput = useRef<HTMLInputElement>(null);
  const colorTarget = useRef<"foreground" | "highlight">("foreground");
  const viewRef = useRef(view);
  const stateRef = useRef(state);
  const controllerRef = useRef(controller);
  const selectionRef = useRef(view.selection);
  viewRef.current = view;
  stateRef.current = state;
  controllerRef.current = controller;
  selectionRef.current = view.selection;

  const registry = useMemo(() => {
    const created = new CommandRegistry<OfficeCommandContext>();
    registerDocumentCommands(created);
    return created;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let acquired: OfficeController | null = null;
    let unsubscribe: () => void = () => undefined;
    setController(null); setState(null); setFallback(null); setError(null); setStatistics(null);
    setAiAction(null); aiReturnFocus.current = null;
    void openDocumentController(document).then((result) => {
      if (result.kind === "viewing") {
        if (!cancelled) setFallback(result.reason_key);
        return;
      }
      if (cancelled) { void result.controller.close(); return; }
      acquired = result.controller;
      setController(result.controller);
      setState(result.controller.getState());
      unsubscribe = result.controller.subscribe((next) => setState(next));
    }).catch((caught) => { if (!cancelled) setError(caught); });
    return () => {
      cancelled = true;
      unsubscribe();
      if (acquired) void acquired.close();
    };
  }, [document]);

  useEffect(() => { onStateChange(view); }, [onStateChange, view]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSettings(), extractionAvailability()]).then(([settings, availability]) => {
      if (!cancelled) setAiEnabled(settings.ai.documents.enabled && availability.available);
    }).catch(() => { if (!cancelled) setAiEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!state?.selection || state.selection.kind !== "document" ||
        state.selection.span.revision !== state.revision) return;
    setView((current) => JSON.stringify(current.selection) === JSON.stringify(state.selection)
      ? current : { ...current, selection: state.selection });
  }, [state?.revision, state?.selection]);

  useEffect(() => {
    if (!controller || !state || !view.selection || view.selection.kind !== "document" ||
        view.selection.span.revision !== state.revision) { setFormatting(null); return; }
    let cancelled = false;
    void controller.formatting(view.selection).then((next) => {
      if (!cancelled) setFormatting(next);
    }).catch(() => { if (!cancelled) setFormatting(null); });
    return () => { cancelled = true; };
  }, [controller, state?.revision, view.selection]);

  useEffect(() => {
    if (!controller || !state?.capabilities.includes("document_text")) { setStatistics(null); return; }
    let cancelled = false;
    const revision = state.revision;
    void readDocumentStatistics(controller.session_id).then((next) => {
      if (!cancelled && next.revision === revision) setStatistics(next);
    }).catch(() => { if (!cancelled) setStatistics(null); });
    return () => { cancelled = true; };
  }, [controller, state?.revision, state?.capabilities]);

  useEffect(() => {
    if (!controller || !state || !view.comments_open) return;
    let cancelled = false;
    void controller.items("comments").then((page) => {
      if (cancelled) return;
      if (page.kind !== "comments" || page.revision !== state.revision) throw new Error("office_edit.changed");
      setComments(page.items);
    }).catch((caught) => { if (!cancelled) setActionError(caught); });
    return () => { cancelled = true; };
  }, [controller, state?.revision, view.comments_open]);

  useEffect(() => {
    if (!controller || !state) return;
    let cancelled = false;
    void controller.items("styles").then((page) => {
      if (cancelled) return;
      if (page.kind !== "styles" || page.revision !== state.revision) throw new Error("office_edit.changed");
      setStyles(page.items);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [controller, state?.revision]);

  useEffect(() => {
    if (!dictationOpen) return;
    let cancelled = false;
    void listPacks().then((packs) => {
      if (!cancelled) setSpeechReady(packs.some((pack) => pack.id === "ai_speech" && pack.state === "installed"));
    }).catch(() => { if (!cancelled) setSpeechReady(false); });
    return () => { cancelled = true; };
  }, [dictationOpen]);

  useEffect(() => {
    if (!controller || !state || !active) return;
    if (state.status_key === "office.basicEditing") return;
    const selectedPage = view.selection?.kind === "document" ? view.selection.page : undefined;
    const page = statistics?.page ?? selectedPage ?? 1;
    const total = statistics?.page_count ??
      (Number.isSafeInteger(state.page_count) && state.page_count > 0 ? state.page_count : 1);
    const items = [t("officeDoc.pageStatus", { page, total })];
    if (preview) items.push(t("office.readOnly"));
    if (statistics) items.push(t("officeDoc.wordStatus", { count: statistics.words }));
    items.push(t(`office.${state.mode}`), state.dirty ? t("office.unsaved") : t("office.saved"));
    onStatus({
      items,
      zoom: {
        percent: view.viewport.zoom_percent, min: 10, max: 400,
        set: (percent) => setView((current) => ({
          ...current, viewport: { ...current.viewport, zoom_percent: clampZoom(percent) },
        })),
        fit: () => setView((current) => ({ ...current, viewport: { ...current.viewport, zoom_percent: 100 } })),
      },
    });
  }, [active, onStatus, preview, state, statistics, t, view.selection, view.viewport.zoom_percent]);

  const applyOperation = async (operation: DocumentOperation) => {
    const live = controllerRef.current;
    const current = stateRef.current;
    if (!live || !current) throw new Error("office_edit.engine_missing");
    await live.transact({
      transaction_id: crypto.randomUUID(), expected_revision: current.revision,
      operations: [{ family: "document", operation }], selection_after: null,
      label_key: "office.transaction",
    });
  };
  const applyTextPatch = async (patch: import("../types").TextFormatPatch) => {
    const selection = selectionRef.current;
    if (selection?.kind !== "document") throw new Error("office_edit.invalid");
    await applyOperation({ kind: "format_text", span: selection.span, patch });
  };

  /** Review > AI opens only for a live, non-empty document range (draft also
   * accepts an insertion point) while native context, clone and apply routes
   * and the selected provider all exist. Alt text has no selected-image
   * authority yet, so it stays disabled instead of guessing. */
  const canOpenAi = (action: DocumentAiAction): boolean => {
    const live = controllerRef.current;
    if (!live || !aiEnabled || preview) return false;
    const current = live.getState();
    if (!current.ready || current.busy || current.mode === "viewing") return false;
    if (!AI_CAPABILITIES.every((capability) => current.capabilities.includes(capability))) return false;
    const selection = selectionRef.current;
    if (!selection || selection.kind !== "document" || selection.span.revision !== current.revision) return false;
    // Alt text needs the missing selected-image authority; translate needs a
    // real supported-language list. Both stay disabled rather than guessed.
    if (action === "alt_text" || action === "translate") return false;
    const empty = selection.span.anchor.block_id === selection.span.focus.block_id &&
      selection.span.anchor.offset_utf16 === selection.span.focus.offset_utf16;
    return action === "draft" ? true : !empty;
  };
  const openAi = (action: DocumentAiAction) => {
    if (!canOpenAi(action)) return;
    aiReturnFocus.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    setAiAction(action);
  };
  const closeAi = () => {
    setAiAction(null);
    const target = aiReturnFocus.current;
    aiReturnFocus.current = null;
    window.setTimeout(() => {
      if (target?.isConnected) target.focus();
    }, 0);
  };

  const saveCopy = useCallback(() => {
    if (preview || !controller || !canOfficeCommand(controller.getState(), "save_copy", false).enabled) return;
    void saveOfficeCopy(document, t("office.saveCopy"), t("editor.allFiles")).catch(setActionError);
  }, [controller, document, preview, t]);

  useEffect(() => {
    if (!controller || !active) return;
    const app = () => documentEditorAppHost();
    const host: DocumentEditorHost = {
      canMutate: (capability) => canDocumentMutate(controller.getState(), capability, preview).enabled,
      canFile: (id) => {
        if (id === "saveCopy") return !preview;
        if (!app()) return false;
        if (id === "copyPath" && document.source.kind !== "disk") return false;
        return true;
      },
      file: (id) => {
        if (id === "saveCopy") {
          saveCopy();
          return;
        }
        const target = app();
        if (!target) return;
        if (id === "new") target.newDocument();
        else if (id === "open") target.openDocument();
        else if (id === "close") target.closeTab();
        else if (id === "copyPath") target.copyPath();
        else if (id === "exportPdf") target.exportPdf();
        else target.print();
      },
      updateView: (patch) => setView((current) => ({ ...current, ...patch })),
      openDialog: (id) => {
        if (id === "comment") setView((current) => ({ ...current, comments_open: true }));
        setDialog(id);
      },
      openHelp: onOpenHelp,
      openSpelling: () => setSpellingOpen(true),
      openDictation: () => setDictationOpen(true),
      canOpenAi,
      openAi,
      openText: (kind) => setTextKind(kind),
      pickTextColor: (target) => { colorTarget.current = target; colorInput.current?.click(); },
      focusFormat: (kind) => {
        const selector = kind === "font"
          ? ".adp-office-document-font select" : ".adp-office-document-font input[type=number]";
        window.document.querySelector<HTMLElement>(selector)?.focus();
      },
      canClipboard: (action) => action === "paste" && typeof navigator !== "undefined" && Boolean(navigator.clipboard),
      clipboard: (action) => {
        if (action !== "paste") return;
        void (async () => {
          const text = await navigator.clipboard.readText();
          const selection = selectionRef.current;
          const live = controllerRef.current;
          if (!text || !live || selection?.kind !== "document") throw new Error("office_edit.invalid");
          await live.transact({
            transaction_id: crypto.randomUUID(), expected_revision: live.getState().revision,
            operations: [{ family: "document", operation: { kind: "insert_text", position: selection.span.focus, text } }],
            selection_after: null, label_key: "office.transaction",
          });
        })().catch((caught) => setActionError(caught));
      },
      confirm: (message) => globalThis.confirm?.(message) ?? false,
      fail: (caught) => setActionError(caught),
      fit: (kind) => setView((current) => {
        const width = current.viewport.width_px / 640 * 100;
        const height = current.viewport.height_px / 800 * 100;
        return { ...current, viewport: { ...current.viewport, zoom_percent: clampZoom(kind === "width" ? width : Math.min(width, height)) } };
      }),
      zoom: (percent) => setView((current) => ({ ...current, viewport: { ...current.viewport, zoom_percent: clampZoom(percent) } })),
      toggleMode: () => {
        const current = controller.getState();
        if (current.mode === "viewing" && !canDocumentMutate(current, "document_text", preview).enabled) return;
        void controller.setEditingEnabled(current.mode === "viewing").catch((caught) => setActionError(caught));
      },
    };
    setDocumentEditorHost(controller.session_id, host);
    return () => setDocumentEditorHost(controller.session_id, null);
  }, [active, aiEnabled, controller, document.source.kind, onOpenHelp, preview, saveCopy]);

  if (controller && state?.status_key === "office.basicEditing") {
    return <OfficePaperEditor document={document} controller={controller} state={state} active={active} onStatus={onStatus} previewOnly={previewOnly} />;
  }

  if (fallback) {
    return <section className="adp-office-document-fallback" role="status">
      <p>{t(fallback)}</p>
      <button type="button" className="adp-btn" onClick={() => onOpenHelp("editing-documents")}>{t("help.title")}</button>
    </section>;
  }
  if (error) return <p className="adp-office-error" role="alert">{errorText(t, error, "office_edit")}</p>;
  if (!controller || !state) return <div className="adp-office-document-loading"><Skeleton variant="tiles" count={2} /></div>;

  const selection = view.selection?.kind === "document" && view.selection.span.revision === state.revision
    ? view.selection : null;
  const blocks = selection ? [selection.span.anchor.block_id] : [];
  const mutates = (capability: import("../types").OfficeCapability) =>
    canDocumentMutate(controller.getState(), capability, preview).enabled;
  const font: OfficeValue<OfficeFont> = formatting?.text.font ??
    { kind: "unavailable", reason_key: "office.unsupported" };
  const size: OfficeValue<number> = formatting?.text.size_pt ??
    { kind: "unavailable", reason_key: "office.unsupported" };
  const indent = formatting?.paragraph.indent_left_pt;
  const indentPt = indent?.kind === "value" ? indent.value : 0;
  const dictationLanguage = statistics?.language === "es" ? "es" : statistics?.language === "en" ? "en" : null;
  const ctx: OfficeCommandContext = { controller, state, selection, formatting, view, openDialog: (id) => {
    if (id === "comment") setView((current) => ({ ...current, comments_open: true }));
    setDialog(id);
  } };
  const slots = {
    "document.font": <DocumentFontControls font={font} size={size}
      fonts={font.kind === "value" ? [font.value] : []} disabled={!mutates("document_format")}
      onPatch={applyTextPatch} />,
    "document.size": <span />,
    "document.paragraph": <button type="button" className="adp-btn" disabled={!mutates("document_format") || blocks.length === 0}
      onClick={() => setDialog("paragraph")}>{t("officeDoc.paragraph")}</button>,
    "document.style": <button type="button" className="adp-btn" disabled={!mutates("document_format") || blocks.length === 0}
      onClick={() => setDialog("style")}>{t("officeDoc.style")}</button>,
    "document.page": <button type="button" className="adp-btn" disabled={!mutates("document_format")}
      onClick={() => setDialog("page")}>{t("officeDoc.pageSetup")}</button>,
    "document.zoom": <input type="number" min={10} max={400} aria-label={t("officeDoc.zoom")}
      value={view.viewport.zoom_percent} disabled={!active}
      onChange={(event) => {
        const percent = Number(event.target.value);
        if (Number.isFinite(percent)) setView((current) => ({
          ...current, viewport: { ...current.viewport, zoom_percent: clampZoom(percent) },
        }));
      }} />,
  };

  return <DocumentRibbonControls.Provider value={slots}>
    <ViewerFrame ribbon={<div className="adp-office-document-ribbon">
      <DocumentHeader controller={controller} state={state} previewOnly={preview}
        autosave={false} onAutosave={() => undefined}
        onComments={() => setView((current) => ({ ...current, comments_open: !current.comments_open }))}
        onShare={(action) => {
          if (action === "saveCopy") {
            saveCopy();
            return;
          }
          const target = documentEditorAppHost();
          if (!target) return;
          if (action === "copyPath") {
            if (document.source.kind === "disk") target.copyPath();
          } else target.exportPdf();
        }} />
      <Ribbon def={documentRibbon()} ctx={ctx} commands={registry.list()} accent="word" active={active}
        handlerId="office-word"
        initialTabId={view.active_ribbon_tab}
        onTabChange={(id) => {
          const tab = documentTabIds.find((entry) => entry === id);
          if (tab && tab !== view.active_ribbon_tab) {
            setView((current) => ({ ...current, active_ribbon_tab: tab }));
          }
        }} />
      {actionError ? <p role="alert">{errorText(t, actionError, "office_edit")}</p> : null}
    </div>}>
      <div className="adp-office-document-editor">
        {view.navigation_open ? <DocumentNavigation sessionId={controller.session_id} revision={state.revision}
          active={active && state.ready}
          onNavigate={(next) => setView((current) => ({ ...current, selection: next }))} /> : null}
        <div className="adp-office-document-main">
          {view.ruler ? <DocumentRuler indentPt={indentPt} blockIds={blocks}
            disabled={!mutates("document_format") || blocks.length === 0} onApply={applyOperation} /> : null}
          <DocumentCanvas controller={controller} active={active} selection={selection}
            revision={state.revision} canEditText={mutates("document_text")}
            onSelection={(next) => setView((current) => ({ ...current, selection: next }))}
            viewport={view.viewport}
            onViewport={(next) => setView((current) => ({ ...current, viewport: next }))}
            onOpenHelp={onOpenHelp} />
          {spellingOpen && selection ? <DocumentSpelling sessionId={controller.session_id}
            span={selection.span} enabled={state.capabilities.includes("spelling")}
            onApply={applyOperation} /> : null}
          {dictationOpen ? (dictationLanguage ? <DocumentDictation controller={controller}
            selection={selection} speechReady={speechReady} language={dictationLanguage}
            previewOnly={preview} /> : <p>{t("office.unsupported")}</p>) : null}
        </div>
        {aiAction ? <DocumentAiPanel key={`${controller.session_id}:${aiAction}`}
          controller={controller} selection={selection} initialAction={aiAction}
          onClose={closeAi} onOpenHelp={onOpenHelp} /> : null}
        {view.comments_open ? <DocumentComments comments={comments} author={t("officeDoc.localAuthor")}
          disabled={!mutates("document_comments")} onApply={applyOperation} /> : null}
      </div>
      <input ref={colorInput} type="color" aria-hidden="true" tabIndex={-1} className="adp-office-color-input"
        onChange={(event) => {
          const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(event.target.value);
          const current = selectionRef.current;
          if (!match || current?.kind !== "document") return;
          const color: OfficeColor = {
            r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16), a: 1,
          };
          const patch = colorTarget.current === "highlight" ? { highlight: color } : { foreground: color };
          void applyTextPatch(patch).catch((caught) => setActionError(caught));
        }} />
      <DocumentDialogs controller={controller} state={state} selection={selection}
        formatting={formatting} styles={styles} comments={comments} dialog={dialog} textKind={textKind}
        onClose={() => setDialog(null)} onTextClose={() => setTextKind(null)}
        onOperation={applyOperation}
        onSelect={(next) => setView((current) => ({ ...current, selection: next }))}
        onPickImage={() => {
          const target = documentEditorAppHost();
          return target ? target.pickImage() : Promise.reject(new Error("office_edit.unsupported"));
        }} />
    </ViewerFrame>
  </DocumentRibbonControls.Provider>;
}

/** Source-aware adapter (09a VirtualViewProps): it forwards the real handle and
 * never invents a FileTypeInfo path. */
export function VirtualDocumentEditor(props: VirtualViewProps) {
  return <DocumentEditor document={props.document} active={props.active}
    savedState={normalizeDocumentViewState(props.savedState)}
    onStateChange={(next) => props.onStateChange(next as unknown as SerializableViewState)}
    onStatus={props.onStatus} onOpenHelp={props.onOpenHelp} previewOnly={props.previewOnly} />;
}
