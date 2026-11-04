import {
  FormInput,
  MessagesSquare,
  Save,
} from "lucide-react";
import type { TFunction } from "i18next";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../components/Skeleton";
import type { VirtualViewProps } from "../documents/types";
import { pdfInversePoint, pdfRunBox, pdfViewportPoint, pdfViewportSize } from "../handlers/pdf/pdfCoordinates";
import Ribbon from "../ribbon/Ribbon";
import type { RibbonDef, RibbonGroup } from "../ribbon/types";
import { releaseCacheLease } from "../services/cache";
import { errorCode } from "../services/errors";
import { fileUrl } from "../services/files";
import {
  closePdf,
  openPdfInput,
  renderPdfPage,
  type PdfPageImage,
  type PdfSession,
} from "../services/pdf";
import { isTauriRuntime } from "../services/settings";
import { pickSavePath } from "../services/textFiles";
import { createPdfEditCommands, type PdfEditActions, type PdfEditCommandContext } from "./commands";
import FormFields from "./FormFields";
import PageToolsDialog from "./PageToolsDialog";
import SignatureDialog from "./SignatureDialog";
import { pdfCommentThreads, createPdfReply, canRemovePdfComment } from "./comments";
import { pdfEditRegistry, type PdfEditController } from "./PdfEditRegistry";
import { createPdfSignatureAnnotation, uploadSignatureImage } from "./signature";
import { pdfPageLabel } from "./pages";
import { newPdfEditId, pdfRectUnion, type PdfAnnotation, type PdfColor, type PdfEditModel, type PdfEditOperation, type PdfFormValueValue, type PdfPoint, type PdfRect, type PdfRotation } from "./types";
import type { PdfSignatureDraft } from "./signature";

/** Editable PDF presenter (Step 14a E4).
 *
 * The visual page is the 07d render of an immutable snapshot; annotations
 * are an overlay in page coordinates. All mutations go through the shared
 * `PdfEditController`, so two views of the same document see one model. The
 * ribbon commands are created by the coordinator from `commands.ts`. */

const SWATCHES: Array<{ key: string; labelKey: string; color: PdfColor; opacity: number }> = [
  { key: "yellow", labelKey: "pdfTools.colorYellow", color: [1, 0.84, 0, 1], opacity: 0.45 },
  { key: "green", labelKey: "pdfTools.colorGreen", color: [0.13, 0.62, 0.32, 1], opacity: 0.4 },
  { key: "blue", labelKey: "pdfTools.colorBlue", color: [0.08, 0.42, 0.78, 1], opacity: 0.35 },
  { key: "red", labelKey: "pdfTools.colorRed", color: [0.85, 0.16, 0.19, 1], opacity: 0.4 },
];

function annotationLabel(t: TFunction, annotation: PdfAnnotation): string {
  const key =
    annotation.kind === "highlight"
      ? "pdfTools.highlight"
      : annotation.kind === "ink"
        ? "pdfTools.draw"
        : annotation.kind === "text"
          ? "pdfTools.text"
          : annotation.kind === "comment"
            ? "pdfTools.comment"
            : "pdfTools.sign";
  return annotation.text || t(key);
}

/** Document color data, not theme chrome: an annotation keeps its own color
 * with its own opacity on every theme. */
function annotationColor(annotation: PdfAnnotation): string {
  const [red, green, blue] = annotation.color;
  return `rgba(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)},${Math.max(0, Math.min(1, annotation.opacity))})`;
}
const INK_COLOR: PdfColor = [0.12, 0.12, 0.12, 1];

type Tool = "highlight" | "draw" | "text" | "comment" | "sign" | null;

export interface PdfEditorProps extends VirtualViewProps {
  /** Visible comment author from Settings; empty uses the Anonymous label. */
  author?: string;
  onSave?: () => Promise<boolean>;
  onSaveCopy?: () => Promise<boolean>;
  onSplit?: (ranges: Array<{ first: number; last: number }>) => Promise<void>;
  onMerge?: () => void;
  onInsert?: () => void;
}

function pdfEditErrorText(t: TFunction, error: unknown): string {
  return errorCode(error) === "pdf_edit.missing_glyph" ? t("errors.pdf_edit.missing_glyph") : t("errors.pdf_edit.failed");
}

function clampRect(rect: PdfRect, crop: PdfRect): PdfRect {
  const x1 = Math.min(crop.x + crop.width, Math.max(crop.x, rect.x));
  const y1 = Math.min(crop.y + crop.height, Math.max(crop.y, rect.y));
  const x2 = Math.min(crop.x + crop.width, Math.max(crop.x, rect.x + rect.width));
  const y2 = Math.min(crop.y + crop.height, Math.max(crop.y, rect.y + rect.height));
  return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
}

export default function PdfEditor({
  document: doc,
  active,
  savedState,
  onStateChange,
  onStatus,
  previewOnly,
  onOpenHelp,
  author = "",
  onSave,
  onSaveCopy,
  onSplit,
  onMerge,
  onInsert,
}: PdfEditorProps) {
  const { t } = useTranslation();
  const initial = (savedState ?? {}) as { page?: unknown; zoom?: unknown };
  const [controller, setController] = useState<PdfEditController | null>(null);
  const [model, setModel] = useState<Readonly<PdfEditModel> | null>(null);
  const [pageIndex, setPageIndex] = useState(typeof initial.page === "number" ? Math.max(0, initial.page - 1) : 0);
  const [zoom, setZoom] = useState(typeof initial.zoom === "number" ? Math.min(400, Math.max(10, initial.zoom)) : 100);
  const [tool, setTool] = useState<Tool>(null);
  const [swatch, setSwatch] = useState(SWATCHES[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stroke, setStroke] = useState<PdfPoint[] | null>(null);
  const [pending, setPending] = useState<{ kind: "text" | "comment"; point: PdfPoint } | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [signaturePoint, setSignaturePoint] = useState<PdfPoint | null>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [formsOpen, setFormsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [pageSelection, setPageSelection] = useState<string[]>([]);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [editText, setEditText] = useState("");
  const [editSize, setEditSize] = useState(12);
  const [session, setSession] = useState<PdfSession | null>(null);
  const [image, setImage] = useState<PdfPageImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setDocumentVersion] = useState(0);
  const revision = useRef(0);
  const imageRef = useRef<PdfPageImage | null>(null);
  const controllerRef = useRef<PdfEditController | null>(null);
  imageRef.current = image;
  controllerRef.current = controller;

  const page = model?.pages[Math.min(pageIndex, Math.max(0, (model?.pages.length ?? 1) - 1))];
  const pageCount = model?.pages.length ?? 0;
  const isForeignPage = Boolean(page && model && page.origin_source.snapshot_id !== model.source_snapshot.snapshot_id);
  const visualRotation: PdfRotation = image?.rendered_rotation ?? page?.rotation ?? 0;
  const viewport = image ? pdfViewportSize(image.info, zoom, visualRotation) : { width: 0, height: 0 };

  useEffect(() => doc.subscribe(() => setDocumentVersion((value) => value + 1)), [doc]);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | null = null;
    pdfEditRegistry
      .acquirePdfEditor(doc)
      .then((next) => {
        if (!alive) {
          next.release();
          return;
        }
        setController(next);
        setModel(next.getModel());
        unsubscribe = next.subscribe((value) => setModel(value));
        if (!previewOnly && !doc.info.read_only && (!doc.info.sensitive || next.getCapabilities().sensitive_memory_only)) {
          next.setEditingEnabled(true);
        }
      })
      .catch((cause) => {
        if (alive) setError(pdfEditErrorText(t, cause));
      });
    return () => {
      alive = false;
      unsubscribe?.();
      controllerRef.current?.release();
      controllerRef.current = null;
    };
  }, [doc, previewOnly]);

  useEffect(() => {
    if (!model || !isTauriRuntime()) return;
    let alive = true;
    let sessionId: string | null = null;
    void (async () => {
      const snapshot = await doc.captureSnapshot();
      const job = await openPdfInput({
        kind: "snapshot",
        reference: {
          snapshot_id: snapshot.snapshot_id,
          document_id: snapshot.document_id,
          revision: snapshot.revision,
          content_id: snapshot.content_id,
        },
      });
      const next = await job.completion;
      if (!alive) {
        await closePdf(next.session_id);
        return;
      }
      sessionId = next.session_id;
      setSession(next);
    })().catch((cause) => {
      if (alive) setError(pdfEditErrorText(t, cause));
    });
    return () => {
      alive = false;
      if (sessionId) void closePdf(sessionId);
    };
  }, [doc, model?.source_snapshot.snapshot_id, model?.source_snapshot.revision]);

  useEffect(() => {
    if (!active || !session || !page || isForeignPage) {
      if (!active) {
        setImage((previous) => {
          if (previous) void releaseCacheLease(previous.image.lease_id);
          return null;
        });
      }
      return;
    }
    let alive = true;
    revision.current += 1;
    const current = revision.current;
    const job = renderPdfPage({
      session_id: session.session_id,
      page: page.origin_page,
      raster: { kind: "bucket", edge: 1024 },
      rotation: page.rotation,
      request_revision: current,
    });
    void job
      .then((handle) => handle.completion)
      .then((next) => {
        if (!alive) {
          void releaseCacheLease(next.image.lease_id);
          return;
        }
        setImage((previous) => {
          if (previous) void releaseCacheLease(previous.image.lease_id);
          return next;
        });
      })
      .catch(() => {
        if (alive) setImage(null);
      });
    return () => {
      alive = false;
      void job.then((handle) => handle.cancel()).catch(() => undefined);
    };
  }, [active, session, page?.id, page?.origin_page, page?.rotation, isForeignPage]);

  useEffect(() => {
    return () => {
      const current = imageRef.current;
      if (current) void releaseCacheLease(current.image.lease_id);
    };
  }, []);

  useEffect(() => {
    if (pageCount === 0) return;
    onStateChange({ page: Math.min(pageIndex + 1, pageCount), zoom });
    onStatus({
      items: [t("pdf.page", { page: Math.min(pageIndex + 1, pageCount), count: pageCount })],
      zoom: { percent: zoom, min: 10, max: 400, set: setZoom, fit: () => setZoom(100) },
    });
  }, [pageCount, onStateChange, onStatus, pageIndex, t, zoom]);

  const apply = useCallback(
    async (operation: PdfEditOperation) => {
      if (!controller) return;
      setBusy(true);
      setError(null);
      try {
        await controller.apply(operation);
      } catch (cause) {
        setError(pdfEditErrorText(t, cause));
      } finally {
        setBusy(false);
      }
    },
    [controller, t],
  );

  const pointAt = (event: ReactPointerEvent<HTMLDivElement>): PdfPoint | null => {
    if (!image || !page) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    // The 07d inverse matrix returns CropBox-local top-left points, which is
    // exactly the model's coordinate space. Never add the CropBox origin.
    return pdfInversePoint(event.clientX - bounds.left, event.clientY - bounds.top, image.info, zoom, visualRotation);
  };

  const localCrop = (target: typeof page): PdfRect =>
    target ? { x: 0, y: 0, width: target.crop.width, height: target.crop.height } : { x: 0, y: 0, width: 1, height: 1 };

  const addAnnotation = (annotation: PdfAnnotation) => void apply({ kind: "add_annotation", annotation });

  const createAt = (point: PdfPoint) => {
    if (!page || !model) return;
    const createdAt = Math.floor(Date.now() / 1000);
    const common = {
      page_id: page.id,
      author: author || t("pdfTools.anonymous"),
      created_unix: createdAt,
    };
    if (tool === "highlight") {
      const rect = clampRect({ x: point.x, y: point.y, width: 40, height: 10 }, localCrop(page));
      addAnnotation({
        id: newPdfEditId(),
        kind: "highlight",
        rect,
        quads: [[{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }]],
        color: swatch.color,
        opacity: swatch.opacity,
        text: "",
        ...common,
      });
      setTool(null);
      return;
    }
    if (tool === "text" || tool === "comment") {
      setPending({ kind: tool, point });
      setPendingText("");
      return;
    }
    if (tool === "sign") {
      setSignaturePoint(point);
    }
  };

  const commitPending = () => {
    if (!pending || !page || pendingText.trim().length === 0) return;
    const rect = clampRect(
      pending.kind === "text"
        ? { x: pending.point.x, y: pending.point.y, width: 160, height: 48 }
        : { x: pending.point.x, y: pending.point.y, width: 20, height: 20 },
      localCrop(page),
    );
    const annotation: PdfAnnotation = {
      id: newPdfEditId(),
      page_id: page.id,
      kind: pending.kind,
      rect,
      color: swatch.color,
      opacity: 1,
      author: author || t("pdfTools.anonymous"),
      created_unix: Math.floor(Date.now() / 1000),
      text: pendingText,
    };
    if (pending.kind === "text") annotation.font_size = 12;
    addAnnotation(annotation);
    setPending(null);
    setPendingText("");
    setTool(null);
  };

  const commitStroke = () => {
    if (!stroke || stroke.length < 2 || !page) return;
    const rect = clampRect(pdfRectUnion(stroke), localCrop(page));
    addAnnotation({
      id: newPdfEditId(),
      page_id: page.id,
      kind: "ink",
      rect,
      strokes: [stroke],
      color: INK_COLOR,
      opacity: 1,
      author: author || t("pdfTools.anonymous"),
      created_unix: Math.floor(Date.now() / 1000),
      text: "",
    });
    setStroke(null);
  };

  const applySignature = async (draft: PdfSignatureDraft) => {
    if (!signaturePoint || !page) return;
    const rect = clampRect({ x: signaturePoint.x, y: signaturePoint.y, width: 160, height: 60 }, localCrop(page));
    try {
      const imageSnapshot = draft.image ? await uploadSignatureImage(draft.image) : undefined;
      const annotation = createPdfSignatureAnnotation(draft, {
        pageId: page.id,
        rect,
        author,
        anonymousLabel: t("pdfTools.anonymous"),
        createdUnix: Math.floor(Date.now() / 1000),
        color: [0.06, 0.18, 0.5, 1],
        opacity: 1,
        imageSnapshot,
      });
      await apply({ kind: "add_annotation", annotation });
    } catch (cause) {
      setError(pdfEditErrorText(t, cause));
    } finally {
      setSignaturePoint(null);
    }
  };

  const deleteSelected = () => {
    if (!selected || !model) return;
    const target = model.annotations.find((annotation) => annotation.id === selected);
    if (target?.kind === "comment" && !canRemovePdfComment(model.annotations, selected)) {
      setError(t("errors.pdf_edit.failed"));
      return;
    }
    void apply({ kind: "remove_annotation", id: selected });
    setSelected(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "Escape") {
      if (stroke) setStroke(null);
      else if (pending) setPending(null);
      else if (tool) setTool(null);
      else setSelected(null);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      deleteSelected();
    }
  };

  const threads = useMemo(() => pdfCommentThreads(model?.annotations ?? []), [model?.annotations]);
  const pageAnnotations = useMemo(
    () => (model && page ? model.annotations.filter((annotation) => annotation.page_id === page.id) : []),
    [model, page],
  );
  const selectedAnnotation = useMemo(
    () => (model && selected ? model.annotations.find((annotation) => annotation.id === selected) ?? null : null),
    [model, selected],
  );
  useEffect(() => {
    if (!selectedAnnotation) return;
    setEditText(selectedAnnotation.text);
    setEditSize(selectedAnnotation.font_size ?? 12);
  }, [selectedAnnotation?.id]);
  const sensitiveBlocked = Boolean(doc.info.sensitive && !controller?.getCapabilities().sensitive_memory_only);
  const canEdit = Boolean(
    controller &&
      model &&
      !previewOnly &&
      !doc.info.read_only &&
      !doc.getState().read_only_reason &&
      !sensitiveBlocked,
  );
  const capabilities = controller?.getCapabilities();
  // A signed or XFA PDF is copy-only: changing it in place would invalidate
  // an existing signature or risk unsupported form content.
  const canSaveExisting = Boolean(
    onSave &&
      doc.getState().can_save_existing &&
      !capabilities?.signature_present &&
      !capabilities?.xfa_present,
  );

  const runController = (action: (() => Promise<void>) | undefined) => {
    if (action) void action().catch((cause) => setError(pdfEditErrorText(t, cause)));
  };
  const runSave = (action: (() => Promise<boolean>) | undefined) => {
    if (action) void action().catch((cause) => setError(pdfEditErrorText(t, cause)));
  };
  const undo = () => runController(controller ? () => controller.undo() : undefined);
  const redo = () => runController(controller ? () => controller.redo() : undefined);
  const save = () => runSave(onSave);
  // Save stays copy-only: no existing-file save is offered until 09f proves
  // replacement. The host may supply its own copy action; the default asks
  // for a destination and commits through the 09a copy path.
  const saveCopy = () => {
    if (onSaveCopy) {
      runSave(onSaveCopy);
      return;
    }
    void (async () => {
      try {
        const path = await pickSavePath(t("editor.saveAsTitle"), doc.info.name, t("editor.allFiles"));
        if (!path) return;
        const saved = await doc.saveCopy(path);
        if (!saved) setError(t("errors.pdf_edit.failed"));
      } catch (cause) {
        setError(pdfEditErrorText(t, cause));
      }
    })();
  };

  const rotateSelection = () => {
    const ids = pageSelection.length > 0 ? [...pageSelection] : page ? [page.id] : [];
    if (ids.length === 0) return;
    void apply({ kind: "rotate_pages", ids, quarter_turns: 1 });
  };
  const deleteSelection = () => {
    if (pageSelection.length === 0) return;
    // Deleting pages always goes through the page tools confirmation; the
    // ribbon never removes pages without showing the affected count.
    setPagesOpen(true);
  };
  // The ribbon reads the same controller state as the compact toolbar; the
  // page menu opens the existing page tools dialog, so split/insert/merge
  // keep their single implementation.
  const editActions: PdfEditActions = {
    setTool: (next) => setTool(next),
    openPages: () => setPagesOpen(true),
    openMerge: () => setPagesOpen(true),
    openSplit: () => setPagesOpen(true),
    openInsert: () => setPagesOpen(true),
    rotateSelection,
    deleteSelection,
    undo,
    redo,
  };
  const commandContext: PdfEditCommandContext = {
    ready: Boolean(model && page),
    editing: canEdit,
    previewOnly,
    busy,
    tool,
    selection: selected,
    pageSelection,
    canUndo: (model?.history.cursor ?? 0) > 0,
    canRedo: Boolean(model && model.history.cursor < model.history.entries.length),
  };
  const commands = createPdfEditCommands(editActions);
  const ribbonGroups: RibbonGroup[] = [
    {
      id: "markup",
      labelKey: "pdfTools.highlight",
      controls: [
        { type: "toggle", command: "pdf.highlight" },
        { type: "toggle", command: "pdf.draw" },
        { type: "toggle", command: "pdf.text" },
        { type: "toggle", command: "pdf.comment" },
        { type: "toggle", command: "pdf.sign" },
      ],
    },
    {
      id: "pages",
      labelKey: "pdfTools.pages",
      controls: [
        { type: "button", command: "pdf.pages" },
        { type: "button", command: "pdf.rotate" },
        { type: "button", command: "pdf.delete" },
        { type: "button", command: "pdf.insert" },
        { type: "button", command: "pdf.merge" },
        { type: "button", command: "pdf.split" },
      ],
    },
    {
      id: "history",
      labelKey: "commands.undo",
      controls: [
        { type: "button", command: "pdf.undo" },
        { type: "button", command: "pdf.redo" },
      ],
    },
  ];
  const ribbon: RibbonDef = {
    tabs: [{ id: "edit", labelKey: "handlers.pdf", keyTip: "E", groups: ribbonGroups }],
  };

  if (error && !model) {
    return (
      <div className="adp-pdf-edit" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  if (!model) return <Skeleton variant="rows" count={3} />;

  return (
    <div className="adp-pdf-edit" onKeyDown={onKeyDown} tabIndex={0} aria-label={t("handlers.pdf")}>
      <Ribbon def={ribbon} ctx={commandContext} commands={commands} accent="pdf" active={active} />
      <div className="adp-pdf-edit-toolbar" role="toolbar" aria-label={t("handlers.pdf")}>
        {SWATCHES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={swatch.key === entry.key ? "adp-pdf-edit-swatch adp-pdf-edit-swatch--active" : "adp-pdf-edit-swatch"}
            style={{ background: `rgb(${entry.color[0] * 255},${entry.color[1] * 255},${entry.color[2] * 255})` }}
            aria-label={t(entry.labelKey)}
            aria-pressed={swatch.key === entry.key}
            onClick={() => setSwatch(entry)}
          />
        ))}
        <span className="adp-pdf-edit-separator" aria-hidden="true" />
        <button type="button" className="adp-icon-btn" aria-label={t("pdfTools.forms")} title={t("pdfTools.forms")} disabled={!canEdit} onClick={() => setFormsOpen(!formsOpen)}>
          <FormInput size={16} aria-hidden="true" />
        </button>
        <button type="button" className="adp-icon-btn" aria-label={t("pdfTools.comment")} title={t("pdfTools.comment")} onClick={() => setCommentsOpen(!commentsOpen)}>
          <MessagesSquare size={16} aria-hidden="true" />
        </button>
        <span className="adp-pdf-edit-spacer" />
        <button type="button" className="adp-icon-btn" aria-label={t("help.title")} title={t("help.title")} onClick={() => onOpenHelp("pdf-annotations")}>
          ?
        </button>
        <button type="button" className="adp-btn adp-btn--subtle" disabled={!model || previewOnly || !doc.getState().can_save_copy} onClick={saveCopy}>
          {t("common.saveCopy")}
        </button>
        <button type="button" className="adp-btn adp-btn--primary" disabled={!canSaveExisting} onClick={save}>
          <Save size={16} aria-hidden="true" /> {t("common.save")}
        </button>
      </div>
      {controller?.getCapabilities().signature_present ? (
        <p className="adp-pdf-edit-warning" role="note">
          {t("pdfTools.signatureWarning")}
        </p>
      ) : null}
      {error ? <p className="adp-pdf-edit-error" role="alert">{error}</p> : null}
      <div className="adp-pdf-edit-body">
        <div className="adp-pdf-edit-canvas">
          {isForeignPage ? (
            <p className="adp-pdf-edit-note">{t("pdfTools.pages")}</p>
          ) : image ? (
            <div
              className="adp-pdf-edit-page"
              style={{ width: viewport.width, height: viewport.height }}
              onPointerDown={(event) => {
                if (!canEdit || busy) return;
                const point = pointAt(event);
                if (!point) return;
                if (tool === "draw") {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setStroke([point]);
                } else if (tool) {
                  createAt(point);
                }
              }}
              onPointerMove={(event) => {
                if (!stroke) return;
                const point = pointAt(event);
                if (point) setStroke([...stroke, point]);
              }}
              onPointerUp={() => commitStroke()}
              onPointerCancel={() => setStroke(null)}
            >
              <img className="adp-pdf-edit-page-image" src={fileUrl(image.image.token, image.image.name)} alt="" aria-hidden="true" />
              <div className="adp-pdf-overlay">
                <svg className="adp-pdf-annotation-strokes" width={viewport.width} height={viewport.height} aria-hidden="true">
                  {pageAnnotations
                    .filter((annotation) => (annotation.kind === "ink" || annotation.kind === "signature") && annotation.strokes)
                    .flatMap((annotation) =>
                      (annotation.strokes ?? []).map((inkStroke, index) => (
                        <polyline
                          key={`${annotation.id}-${index}`}
                          points={inkStroke
                            .map((point) => pdfViewportPoint(point.x, point.y, image.info, zoom, visualRotation))
                            .map((point) => `${point.x},${point.y}`)
                            .join(" ")}
                          style={{ stroke: annotationColor(annotation) }}
                        />
                      )),
                    )}
                </svg>
                {pageAnnotations.map((annotation) => {
                  const box = pdfRunBox(
                    {
                      x: annotation.rect.x,
                      y: annotation.rect.y,
                      width: annotation.rect.width,
                      height: annotation.rect.height,
                    },
                    image.info,
                    zoom,
                    visualRotation,
                  );
                  return (
                    <button
                      key={annotation.id}
                      type="button"
                      className={selected === annotation.id ? "adp-pdf-annotation adp-pdf-annotation--selected" : `adp-pdf-annotation adp-pdf-annotation--${annotation.kind}`}
                      style={{
                        left: box.left,
                        top: box.top,
                        width: box.width,
                        height: box.height,
                        ...(annotation.kind === "highlight" ? { background: annotationColor(annotation) } : {}),
                      }}
                      aria-label={annotationLabel(t, annotation)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(annotation.id);
                      }}
                    >
                      {annotation.kind === "text" || annotation.kind === "comment" || (annotation.kind === "signature" && annotation.text) ? (
                        <span className="adp-pdf-annotation-text">{annotation.text || annotationLabel(t, annotation)}</span>
                      ) : null}
                    </button>
                  );
                })}
                {stroke ? (
                  <svg className="adp-pdf-edit-stroke" width={viewport.width} height={viewport.height} aria-hidden="true">
                    <polyline
                      points={stroke
                        .map((point) => pdfViewportPoint(point.x, point.y, image.info, zoom, visualRotation))
                        .map((point) => `${point.x},${point.y}`)
                        .join(" ")}
                    />
                  </svg>
                ) : null}
              </div>
            </div>
          ) : (
            <Skeleton variant="rows" count={4} />
          )}
          {pending ? (
            <div className="adp-pdf-edit-popover" role="dialog" aria-label={t(pending.kind === "text" ? "pdfTools.text" : "pdfTools.comment")}>
              <textarea className="adp-input adp-pdf-edit-textarea" value={pendingText} maxLength={8_192} onChange={(event) => setPendingText(event.currentTarget.value)} aria-label={t("pdfTools.comment")} />
              <div className="adp-dialog-actions">
                <button type="button" className="adp-btn adp-btn--primary" disabled={pendingText.trim().length === 0} onClick={commitPending}>
                  {t("common.save")}
                </button>
                <button type="button" className="adp-btn adp-btn--subtle" onClick={() => setPending(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : null}
          {selectedAnnotation && !pending ? (
            <div className="adp-pdf-edit-popover" role="dialog" aria-label={annotationLabel(t, selectedAnnotation)}>
              {selectedAnnotation.kind === "text" || selectedAnnotation.kind === "comment" ? (
                <textarea
                  className="adp-input adp-pdf-edit-textarea"
                  value={editText}
                  maxLength={8_192}
                  aria-label={t("pdfTools.text")}
                  onChange={(event) => setEditText(event.currentTarget.value)}
                />
              ) : null}
              {selectedAnnotation.kind === "text" ? (
                <label className="adp-pdf-edit-note">
                  {t("pdfTools.text")}
                  <input
                    className="adp-input adp-pdf-edit-number"
                    type="number"
                    min={6}
                    max={144}
                    value={editSize}
                    onChange={(event) => setEditSize(Math.min(144, Math.max(6, Number(event.currentTarget.value) || 12)))}
                  />
                </label>
              ) : null}
              <div className="adp-pdf-edit-page-actions">
                {SWATCHES.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="adp-pdf-edit-swatch"
                    style={{ background: `rgb(${entry.color[0] * 255},${entry.color[1] * 255},${entry.color[2] * 255})` }}
                    aria-label={t(entry.labelKey)}
                    onClick={() =>
                      void apply({
                        kind: "update_annotation",
                        id: selectedAnnotation.id,
                        replacement: { ...selectedAnnotation, color: entry.color, opacity: entry.opacity },
                      })
                    }
                  />
                ))}
              </div>
              <div className="adp-dialog-actions">
                <button
                  type="button"
                  className="adp-btn adp-btn--primary"
                  onClick={() =>
                    void apply({
                      kind: "update_annotation",
                      id: selectedAnnotation.id,
                      replacement: {
                        ...selectedAnnotation,
                        text: editText,
                        ...(selectedAnnotation.kind === "text" ? { font_size: editSize } : {}),
                      },
                    })
                  }
                >
                  {t("common.save")}
                </button>
                <button type="button" className="adp-btn adp-btn--subtle" onClick={deleteSelected}>
                  {t("common.delete")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {commentsOpen ? (
          <aside className="adp-pdf-comments" aria-label={t("pdfTools.comment")}>
            <div className="adp-pdf-comments-header">
              <h2 className="adp-pdf-comments-title">{t("pdfTools.comment")}</h2>
              <button type="button" className="adp-icon-btn" aria-label={t("common.close")} onClick={() => setCommentsOpen(false)}>
                ×
              </button>
            </div>
            {threads.length === 0 ? <p className="adp-pdf-edit-note">{t("pdfTools.comment")}</p> : null}
            {threads.map((thread) => (
              <div key={thread.root.id} className={selected === thread.root.id ? "adp-pdf-comment adp-pdf-comment--selected" : "adp-pdf-comment"}>
                <button type="button" className="adp-pdf-comment-text" onClick={() => setSelected(thread.root.id)}>
                  {thread.root.author}: {thread.root.text}
                </button>
                {thread.replies.map((reply) => (
                  <p key={reply.id} className="adp-pdf-comment-reply">
                    {reply.author}: {reply.text}
                  </p>
                ))}
                <textarea
                  className="adp-input adp-pdf-edit-textarea"
                  value={replyText[thread.root.id] ?? ""}
                  maxLength={8_192}
                  aria-label={t("pdfTools.reply")}
                  onChange={(event) => setReplyText({ ...replyText, [thread.root.id]: event.currentTarget.value })}
                />
                <button
                  type="button"
                  className="adp-btn adp-btn--subtle"
                  disabled={!canEdit || (replyText[thread.root.id] ?? "").trim().length === 0}
                  onClick={() => {
                    const text = replyText[thread.root.id] ?? "";
                    const reply = createPdfReply(thread.root, { author, createdUnix: Math.floor(Date.now() / 1000), text }, t("pdfTools.anonymous"));
                    addAnnotation(reply);
                    setReplyText({ ...replyText, [thread.root.id]: "" });
                  }}
                >
                  {t("pdfTools.reply")}
                </button>
                {canRemovePdfComment(model.annotations, thread.root.id) ? (
                  <button type="button" className="adp-btn adp-btn--subtle" onClick={() => { setSelected(thread.root.id); deleteSelected(); }}>
                    {t("common.delete")}
                  </button>
                ) : null}
              </div>
            ))}
          </aside>
        ) : null}
        {formsOpen ? (
          <aside className="adp-pdf-forms" aria-label={t("pdfTools.forms")}>
            <FormFields
              values={model.forms}
              options={controller?.getFormOptions() ?? []}
              capabilities={controller?.getCapabilities() ?? { signature_present: false, xfa_present: false, rich_text_fields: [], unsupported_structures: [], sensitive_memory_only: false }}
              disabled={!canEdit}
              onChange={(fieldId: string, value: PdfFormValueValue) => void apply({ kind: "set_form", field_id: fieldId, value })}
            />
          </aside>
        ) : null}
      </div>
      {pagesOpen ? (
        <PageToolsDialog
          pages={model.pages}
          pageLabels={model.pages.map((_, index) => pdfPageLabel(index))}
          selected={pageSelection}
          onSelectionChange={setPageSelection}
          onRotate={(ids, quarterTurns) => void apply({ kind: "rotate_pages", ids: [...ids], quarter_turns: quarterTurns })}
          onReorder={(id, delta) => {
            const ids = model.pages.map((entry) => entry.id);
            const index = ids.indexOf(id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= ids.length) return;
            [ids[index], ids[target]] = [ids[target], ids[index]];
            void apply({ kind: "reorder_pages", ids });
          }}
          onReorderTo={(id, targetIndex) => {
            const ids = model.pages.map((entry) => entry.id);
            const index = ids.indexOf(id);
            if (index < 0 || targetIndex < 0 || targetIndex >= ids.length || index === targetIndex) return;
            const [moved] = ids.splice(index, 1);
            ids.splice(targetIndex, 0, moved);
            void apply({ kind: "reorder_pages", ids });
          }}
          onDelete={(ids) => {
            void apply({ kind: "delete_pages", ids: [...ids] });
            setPageSelection([]);
            setPageIndex(0);
            setSelected(null);
          }}
          onSplit={(ranges) => {
            if (!onSplit) return;
            void onSplit([...ranges]).catch((cause) => setError(pdfEditErrorText(t, cause)));
          }}
          onInsert={() => onInsert?.()}
          onMerge={() => onMerge?.()}
          onClose={() => setPagesOpen(false)}
        />
      ) : null}
      {signaturePoint ? <SignatureDialog onCancel={() => setSignaturePoint(null)} onApply={applySignature} /> : null}
      <span className="adp-pdf-edit-sr" aria-live="polite">
        {busy ? t("pdf.loading") : ""}
      </span>
    </div>
  );
}
