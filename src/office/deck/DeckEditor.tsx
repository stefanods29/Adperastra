import OfficePaperEditor from "../paper/OfficePaperEditor";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../components/Skeleton";
import { CommandRegistry } from "../../commands/registry";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { errorText } from "../../services/errors";
import { officeItems } from "../../services/officeEdit";
import { TransferRegistry } from "../../transfer/TransferRegistry";
import { canOfficeCommand } from "../officeCompatibility";
import type { OfficeController } from "../OfficeController";
import type {
  DeckShape, DeckShapePatch, DeckTheme, OfficeEditComment, OfficeFormatting, OfficeSessionState,
} from "../types";
import type { DeckBackstageSection } from "./DeckBackstage";
import DeckComments from "./DeckComments";
import DeckDialogs from "./DeckDialogs";
import DeckTextControls from "./DeckTextControls";
import { acquireDeckController, canDeckMutate, canSaveDeckExisting, openDeckController } from "./deckController";
import {
  deckEditorHost, deckFileAction, presentModeValue, registerDeckCommands, setDeckHostActions,
  setDeckLayoutContext, setOpenPresent, setPresentMode, type DeckLayoutContext,
} from "./deckCommands";
import { deckExportPublisher } from "./deckExport";
import DeckHeader from "./DeckHeader";
import { deckTransferTarget } from "./deckTransfer";
import { normalizeDeckViewState } from "./deckViewState";
import {
  defaultDeckViewState, type DeckCommandContext, type DeckDialogId, type DeckEditorProps,
  type DeckEditorViewState, type DeckSelection,
} from "./deckUiTypes";
import { buildGeometryShape, buildTextShape, newShapeId, validateShapeRect } from "./DeckShapeTools";
import DeckShapeTools from "./DeckShapeTools";
import SlideCanvas from "./SlideCanvas";
import SlideStrip, { type DeckSlideSummary } from "./SlideStrip";
import SlideNotes from "./SlideNotes";
import { DECK_STYLE_FONT_ASSETS, registerAvailableDeckFontAssets } from "./styles/styleFonts";

/** New comments have no account lookup. Until a local profile exists this
 * fixed, non-localized value is the explicit displayed author; it is document
 * content, not UI chrome. */
const LOCAL_AUTHOR = "Local user";

/** The slide editor (Step 22a E1). One shared OfficeController serves every
 * view of the document; this component owns only view-local selection and
 * panel state. All document changes are typed DeckOperations. */
export default function DeckEditor({
  document,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenHelp,
  previewOnly = false,
}: DeckEditorProps) {
  const { t } = useTranslation();
  const [controller, setController] = useState<OfficeController | null>(null);
  const [state, setState] = useState<OfficeSessionState | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<DeckEditorViewState>(() => normalizeDeckViewState(savedState ?? defaultDeckViewState()));
  const [slides, setSlides] = useState<DeckSlideSummary[]>([]);
  const [theme, setTheme] = useState<DeckTheme | null>(null);
  const [formatting, setFormatting] = useState<OfficeFormatting | null>(null);
  const [comments, setComments] = useState<OfficeEditComment[]>([]);
  const [dialog, setDialog] = useState<DeckDialogId | null>(null);
  const [backstage, setBackstage] = useState<DeckBackstageSection | null>(null);
  const [presentOpen, setPresentOpen] = useState(false);
  const [presentStart, setPresentStart] = useState<"first" | "current" | "presenter" | "display">("first");
  const [imageSnapshot, setImageSnapshot] = useState<import("../../services/exportSnapshots").ExportSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [stripWidth, setStripWidth] = useState(196);
  const [notesHeight, setNotesHeight] = useState(160);
  const viewRef = useRef(view);
  const stateRef = useRef(state);
  const controllerRef = useRef(controller);
  viewRef.current = view;
  stateRef.current = state;
  controllerRef.current = controller;

  const registry = useMemo(() => {
    const created = new CommandRegistry<DeckCommandContext>();
    registerDeckCommands(created);
    return created;
  }, []);

  // The approved Inter binaries are bundled at public/fonts/inter-4.1/
  // (Inter-Regular.ttf, Inter-Bold.ttf). Registering those asset IDs is what
  // lets the style library (hosted by DeckDialogs below, Design > Style
  // library) offer Apply; a missing native asset still turns into a native
  // font_missing warning, never a silent substitute.
  useEffect(() => {
    registerAvailableDeckFontAssets(DECK_STYLE_FONT_ASSETS.map((asset) => asset.asset_id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let acquired: OfficeController | null = null;
    let unsubscribe: () => void = () => undefined;
    setController(null);
    setState(null);
    setFallback(null);
    setError(null);
    void openDeckController(document, previewOnly).then((result) => {
      if (cancelled) {
        if (result.kind === "editing") void result.controller.close();
        return;
      }
      if (result.kind === "viewing") {
        setFallback(result.reason_key);
        return;
      }
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
  }, [document.id, previewOnly]);

  useEffect(() => {
    onStateChange(view);
  }, [view, onStateChange]);

  const updateView = (next: DeckEditorViewState) => setView(next);

  useEffect(() => {
    if (!controller) return;
    return TransferRegistry.register(deckTransferTarget(controller));
  }, [controller]);

  useEffect(() => {
    if (!controller) return;
    let cancelled = false;
    void (async () => {
      try {
        const all: DeckSlideSummary[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 40; page += 1) {
          const result = await controller.items("slides", cursor);
          const items = result.items as unknown as DeckSlideSummary[];
          all.push(...items);
          if (!result.next_cursor) break;
          cursor = result.next_cursor;
        }
        if (!cancelled) {
          all.sort((a, b) => a.index - b.index);
          setSlides(all.slice(0, 10_000));
        }
      } catch (caught) {
        if (!cancelled) setError(caught);
      }
    })();
    return () => { cancelled = true; };
  }, [controller, state?.slide_count]);

  useEffect(() => {
    if (!controller) return;
    let cancelled = false;
    void controller.items("masters")
      .then((result) => {
        if (cancelled) return;
        const themes = result.items as unknown as DeckTheme[];
        setTheme(themes[0] ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [controller]);

  useEffect(() => {
    const layout: Partial<DeckLayoutContext> = {
      defaultLayoutId: theme?.default_layout_id ?? null,
      slideIds: slides.map((slide) => slide.id),
      slideLayouts: Object.fromEntries(slides.map((slide) => [slide.id, slide.layout_id])),
      slideHidden: Object.fromEntries(slides.map((slide) => [slide.id, slide.hidden])),
    };
    setDeckLayoutContext(layout);
  }, [slides, theme]);

  useEffect(() => {
    if (!controller || !view.selection) {
      setFormatting(null);
      return;
    }
    let cancelled = false;
    void controller.formatting(view.selection)
      .then((result) => { if (!cancelled) setFormatting(result); })
      .catch(() => { if (!cancelled) setFormatting(null); });
    return () => { cancelled = true; };
  }, [controller, view.selection]);

  useEffect(() => {
    if (!controller || !view.comments_open) return;
    let cancelled = false;
    // The canonical OfficeController classifies `comments` as a document
    // item kind, so a deck uses its dedicated comment extension through the
    // same session instead of asking the document-family item guard.
    void officeItems(controller.session_id, "comments")
      .then((result) => { if (!cancelled) setComments(result.items as unknown as OfficeEditComment[]); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [controller, view.comments_open, state?.revision]);

  useEffect(() => {
    if (!state || !active) return;
    if (state.status_key === "office.basicEditing") return;
    const index = slides.findIndex((slide) => slide.id === view.slide_id);
    onStatus({
      items: [
        t("officeDeck.slideStatus", { slide: Math.max(0, index) + 1, total: Math.max(1, slides.length) }),
        t(`office.${state.mode}`),
        state.dirty ? t("office.unsaved") : t("office.saved"),
      ],
      zoom: {
        percent: view.viewport.zoom_percent, min: 10, max: 400,
        set: (percent) => updateView({ ...viewRef.current, viewport: { ...viewRef.current.viewport, zoom_percent: percent } }),
        fit: () => updateView({ ...viewRef.current, viewport: { ...viewRef.current.viewport, zoom_percent: 100 } }),
      },
    });
  }, [active, onStatus, slides.length, state, t, view.slide_id, view.viewport.zoom_percent]);

  useEffect(() => {
    setOpenPresent(() => {
      setPresentStart(presentModeValue());
      setPresentOpen(true);
    });
    return () => setOpenPresent(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F5" || dialog !== null || presentOpen || !state) return;
      if (!canOfficeCommand(state, "deck_present", false).enabled) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      setPresentStart(event.shiftKey ? "current" : "first");
      setPresentMode(event.shiftKey ? "current" : "first");
      setPresentOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, dialog, presentOpen, state]);

  useEffect(() => {
    setDeckHostActions({
      updateView: (patch) => updateView({ ...viewRef.current, ...patch }),
      openHelp: onOpenHelp,
      fileAction: deckFileAction,
      clipboard: (id) => {
        if (id === "paste" && navigator.clipboard) {
          void navigator.clipboard.readText().then((text) => {
            if (!text) return;
            commit([{ kind: "add_shape", slide_id: currentSlideId(), shape: buildTextShape(newShapeId(), text) }]);
          });
        }
      },
      deleteSlides: (ids) => {
        const count = ids.length;
        if (count === 0) return;
        if (!globalThis.confirm?.(t("officeDeck.deleteConfirm", { count }))) return;
        commit(ids.map((id) => ({ kind: "delete_slides", slide_ids: [id] })));
      },
      insertShape: (kind) => {
        const shape = kind === "text" ? buildTextShape(newShapeId(), "") : buildGeometryShape(newShapeId(), kind);
        if (validateShapeRect(shape.rect)) commit([{ kind: "add_shape", slide_id: currentSlideId(), shape }]);
      },
      pickTextColor: () => window.document.querySelector<HTMLInputElement>(".adp-deck-text-controls input[type=color]")?.click(),
      focusFormat: (control) => window.document.querySelector<HTMLInputElement>(`.adp-deck-text-controls input[aria-label="${t(`officeDeck.${control}`)}"]`)?.focus(),
    });
    return () => setDeckHostActions(null);
  }, [onOpenHelp, slides, t]);

  const currentSlideId = () => viewRef.current.slide_id ?? slides[0]?.id ?? "";
  const transaction = (operations: import("../types").DeckOperation[]) => {
    const live = controllerRef.current;
    const current = stateRef.current;
    if (!live || !current || operations.length === 0) return;
    void live.transact({
      transaction_id: crypto.randomUUID(),
      expected_revision: current.revision,
      operations: operations.map((operation) => ({ family: "deck" as const, operation })),
      selection_after: null,
      label_key: "office.transaction",
    }).catch((caught) => setError(caught));
  };
  const commit = transaction;

  if (controller && state?.status_key === "office.basicEditing") {
    return <OfficePaperEditor document={document} controller={controller} state={state} active={active} onStatus={onStatus} previewOnly={previewOnly} />;
  }

  if (fallback) {
    return (
      <section className="adp-deck-fallback" role="status">
        <p>{t(fallback)}</p>
        <button type="button" className="adp-btn" onClick={() => onOpenHelp("editing-presentations")}>{t("help.title")}</button>
      </section>
    );
  }
  if (error) {
    return <p className="adp-deck-error" role="alert">{errorText(t, error, "office_edit")}</p>;
  }
  if (!controller || !state) {
    return <div className="adp-deck-loading"><Skeleton variant="tiles" count={4} /></div>;
  }

  const selection = view.selection;
  const slideId = view.slide_id ?? slides[0]?.id ?? null;
  const publisher = deckExportPublisher();
  const openDialog = (id: DeckDialogId) => {
    if (id === "export" && !publisher) {
      setBackstage("export");
      return;
    }
    setDialog(id);
  };
  const ctx: DeckCommandContext = { controller, state, selection, view, openDialog };
  const commands = registry.list();
  const selectedSlide = slides.find((slide) => slide.id === slideId) ?? null;
  const canMutate = canDeckMutate(document, state, "deck_shapes", previewOnly).enabled;
  const canComment = canDeckMutate(document, state, "deck_comments", previewOnly).enabled;
  const canPresent = canOfficeCommand(state, "deck_present", false).enabled;
  const canSave = canSaveDeckExisting(controller);

  const onSelectSlide = (id: string, mode: "replace" | "add" | "range") => {
    const index = slides.findIndex((slide) => slide.id === id);
    const anchor = slides.findIndex((slide) => slide.id === slideId);
    let ids = [id];
    if (mode === "add" && selection) {
      ids = selection.slide_ids.includes(id)
        ? selection.slide_ids.filter((entry) => entry !== id)
        : [...selection.slide_ids, id];
      if (ids.length === 0) ids = [id];
    } else if (mode === "range" && anchor >= 0 && index >= anchor) {
      ids = slides.slice(anchor, index + 1).map((slide) => slide.id);
    }
    updateView({ ...view, slide_id: id, selection: { kind: "deck", slide_ids: ids, shape_ids: [], text_span: null } });
  };

  const onInsert = (shape: DeckShape) => {
    if (!slideId) return;
    setDialog(null);
    commit([{ kind: "add_shape", slide_id: slideId, shape }]);
  };

  return (
    <ViewerFrame
      ribbon={
        <DeckHeader
          title={document.info.name}
          active={active}
          state={state}
          view={view}
          ctx={ctx}
          commands={commands}
          onView={updateView}
          onSave={() => { if (canSave) void document.save().catch((caught) => setError(caught)); }}
          onUndo={() => { void controller.undo().catch((caught) => setError(caught)); }}
          onRedo={() => { void controller.redo().catch((caught) => setError(caught)); }}
          onShare={(action) => {
            if (action === "copyPath") deckEditorHost()?.copyPath();
            else if (action === "saveCopy") deckEditorHost()?.saveCopy();
            else openDialog("export");
          }}
          onOpenHelp={onOpenHelp}
        />
      }
    >
      <div className="adp-deck-editor">
        {view.slides_open ? (
          <SlideStrip
            slides={slides}
            selectedIds={selection?.slide_ids ?? []}
            activeSlideId={slideId}
            width={stripWidth}
            onResize={setStripWidth}
            onSelect={onSelectSlide}
            onReorder={(id, beforeId) => commit([{ kind: "move_slides", slide_ids: [id], before_id: beforeId }])}
            onOpenHelp={onOpenHelp}
          />
        ) : null}
        <div className="adp-deck-center">
          <DeckShapeTools disabled={!canMutate} onInsert={onInsert} onOpenDialog={setDialog} onOpenHelp={onOpenHelp} />
          <DeckTextControls
            formatting={formatting}
            disabled={!canMutate || !selection?.text_span || !selection.shape_ids[0]}
            onText={(patch) => { if (selection?.text_span && selection.shape_ids[0] && slideId) transaction([{ kind: "format_text", slide_id: slideId, shape_id: selection.shape_ids[0], span: selection.text_span, patch }]); }}
            onParagraph={(patch) => { if (selection?.text_span && selection.shape_ids[0] && slideId) transaction([{ kind: "format_paragraph", slide_id: slideId, shape_id: selection.shape_ids[0], block_ids: [selection.text_span.anchor.block_id], patch }]); }}
            onTextColor={(color) => { if (selection?.text_span && selection.shape_ids[0] && slideId) transaction([{ kind: "format_text", slide_id: slideId, shape_id: selection.shape_ids[0], span: selection.text_span, patch: { foreground: color } }]); }}
            onFont={(family) => { if (selection?.text_span && selection.shape_ids[0] && slideId) transaction([{ kind: "format_text", slide_id: slideId, shape_id: selection.shape_ids[0], span: selection.text_span, patch: { font: { family, source: "installed", embeddable: false } } }]); }}
            onSize={(size) => { if (selection?.text_span && selection.shape_ids[0] && slideId) transaction([{ kind: "format_text", slide_id: slideId, shape_id: selection.shape_ids[0], span: selection.text_span, patch: { size_pt: size } }]); }}
            onOpenHelp={onOpenHelp}
          />
          <SlideCanvas
            controller={controller}
            active={active}
            slideId={slideId}
            revision={state.revision}
            selection={selection}
            viewport={view.viewport}
            previewOnly={previewOnly}
            snap={view.snap}
            onViewport={(viewport) => updateView({ ...view, viewport })}
            onSelection={(next: DeckSelection) => updateView({ ...view, slide_id: next.slide_ids[0] ?? slideId, selection: next })}
            onShapePatches={(patches: DeckShapePatch[]) => slideId && commit([{ kind: "patch_shapes", slide_id: slideId, patches }])}
            onOpenDialog={setDialog}
            onOpenHelp={onOpenHelp}
          />
          <SlideNotes
            text={selectedSlide?.notes_preview ?? ""}
            open={view.notes_open}
            readOnly={true}
            height={notesHeight}
            onHeight={setNotesHeight}
            onToggle={() => updateView({ ...view, notes_open: !view.notes_open })}
            onCommit={() => undefined}
            onOpenHelp={onOpenHelp}
          />
        </div>
        {view.comments_open ? (
          <aside className="adp-deck-side">
            <DeckComments
              comments={comments}
              selectedId={null}
              author={LOCAL_AUTHOR}
              disabled={!canComment}
              onSelect={() => undefined}
              onAdd={(text) => transaction([{ kind: "comment_add", anchor: selection ?? { kind: "deck", slide_ids: [slideId ?? ""], shape_ids: [], text_span: null }, text, author: LOCAL_AUTHOR }])}
              onReply={(id, text) => transaction([{ kind: "comment_reply", comment_id: id, text, author: LOCAL_AUTHOR }])}
              onResolve={(id, resolved) => transaction([{ kind: "comment_resolve", comment_id: id, resolved }])}
              onDelete={(id) => transaction([{ kind: "comment_delete", comment_id: id }])}
              onClose={() => updateView({ ...view, comments_open: false })}
              onOpenHelp={onOpenHelp}
            />
          </aside>
        ) : null}
      </div>

      <DeckDialogs
        document={document}
        controller={controller}
        state={state}
        view={view}
        theme={theme}
        selection={selection}
        slides={slides}
        slideId={slideId}
        dialog={dialog}
        backstage={backstage}
        publisher={publisher}
        presentOpen={presentOpen}
        presentStart={presentStart}
        imageSnapshot={imageSnapshot}
        busy={busy}
        canMutate={canMutate}
        canComment={canComment}
        canPresent={canPresent}
        canSave={canSave}
        comments={comments}
        onDialog={setDialog}
        onBackstage={setBackstage}
        onPresent={setPresentOpen}
        onError={setError}
        onImage={setImageSnapshot}
        onBusy={setBusy}
        onCommit={transaction}
        onOpenHelp={onOpenHelp}
      />
    </ViewerFrame>
  );
}

/** Source-aware adapter (09a `VirtualViewProps`). It forwards the actual
 * DocumentHandle; a virtual source never becomes a fabricated disk path. */
export function VirtualDeckEditor(props: import("../../documents/types").VirtualViewProps) {
  return (
    <DeckEditor
      document={props.document}
      active={props.active}
      savedState={normalizeDeckViewState(props.savedState)}
      onStateChange={(state) => props.onStateChange(state as unknown as import("../../documents/types").SerializableViewState)}
      onStatus={props.onStatus}
      onOpenHelp={props.onOpenHelp}
      previewOnly={props.previewOnly}
    />
  );
}

// Re-exported so the coordinator can wire the same registration without a
// second factory path.
export { acquireDeckController };
