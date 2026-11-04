import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { DocumentHandle } from "../../documents/types";
import { errorText } from "../../services/errors";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import type { DeckTemplateInspection } from "../../services/officeDeck";
import { printOffice } from "../../services/officeEdit";
import { pickSavePath } from "../../services/textFiles";
import { canOfficeCommand } from "../officeCompatibility";
import type { OfficeController } from "../OfficeController";
import type {
  DeckOperation, DeckTheme, DeckTransition, OfficeEditComment, OfficeSessionState,
} from "../types";
import DeckBackstage, { type DeckBackstageSection } from "./DeckBackstage";
import DeckComments from "./DeckComments";
import { deckEditorHost } from "./deckCommands";
import { DECK_STYLE_APPLY_HOST_AVAILABLE, saveDeckStyleWithHistory } from "./deckStyleHost";
import { applyDeckTheme, validateDeckTheme } from "./deckThemes";
import type { DeckExportPublisher } from "./deckExport";
import DeckExportDialog from "./DeckExportDialog";
import DeckInsertDialogs, { type DeckInsertDialogId } from "./DeckInsertDialogs";
import DeckLayoutPicker from "./DeckLayoutPicker";
import DeckMasterEditor from "./DeckMasterEditor";
import DeckAnimations, { animationTransaction, removeAnimationTransaction } from "./DeckAnimations";
import DeckTransitions, { transitionTransaction } from "./DeckTransitions";
import type { DeckDialogId, DeckEditorViewState, DeckSelection } from "./deckUiTypes";
import { DeckPresentDialog } from "./PresentationControls";
import type { DeckSlideSummary } from "./SlideStrip";
import { DeckStyleLibrary } from "./styles/DeckStyleLibrary";
import { exportStyleFile, importStyleFile } from "./styles/styleImport";
import { StyleImportDialog } from "./styles/StyleImportDialog";
import type { DeckStyle } from "./styles/styleTypes";
import { inspectDeckTemplate } from "./deckThemeImport";

export interface DeckDialogsProps {
  document: DocumentHandle;
  controller: OfficeController;
  state: OfficeSessionState;
  view: DeckEditorViewState;
  theme: DeckTheme | null;
  selection: DeckSelection | null;
  slides: readonly DeckSlideSummary[];
  slideId: string | null;
  dialog: DeckDialogId | null;
  backstage: DeckBackstageSection | null;
  publisher: DeckExportPublisher | null;
  presentOpen: boolean;
  presentStart: "first" | "current" | "presenter" | "display";
  imageSnapshot: ExportSnapshot | null;
  busy: boolean;
  canMutate: boolean;
  canComment: boolean;
  canPresent: boolean;
  canSave: boolean;
  comments: readonly OfficeEditComment[];
  onDialog: (id: DeckDialogId | null) => void;
  onBackstage: (section: DeckBackstageSection | null) => void;
  onPresent: (open: boolean) => void;
  onError: (error: unknown) => void;
  onImage: (snapshot: ExportSnapshot | null) => void;
  onBusy: (busy: boolean) => void;
  onCommit: (operations: DeckOperation[]) => void;
  onOpenHelp: (slug: string) => void;
}

/** Every deck dialog in one place. The editor owns state and transactions;
 * this component only renders the current dialog and forwards typed edits. */
export default function DeckDialogs(props: DeckDialogsProps) {
  const {
    controller, state, view, theme, selection, slides, slideId, dialog, backstage,
    publisher, presentOpen, presentStart, imageSnapshot, busy, canMutate, canComment, canPresent, canSave,
    comments, onDialog, onBackstage, onPresent, onError, onImage, onBusy, onCommit, onOpenHelp,
  } = props;
  const ids = selection?.slide_ids ?? (slideId ? [slideId] : []);
  const { t } = useTranslation();
  const [styleInspection, setStyleInspection] = useState<DeckTemplateInspection | null>(null);
  const [styleImportError, setStyleImportError] = useState<unknown>(null);
  const [styleLibraryKey, setStyleLibraryKey] = useState(0);
  const canPickStyleInput = typeof deckEditorHost()?.pickDeckStyleInput === "function";
  const slideIndexes = slides.filter((slide) => selection?.slide_ids.includes(slide.id)).map((slide) => slide.index);
  const canExportPdf = publisher !== null && canOfficeCommand(state, "export_pdf", false).enabled;
  const canExportImages = publisher !== null && canOfficeCommand(state, "export_images", false).enabled;
  const canPrint = canOfficeCommand(state, "print", false).enabled;

  /** E5 exchange. The pickers belong to the app host; until it registers
   * them the library's import buttons stay disabled and nothing fakes an
   * inspection or a path. */
  const requestStyleImport = async (kind: "template" | "file") => {
    const pick = deckEditorHost()?.pickDeckStyleInput;
    if (!pick) return;
    const input = await pick(kind);
    if (!input) return;
    if (kind === "template") {
      const job = await inspectDeckTemplate(input);
      const inspection = await job.completion;
      setStyleImportError(null);
      setStyleInspection(inspection);
      return;
    }
    const style = await importStyleFile(input);
    await saveDeckStyleWithHistory(style);
  };

  const requestStyleExport = async (style: DeckStyle) => {
    const destPath = await pickSavePath(t("deckStyle.export"), "style.adp-deck-style", t("deckStyle.title"));
    if (!destPath) return;
    await exportStyleFile(style.id, destPath);
  };

  const finishStyleImport = async (style: DeckStyle) => {
    try {
      await saveDeckStyleWithHistory(style);
      setStyleInspection(null);
      setStyleImportError(null);
      // Re-read the catalog under the open library without moving focus.
      setStyleLibraryKey((value) => value + 1);
    } catch (caught) {
      setStyleImportError(caught);
    }
  };

  return (
    <>
      {dialog === "shape" || dialog === "image" || dialog === "table" || dialog === "chart" ? (
        <DeckInsertDialogs
          dialog={dialog as DeckInsertDialogId}
          snapshot={imageSnapshot}
          disabled={!canMutate}
          onInsert={(shape) => { onDialog(null); if (slideId) onCommit([{ kind: "add_shape", slide_id: slideId, shape }]); }}
          onPickImage={() => { void deckEditorHost()?.pickImage().then(onImage).catch(onError); }}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "layout" ? (
        <DeckLayoutPicker
          theme={theme}
          slideIds={ids}
          disabled={!canMutate}
          onApply={(layoutId) => { onDialog(null); onCommit([{ kind: "apply_layout", slide_ids: ids, layout_id: layoutId, preserve_content: true }]); }}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "theme" && theme ? (
        <DeckMasterEditor
          mode="theme"
          theme={theme}
          slideIds={selection ? selection.slide_ids : null}
          disabled={!canMutate}
          onApply={(next) => {
            onDialog(null);
            if (validateDeckTheme(next)) void applyDeckTheme(controller, next, selection ? selection.slide_ids : null).catch(onError);
          }}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "styleLibrary" ? (
        <div
          className="adp-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onDialog(null);
          }}
        >
          <DeckStyleLibrary
            refreshToken={styleLibraryKey}
            applyAvailable={DECK_STYLE_APPLY_HOST_AVAILABLE}
            controller={controller}
            selectedSlideIds={ids}
            onClose={() => onDialog(null)}
            onOpenHelp={onOpenHelp}
            onRequestImport={canPickStyleInput ? requestStyleImport : undefined}
            onRequestExport={requestStyleExport}
          />
        </div>
      ) : null}
      {styleInspection ? (
        <div
          className="adp-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setStyleInspection(null);
              setStyleImportError(null);
            }
          }}
        >
          <div style={{ width: "min(480px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflow: "auto" }}>
            <StyleImportDialog
              inspection={styleInspection}
              onClose={() => {
                setStyleInspection(null);
                setStyleImportError(null);
              }}
              onImported={(style) => { void finishStyleImport(style); }}
              onOpenHelp={onOpenHelp}
            />
            {styleImportError ? (
              <p className="adp-deck-style-import-error" role="alert">
                {errorText(t, styleImportError, "deck_style")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {dialog === "transition" ? (
        <DeckTransitions
          transition={{ kind: "none", duration_ms: 0, advance_on_click: true, advance_after_ms: null }}
          slideIds={ids}
          disabled={!canMutate}
          onApply={(transition: DeckTransition) => { onDialog(null); void transitionTransaction(controller, transition, ids).catch(onError); }}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "animation" ? (
        <DeckAnimations
          animation={null}
          animationId={null}
          hasSelection={Boolean(selection?.shape_ids.length)}
          currentIds={new Set<string>()}
          disabled={!canMutate}
          onApply={(animation) => {
            if (!selection) return;
            onDialog(null);
            void animationTransaction(controller, selection, crypto.randomUUID(), animation).catch(onError);
          }}
          onRemove={(id) => { if (selection) { onDialog(null); void removeAnimationTransaction(controller, selection, id).catch(onError); } }}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "comment" ? (
        <DeckComments
          comments={comments}
          selectedId={null}
          author="Local user"
          disabled={!canComment}
          onSelect={() => undefined}
          onAdd={(text) => onCommit([{
            kind: "comment_add",
            anchor: selection ?? { kind: "deck", slide_ids: [slideId ?? ""], shape_ids: [], text_span: null },
            text, author: "Local user",
          }])}
          onReply={(id, text) => onCommit([{ kind: "comment_reply", comment_id: id, text, author: "Local user" }])}
          onResolve={(id, resolved) => onCommit([{ kind: "comment_resolve", comment_id: id, resolved }])}
          onDelete={(id) => onCommit([{ kind: "comment_delete", comment_id: id }])}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "export" && publisher ? (
        <DeckExportDialog
          controller={controller}
          publisher={publisher}
          initialFormat="pdf"
          slideCount={slides.length}
          selectedSlideIndexes={slideIndexes}
          canExportPdf={canExportPdf}
          canExportImages={canExportImages}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "print" && canPrint ? (
        <PrintDialog controller={controller} slideCount={slides.length} busy={busy} onBusy={onBusy} onClose={() => onDialog(null)} onError={onError} />
      ) : null}
      {dialog === "pageSetup" && theme ? (
        <PageSetupDialog
          theme={theme}
          onApply={(next) => { onDialog(null); void applyDeckTheme(controller, next, null).catch(onError); }}
          onClose={() => onDialog(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {backstage || dialog === "properties" || dialog === "compatibility" ? (
        <DeckBackstage
          section={backstage ?? (dialog === "compatibility" ? "compatibility" : "properties")}
          onSection={onBackstage}
          onClose={() => { onBackstage(null); onDialog(null); }}
          document={props.document}
          state={state}
          view={view}
          onSave={() => { if (canSave) void props.document.save(); }}
          onSaveCopy={() => deckEditorHost()?.saveCopy()}
          onExportPdf={() => { if (canExportPdf) { onBackstage(null); onDialog("export"); } }}
          onExportImages={() => { if (canExportImages) { onBackstage(null); onDialog("export"); } }}
          onPrint={() => { if (canPrint) { onBackstage(null); onDialog("print"); } }}
          canSave={canSave}
          canExportPdf={canExportPdf}
          canExportImages={canExportImages}
          canPrint={canPrint}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
      {dialog === "notes" ? null : null}
      {presentOpen && canPresent ? (
        <DeckPresentDialog
          controller={controller}
          visibleSlideIds={slides.filter((slide) => !slide.hidden).map((slide) => slide.id)}
          currentSlideId={slideId}
          notes={slides.find((slide) => slide.id === slideId)?.notes_preview ?? ""}
          startMode={presentStart}
          onClose={() => onPresent(false)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
    </>
  );
}

function PrintDialog(props: {
  controller: OfficeController; slideCount: number; busy: boolean;
  onBusy: (busy: boolean) => void; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const print = async () => {
    props.onBusy(true);
    try {
      const state = props.controller.getState();
      const job = await printOffice(props.controller.session_id, state.revision, [{ first: 1, last: Math.max(1, Math.min(100, props.slideCount)) }]);
      await job.completion;
      props.onClose();
    } catch (caught) {
      props.onError(caught);
    } finally {
      props.onBusy(false);
    }
  };
  return (
    <Dialog title={t("officeDeck.print")} onClose={props.onClose} className="adp-deck-dialog">
      <p>{t("officeDeck.printExplanation")}</p>
      <footer className="adp-deck-dialog-footer">
        <Button onClick={props.onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={props.busy} onClick={() => { void print(); }}>{t("officeDeck.printAction")}</Button>
      </footer>
    </Dialog>
  );
}

function PageSetupDialog(props: {
  theme: DeckTheme; onApply: (theme: DeckTheme) => void; onClose: () => void; onOpenHelp: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(String(props.theme.slide_width_pt));
  const [height, setHeight] = useState(String(props.theme.slide_height_pt));
  const next = { ...props.theme, slide_width_pt: Number(width), slide_height_pt: Number(height) };
  return (
    <Dialog title={t("officeDeck.slideSize")} onClose={props.onClose} className="adp-deck-dialog">
      <p className="adp-deck-hint">{t("officeDeck.overflow")}</p>
      <label className="adp-deck-field"><span>{t("officeDeck.width")}</span>
        <input type="number" min={1} max={14400} value={width} onChange={(event) => setWidth(event.target.value)} /></label>
      <label className="adp-deck-field"><span>{t("officeDeck.height")}</span>
        <input type="number" min={1} max={14400} value={height} onChange={(event) => setHeight(event.target.value)} /></label>
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => props.onOpenHelp("deck-layouts-and-themes")}>{t("help.title")}</button>
        <span className="adp-deck-header-spacer" />
        <Button onClick={props.onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!validateDeckTheme(next)} onClick={() => props.onApply(next)}>{t("officeDeck.applyTheme")}</Button>
      </footer>
    </Dialog>
  );
}
