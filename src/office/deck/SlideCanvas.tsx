import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../components/Skeleton";
import { errorText } from "../../services/errors";
import { fileUrl } from "../../services/files";
import { releaseOfficeLease } from "../../services/officeEdit";
import type { OfficeController } from "../OfficeController";
import type { DeckShapePatch, OfficeAccessibleNode, OfficeRect, OfficeRenderPage, OfficeViewport } from "../types";
import { CANVAS_PADDING, pointsToScreen, screenToPoints, snapPoint } from "./deckCoordinates";
import type { DeckDialogId, DeckSelection } from "./deckUiTypes";
import { deckTextOperations } from "./deckTextEdit";
import { canDeckMutate } from "./deckController";

export interface SlideCanvasProps {
  controller: OfficeController;
  active: boolean;
  slideId: string | null;
  revision: number;
  selection: DeckSelection | null;
  viewport: OfficeViewport;
  previewOnly: boolean;
  snap: boolean;
  onViewport: (viewport: OfficeViewport) => void;
  onSelection: (selection: DeckSelection) => void;
  onShapePatches: (patches: DeckShapePatch[]) => void;
  onOpenDialog: (id: DeckDialogId) => void;
  onOpenHelp: (slug: string) => void;
}

/** Move a rectangle by a pointer delta in points. The preview is local; only
 * a release commits one `patch_shapes` transaction (D3). */
export function moveShapeRect(rect: OfficeRect, dxPt: number, dyPt: number, snap: boolean): OfficeRect {
  const x = snapPoint(rect.x_pt + (Number.isFinite(dxPt) ? dxPt : 0), snap);
  const y = snapPoint(rect.y_pt + (Number.isFinite(dyPt) ? dyPt : 0), snap);
  return { ...rect, x_pt: x, y_pt: y };
}

/** Resize through the bottom-right handle, never below 1 point. */
export function resizeShapeRect(rect: OfficeRect, widthPt: number, heightPt: number, snap: boolean): OfficeRect {
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) return rect;
  const width = Math.max(1, snapPoint(widthPt, snap));
  const height = Math.max(1, snapPoint(heightPt, snap));
  return { ...rect, width_pt: width, height_pt: height };
}

/** A drag below half a point is a click, never an edit. */
export function dragDistanceQualifies(dxPt: number, dyPt: number): boolean {
  return Math.abs(Number.isFinite(dxPt) ? dxPt : 0) >= 0.5 ||
    Math.abs(Number.isFinite(dyPt) ? dyPt : 0) >= 0.5;
}

/** Screen position of one point-space rectangle inside the viewport. */
export function rectToScreen(rect: OfficeRect, viewport: OfficeViewport): {
  left: number; top: number; width: number; height: number;
} {
  return {
    left: pointsToScreen(rect.x_pt, viewport.zoom_percent) - viewport.x_px,
    top: pointsToScreen(rect.y_pt, viewport.zoom_percent) - viewport.y_px,
    width: pointsToScreen(rect.width_pt, viewport.zoom_percent),
    height: pointsToScreen(rect.height_pt, viewport.zoom_percent),
  };
}

/** One rendered slide: its trusted raster plus an accessible editing surface.
 * Engine HTML never enters the app DOM; typed operations replace text, never
 * `innerHTML`. Notes are not a canvas input at all, so they cannot be copied
 * into an image alt text. */
export default function SlideCanvas({
  controller,
  active,
  slideId,
  revision,
  selection,
  viewport,
  previewOnly,
  snap,
  onViewport,
  onSelection,
  onShapePatches,
  onOpenDialog,
  onOpenHelp,
}: SlideCanvasProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState<OfficeRenderPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{
    slideId: string; nodeId: string; target: NonNullable<OfficeAccessibleNode["deck_text"]>;
    value: string; left: number; top: number; width: number; height: number;
  } | null>(null);
  const [textError, setTextError] = useState<unknown>(null);
  const drag = useRef<{ nodeId: string; startX: number; startY: number; rect: OfficeRect } | null>(null);
  const leases = useRef<string[]>([]);
  const generation = useRef(0);

  useEffect(() => {
    if (!active || !slideId) return;
    const current = ++generation.current;
    let cancelled = false;
    setPage(null);
    setLoading(true);
    setError(null);
    const release = (ids: readonly string[]) => {
      for (const lease of ids) void releaseOfficeLease(lease).catch(() => undefined);
    };
    const run = async () => {
      try {
        // The controller validates the deck family, the live revision and
        // every page session before this render is shown.
        const lease = await controller.render(viewport);
        if (cancelled || current !== generation.current) {
          release(lease.pages.map((item) => item.image.lease_id));
          return;
        }
        const next = lease.pages.find((item) => item.page_id === slideId) ?? null;
        release(lease.pages.filter((item) => item !== next).map((item) => item.image.lease_id));
        release(leases.current);
        leases.current = next ? [next.image.lease_id] : [];
        setPage(next);
      } catch (caught) {
        if (!cancelled && current === generation.current) setError(caught);
      } finally {
        if (!cancelled && current === generation.current) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      generation.current += 1;
      release(leases.current);
      leases.current = [];
    };
  }, [active, controller, revision, slideId, viewport]);

  if (loading && !page) return <div className="adp-deck-canvas-skeleton"><Skeleton variant="tiles" count={1} /></div>;
  if (error) return <p className="adp-deck-error" role="alert">{errorText(t, error, "presentation")}</p>;

  const pageRect = page?.rect ?? { x_pt: 0, y_pt: 0, width_pt: 720, height_pt: 405, rotation_deg: 0 };
  const pageBox = rectToScreen(pageRect, viewport);
  const selectedShape = new Set(selection?.shape_ids ?? []);

  const commitText = (draft: NonNullable<typeof editing>) => {
    setEditing(null);
    if (previewOnly || draft.slideId !== slideId || draft.value === draft.target.text) return;
    const state = controller.getState();
    if (!canDeckMutate(controller.document, state, "deck_shapes", previewOnly).enabled) return;
    const currentRevision = state.revision;
    try {
      const operations = deckTextOperations(draft.slideId, draft.nodeId, draft.target, draft.value, currentRevision);
      if (operations.length === 0) return;
      void controller.transact({
        transaction_id: crypto.randomUUID(),
        expected_revision: currentRevision,
        operations: operations.map((operation) => ({ family: "deck", operation })),
        selection_after: null,
        label_key: "office.transaction",
      }).catch(setTextError);
    } catch (caught) {
      setTextError(caught);
    }
  };

  return (
    <div
      className="adp-deck-canvas"
      style={{ padding: CANVAS_PADDING }}
      tabIndex={0}
      role="application"
      aria-label={t("officeDeck.canvas")}
      onKeyDown={(event) => {
        if (editing) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          onSelection({ kind: "deck", slide_ids: slideId ? [slideId] : [], shape_ids: page?.accessibility.map((node) => node.id) ?? [], text_span: null });
          return;
        }
        if (!selection || selection.shape_ids.length === 0) return;
        const step = event.shiftKey ? 10 : 1;
        const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] :
          event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
        if (!delta) return;
        event.preventDefault();
        const nodes = page?.accessibility.filter((node) => selectedShape.has(node.id)) ?? [];
        if (nodes.length === 0) return;
        onShapePatches(nodes.map((node) => ({ id: node.id, rect: moveShapeRect(node.rect, delta[0], delta[1], false) })));
      }}
    >
      <div className="adp-deck-page" style={{ width: pageBox.width, height: pageBox.height, position: "relative" }}>
        <button
          type="button"
          className="adp-deck-canvas-help"
          aria-label={t("help.title")}
          title={t("help.title")}
          onClick={() => onOpenHelp("editing-presentations")}
        >
          ?
        </button>
        {page ? (
          <img
            className="adp-deck-page-image"
            src={fileUrl(page.image.token, page.image.name)}
            width={pageBox.width}
            height={pageBox.height}
            alt=""
            draggable={false}
          />
        ) : null}
        {page?.accessibility.map((node) => {
          const box = rectToScreen(node.rect, viewport);
          if (!node.editable && !node.name) return null;
          return (
            <div
              key={node.id}
              className={"adp-deck-node" + (selectedShape.has(node.id) ? " adp-deck-node--selected" : "")}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              role="button"
              tabIndex={-1}
              aria-label={node.name}
              data-shape-id={node.id}
              onPointerDown={(event) => {
                if (previewOnly || event.button !== 0) return;
                const shapeSelection: DeckSelection = {
                  kind: "deck",
                  slide_ids: slideId ? [slideId] : [],
                  shape_ids: event.shiftKey ? [...new Set([...selection?.shape_ids ?? [], node.id])] : [node.id],
                  text_span: null,
                };
                onSelection(shapeSelection);
                drag.current = { nodeId: node.id, startX: event.clientX, startY: event.clientY, rect: node.rect };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onDoubleClick={() => {
                const target = node.deck_text;
                if (!slideId || page.page_id !== slideId || !target ||
                    target.span.revision !== revision ||
                    !canDeckMutate(controller.document, controller.getState(), "deck_shapes", previewOnly).enabled) return;
                setTextError(null);
                setEditing({ slideId, nodeId: node.id, target, value: target.text, ...box });
              }}
              onPointerUp={(event) => {
                const start = drag.current;
                drag.current = null;
                if (!start) return;
                const dx = screenToPoints(event.clientX - start.startX, viewport.zoom_percent);
                const dy = screenToPoints(event.clientY - start.startY, viewport.zoom_percent);
                if (!dragDistanceQualifies(dx, dy)) return;
                onShapePatches([{ id: start.nodeId, rect: moveShapeRect(start.rect, dx, dy, snap) }]);
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              {selectedShape.has(node.id) ? (
                <span
                  className="adp-deck-resize"
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (previewOnly) return;
                    const start = { x: event.clientX, y: event.clientY, rect: node.rect };
                    const onMove = (move: PointerEvent) => {
                      const width = start.rect.width_pt + screenToPoints(move.clientX - start.x, viewport.zoom_percent);
                      const height = start.rect.height_pt + screenToPoints(move.clientY - start.y, viewport.zoom_percent);
                      onShapePatches([{ id: node.id, rect: resizeShapeRect(start.rect, width, height, snap) }]);
                    };
                    const onUp = () => {
                      window.removeEventListener("pointermove", onMove);
                      window.removeEventListener("pointerup", onUp);
                    };
                    window.addEventListener("pointermove", onMove);
                    window.addEventListener("pointerup", onUp);
                  }}
                />
              ) : null}
            </div>
          );
        })}
        {editing && editing.slideId === slideId && !previewOnly ? (
          <textarea
            className="adp-deck-text-editor"
            style={{ left: editing.left, top: editing.top, width: editing.width, height: Math.max(40, editing.height) }}
            autoFocus
            value={editing.value}
            maxLength={4096}
            aria-label={t("officeDeck.editText")}
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
            onBlur={() => commitText(editing)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(null);
              }
            }}
          />
        ) : null}
      </div>
      {textError ? <p className="adp-deck-error" role="alert">{errorText(t, textError, "office_edit")}</p> : null}
      <div className="adp-deck-canvas-tools" role="toolbar" aria-label={t("officeDeck.insert")}>
        <button type="button" className="adp-btn" onClick={() => onOpenDialog("shape")} disabled={previewOnly}>
          {t("officeDeck.shape")}
        </button>
        <button type="button" className="adp-btn" onClick={() => onOpenDialog("image")} disabled={previewOnly}>
          {t("officeDeck.picture")}
        </button>
        <button type="button" className="adp-btn" onClick={() => onOpenDialog("table")} disabled={previewOnly}>
          {t("officeDeck.table")}
        </button>
        <button type="button" className="adp-btn" onClick={() => onOpenDialog("chart")} disabled={previewOnly}>
          {t("officeDeck.chart")}
        </button>
        <span className="adp-deck-zoom">
          <button
            type="button"
            className="adp-icon-btn"
            aria-label={t("officeDeck.zoomOut")}
            onClick={() => onViewport({ ...viewport, zoom_percent: Math.max(10, viewport.zoom_percent - 10) })}
          >
            −
          </button>
          <span>{Math.round(viewport.zoom_percent)}%</span>
          <button
            type="button"
            className="adp-icon-btn"
            aria-label={t("officeDeck.zoomIn")}
            onClick={() => onViewport({ ...viewport, zoom_percent: Math.min(400, viewport.zoom_percent + 10) })}
          >
            +
          </button>
        </span>
      </div>
    </div>
  );
}
