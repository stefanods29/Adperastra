import { Columns2, Crop, Download, Eraser, HelpCircle, Maximize, Pencil, Redo2, Save, Scaling, Shapes, SlidersHorizontal, Undo2, Wand2, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import IconButton from "../components/IconButton";
import QuickConvertDialog from "../convert/QuickConvertDialog";
import type { ConversionInput } from "../convert/types";
import type { DocumentState, VirtualViewProps } from "../documents/types";
import { CommandRegistry, isCommandEnabled } from "../commands/registry";
import { errorText } from "../services/errors";
import { pickSavePath } from "../services/textFiles";
import { appTransferRegistry } from "../transfer/TransferRegistry";
import AdvancedPanels, { type AdvancedActions } from "./AdvancedPanels";
import { decodeImageSnapshot } from "./advancedTransfer";
import {
  registerAdvancedImageCommands,
  type AdvancedCommandContext,
} from "./advancedCommands";
import CropOverlay from "./CropOverlay";
import DrawTools, { type DrawTool } from "./DrawTools";
import {
  imageEditorRuntimeSettings,
  subscribeImageEditorSettings,
} from "./editorSettings";
import HistoryPanel from "./HistoryPanel";
import ImageProperties, { type BrushSettings, type EditSection } from "./ImageProperties";
import { acquireImageEditor, imageEditorDefaults } from "./ImageDocument";
import { compositePixels, compositeRegion } from "./composite";
import { applyLayerOperation, createBlankRasterLayer } from "./layers";
import { createImageLayerTransferTarget } from "./layerTransfer";
import { createDefaultLayerSelection, MAX_LAYERS, type LayerOperation, type LayerSelectionState } from "./layerTypes";
import TransformDialog from "./TransformDialog";
import { applySelection } from "./selections";
import { releaseSelectionMaskTiles } from "./selectionRaster";
import {
  isSelectionTool,
  type SelectionMode,
  type SelectionOperation,
  type SelectionTool,
} from "./selectionTypes";
import { renderImage } from "./render";
import { StrokeGesture } from "./brush";
import { createOverlay } from "./overlays";
import { mapRect } from "./coordinates";
import { outputPointToSource, setCrop, sourceToOutputAffine } from "./geometry";
import {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  sourceSizeOf,
  type ImageController,
  type ImageGeometry,
  type ImageModel,
  type Affine2D,
} from "./types";

/** E5: the editable image presenter. The existing read-only ImageView stays
 * the fallback; this component never claims a second image MIME. */

interface ImageEditorViewState {
  mode: "edit" | "draw" | "advanced";
  tool: DrawTool;
  /** Advanced selection tool and layer ids; never mask bytes or paths. */
  selection_tool: SelectionTool;
  active_layer_id?: string;
  selected_layer_ids?: string[];
  zoom: "fit" | number;
}

function SectionButton({
  id,
  icon: Icon,
  labelKey,
  pressed,
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  pressed: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="adp-image-section-btn"
      data-adp-image-section={id}
      aria-label={t(labelKey)}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function readState(saved: unknown): ImageEditorViewState {
  const value = (saved ?? {}) as Partial<ImageEditorViewState>;
  const tool = ["brush", "pen", "highlighter", "eraser", "shapes", "arrow", "text"].includes(value.tool as string)
    ? (value.tool as DrawTool)
    : "brush";
  const selected = Array.isArray(value.selected_layer_ids)
    ? value.selected_layer_ids.filter((id): id is string => typeof id === "string").slice(-256)
    : undefined;
  return {
    mode: value.mode === "advanced" ? "advanced" : value.mode === "draw" ? "draw" : "edit",
    tool,
    selection_tool: isSelectionTool(value.selection_tool) ? value.selection_tool : "rectangle",
    active_layer_id: typeof value.active_layer_id === "string" ? value.active_layer_id : undefined,
    selected_layer_ids: selected,
    zoom: value.zoom === "fit" || typeof value.zoom === "number" ? value.zoom : "fit",
  };
}

/** One normalized comparison so Save a copy cannot replace the open source. */
function sameDiskPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
  return normalize(left) === normalize(right);
}

/** Advanced previews composite at native size. Larger documents keep the
 * bounded 14b preview until Step 18b owns viewport tiles. */
const MAX_ADVANCED_PREVIEW_PIXELS = 24_000_000;

export default function ImageEditor({ document, active, savedState, onStateChange, onStatus, onOpenHelp, previewOnly }: VirtualViewProps) {
  const { t } = useTranslation();
  const [controller, setController] = useState<ImageController | null>(null);
  const [model, setModel] = useState<Readonly<ImageModel> | null>(null);
  const [docState, setDocState] = useState<DocumentState>(() => document.getState());
  const [view, setView] = useState<ImageEditorViewState>(() => {
    const state = readState(savedState);
    if (savedState == null) {
      state.mode = imageEditorDefaults().default_mode;
      if (imageEditorRuntimeSettings().advanced) state.mode = "advanced";
    }
    return state;
  });
  const [section, setSection] = useState<EditSection>(view.mode === "draw" ? "draw" : "adjust");
  const [brush, setBrush] = useState<BrushSettings>({ color: [255, 64, 64, 255], width: 24, hardness: 0.8, opacity: 1 });
  const [background, setBackground] = useState<[number, number, number, number]>(() => imageEditorDefaults().background_rgba);
  const [transparent, setTransparent] = useState(false);
  const [overlayText, setOverlayText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [exportInput, setExportInput] = useState<ConversionInput | null>(null);
  const [layerState, setLayerState] = useState<LayerSelectionState | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("replace");
  const [tolerance, setTolerance] = useState(() => imageEditorRuntimeSettings().selection_tolerance);
  const [showHistory, setShowHistory] = useState(() => imageEditorRuntimeSettings().show_history);
  const [transformOpen, setTransformOpen] = useState(false);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [renderSize, setRenderSize] = useState({ width: 0, height: 0 });
  const instructionsId = useId();
  const transferTargetId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const leaseRef = useRef<{ release: () => void } | null>(null);
  const gesture = useRef<StrokeGesture | null>(null);
  const overlayStart = useRef<{ x: number; y: number } | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const selectionPoints = useRef<{ x: number; y: number }[]>([]);
  const polygonPoints = useRef<{ x: number; y: number }[]>([]);
  const layerInitialized = useRef(false);
  const renderGeneration = useRef(0);
  const appliedSettings = useRef(imageEditorRuntimeSettings());
  const translate = useRef(t);
  translate.current = t;

  useEffect(() => {
    if (!controller) return;
    const unsubscribe = controller.subscribe((next) => setModel(next));
    setModel(controller.getModel());
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    const unsubscribe = document.subscribe((state) => setDocState(state));
    setDocState(document.getState());
    return unsubscribe;
  }, [document]);

  useEffect(() => {
    let cancelled = false;
    let acquired: ImageController | null = null;
    acquireImageEditor(document)
      .then((value) => {
        if (cancelled) value.release();
        else {
          acquired = value;
          setController(value);
        }
      })
      .catch((error) => {
        if (!cancelled) setNotice(errorText(translate.current, error, "image_edit"));
      });
    return () => {
      cancelled = true;
      acquired?.release();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, [document]);

  useEffect(() => {
    onStateChange(view as unknown as import("../documents/types").SerializableViewState);
  }, [view, onStateChange]);

  const source = useMemo(() => (model ? sourceSizeOf(model) : null), [model]);
  const renderModel = useMemo(() => {
    if (!model || !source || section !== "crop") return model;
    // Crop handles and fields use oriented source pixels. The crop preview is
    // therefore shown before turns/flips/angle; leaving the section restores
    // the complete geometry pipeline.
    const fullGeometry: ImageGeometry = {
      ...model.geometry,
      crop: { x: 0, y: 0, width: source.width, height: source.height },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width: source.width, height: source.height },
    };
    return { ...model, geometry: fullGeometry };
  }, [model, source, section]);

  useEffect(() => {
    if (!model) return;
    onStatus({
      items: [t("viewer.dimensions", { width: model.geometry.output_size.width, height: model.geometry.output_size.height })],
      zoom: {
        percent: view.zoom === "fit" ? 100 : view.zoom,
        min: MIN_ZOOM_PERCENT,
        max: MAX_ZOOM_PERCENT,
        set: (percent) => setView((current) => ({ ...current, zoom: percent })),
        fit: () => setView((current) => ({ ...current, zoom: "fit" })),
      },
    });
  }, [model, onStatus, t, view.zoom]);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    const generation = renderGeneration.current + 1;
    renderGeneration.current = generation;
    const edge = Math.min(4096, Math.max(512, Math.round(Math.max(box.width, box.height) * (window.devicePixelRatio || 1))));
    const output = model.geometry.output_size;
    const advancedPreview =
      view.mode === "advanced" && output.width * output.height <= MAX_ADVANCED_PREVIEW_PIXELS;
    const render = advancedPreview
      ? compositeRegion(model, { x: 0, y: 0, width: output.width, height: output.height })
      : renderImage(renderModel ?? model, { edge, compare_original: comparing });
    render
      .then((lease) => {
        if (cancelled || renderGeneration.current !== generation) {
          lease.release();
          return;
        }
        leaseRef.current?.release();
        leaseRef.current = lease;
        setRenderSize({ width: lease.width, height: lease.height });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = lease.width;
        canvas.height = lease.height;
        const context = canvas.getContext("2d");
        if (context) {
          context.clearRect(0, 0, lease.width, lease.height);
          context.drawImage(lease.bitmap, 0, 0);
        }
      })
      .catch((error) => {
        if (!cancelled) setNotice(errorText(t, error, "image_edit"));
      });
    return () => {
      cancelled = true;
    };
  }, [model, renderModel, comparing, box.width, box.height, view.mode, t]);

  const canEdit =
    docState.editing_enabled &&
    !document.info.read_only &&
    docState.read_only_reason === undefined &&
    !previewOnly;

  // Advanced layer selection is per-view state; only ids/tool are persisted.
  useEffect(() => {
    setLayerState((current) => {
      if (current) releaseSelectionMaskTiles(current.selection);
      return null;
    });
    layerInitialized.current = false;
    selectionStart.current = null;
    selectionPoints.current = [];
    polygonPoints.current = [];
    setTransformOpen(false);
  }, [document]);

  useEffect(() => {
    if (!model || layerInitialized.current) return;
    layerInitialized.current = true;
    const base = createDefaultLayerSelection(model);
    const available = new Set(model.layers.map((layer) => layer.id));
    const saved = (view.selected_layer_ids ?? []).filter((id) => available.has(id)).slice(-256);
    const active =
      view.active_layer_id && available.has(view.active_layer_id) ? view.active_layer_id : base.active_layer_id;
    const selected = saved.length > 0 ? saved : active ? [active] : [];
    if (active && !selected.includes(active)) selected.push(active);
    setLayerState({
      ...base,
      active_layer_id: active,
      selected_layer_ids: selected.slice(-256),
      tool: view.selection_tool === "transform" ? "rectangle" : view.selection_tool,
      viewonly: !canEdit,
    });
  }, [model, view.active_layer_id, view.selected_layer_ids, view.selection_tool, canEdit]);

  useEffect(() => {
    if (!model) return;
    setLayerState((current) => {
      if (!current) return current;
      const available = new Set(model.layers.map((layer) => layer.id));
      const active = available.has(current.active_layer_id)
        ? current.active_layer_id
        : model.layers[model.layers.length - 1]?.id ?? "";
      if (!active) return current;
      const selected = current.selected_layer_ids.filter((id) => available.has(id));
      if (!selected.includes(active)) selected.push(active);
      const next = selected.slice(-256);
      const unchanged =
        active === current.active_layer_id &&
        next.length === current.selected_layer_ids.length &&
        next.every((id, index) => id === current.selected_layer_ids[index]);
      return unchanged ? current : { ...current, active_layer_id: active, selected_layer_ids: next };
    });
  }, [model]);

  useEffect(() => {
    if (!layerState) return;
    setView((current) => {
      const selected = current.selected_layer_ids ?? [];
      const unchanged =
        current.active_layer_id === layerState.active_layer_id &&
        current.selection_tool === layerState.tool &&
        selected.length === layerState.selected_layer_ids.length &&
        selected.every((id, index) => id === layerState.selected_layer_ids[index]);
      return unchanged
        ? current
        : {
            ...current,
            active_layer_id: layerState.active_layer_id,
            selected_layer_ids: [...layerState.selected_layer_ids],
            selection_tool: layerState.tool,
          };
    });
  }, [layerState]);

  useEffect(() => {
    setLayerState((current) =>
      current && current.viewonly !== !canEdit ? { ...current, viewonly: !canEdit } : current,
    );
  }, [canEdit]);

  useEffect(() => {
    if (view.mode === "advanced" && layerState?.tool === "transform") setTransformOpen(true);
  }, [view.mode, layerState?.tool]);

  useEffect(() => {
    if (view.mode === "advanced") return;
    setTransformOpen(false);
    setLayerState((current) =>
      current && current.tool === "transform" ? { ...current, tool: "rectangle" } : current,
    );
  }, [view.mode]);

  useEffect(() => {
    // Settings save/import reaches this editor without remounting it; the
    // Advanced default mode and background apply on the next open. A local
    // tolerance change is kept when an unrelated setting is saved.
    return subscribeImageEditorSettings((next) => {
      if (next.selection_tolerance !== appliedSettings.current.selection_tolerance) {
        setTolerance(next.selection_tolerance);
      }
      appliedSettings.current = next;
      setShowHistory(next.show_history);
    });
  }, []);

  // Register the 09c image layer target while Advanced is mounted. Each view
  // gets its own target id so split views never fight over one registration.
  useEffect(() => {
    if (view.mode !== "advanced" || !controller) return;
    const current = controller.getModel();
    let unregister: (() => void) | null = null;
    try {
      unregister = appTransferRegistry.register(
        createImageLayerTransferTarget({
          targetId: `image-layers:${document.info.document_id}:${transferTargetId}`,
          document,
          documentId: document.info.document_id,
          getModel: () => controller.getModel(),
          getExpectedContentId: () => controller.getModel().content_id,
          decodeSnapshot: decodeImageSnapshot,
          layerName: t("layers.layerName", { number: current.layers.length + 1 }),
        }),
      );
    } catch {
      unregister = null;
    }
    return () => {
      unregister?.();
    };
  }, [view.mode, controller, document, t, transferTargetId]);

  const apply = useCallback(
    async (work: () => Promise<void>) => {
      if (!controller || !canEdit) {
        setNotice(t("errors.image_edit.read_only", { defaultValue: t("errors.image_edit.failed") }));
        return;
      }
      try {
        await work();
        setNotice(null);
      } catch (error) {
        setNotice(errorText(t, error, "image_edit"));
      }
    },
    [controller, canEdit, t],
  );

  const applyGeometry = (geometry: ImageGeometry) => {
    void apply(() => controller!.apply({ kind: "set_geometry", geometry }));
  };

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!model) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const sx = model.geometry.output_size.width / Math.max(1, rect.width);
    const sy = model.geometry.output_size.height / Math.max(1, rect.height);
    return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
  };

  /** Advanced gestures work in canonical source pixels; selections never
   * become document content. */
  const selectionPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!model) return null;
    const point = pointAt(event);
    return point ? outputPointToSource(point, model.geometry, sourceSizeOf(model)) : null;
  };

  const applySelectionOp = async (operation: SelectionOperation) => {
    if (!model || !layerState) return;
    try {
      const next = await applySelection(layerState.selection, operation, model);
      setLayerState((current) => {
        if (!current) {
          releaseSelectionMaskTiles(next);
          return current;
        }
        if (current.selection !== layerState.selection) {
          // A newer selection won while this one was computed.
          releaseSelectionMaskTiles(next);
          return current;
        }
        releaseSelectionMaskTiles(current.selection);
        return { ...current, selection: next };
      });
      setNotice(null);
    } catch {
      setNotice(t("errors.image_layers.failed"));
    }
  };

  const runLayerOperation = async (operation: LayerOperation) => {
    if (!model || !canEdit) {
      setNotice(t("errors.image_edit.read_only", { defaultValue: t("errors.image_edit.failed") }));
      return;
    }
    try {
      await applyLayerOperation(model.document_id, model.content_id, operation);
      setNotice(null);
    } catch {
      setNotice(t("errors.image_layers.failed"));
    }
  };

  const addLayer = async () => {
    if (!model || !canEdit || !layerState) return;
    if (model.layers.length >= MAX_LAYERS) {
      setNotice(t("errors.image_layers.failed"));
      return;
    }
    try {
      const source = sourceSizeOf(model);
      const layer = await createBlankRasterLayer(
        model.document_id,
        source.width,
        source.height,
        t("layers.layerName", { number: model.layers.length + 1 }),
      );
      await applyLayerOperation(model.document_id, model.content_id, {
        kind: "add",
        layer,
        index: model.layers.length,
      });
      setLayerState((current) =>
        current ? { ...current, active_layer_id: layer.id, selected_layer_ids: [layer.id] } : current,
      );
      setNotice(null);
    } catch {
      setNotice(t("errors.image_layers.failed"));
    }
  };

  const duplicateLayer = () => {
    if (layerState) void runLayerOperation({ kind: "duplicate", id: layerState.active_layer_id });
  };

  const deleteLayer = () => {
    if (!model || !layerState || layerState.selected_layer_ids.length >= model.layers.length) return;
    void runLayerOperation({ kind: "remove", ids: [...layerState.selected_layer_ids] });
  };

  const mergeLayer = () => {
    if (layerState) void runLayerOperation({ kind: "merge_down", id: layerState.active_layer_id });
  };

  const flattenLayer = () => setConfirmFlatten(true);

  const advancedActions: AdvancedActions = {
    addLayer: () => void addLayer(),
    duplicateLayer,
    deleteLayer,
    mergeLayer,
    flattenLayer,
    invertSelection: () => void applySelectionOp({ kind: "invert" }),
    toggleAdvanced: () => setView((current) => ({ ...current, mode: "advanced" })),
  };

  // One advanced command registry per view. The toolbar and the shared
  // image.* command ids read the same definitions (decks/office use the
  // same CommandRegistry host pattern); paint/text/shape/PSD stay out.
  const advancedCommandRegistry = useMemo(() => {
    const created = new CommandRegistry<AdvancedCommandContext>();
    registerAdvancedImageCommands(created);
    return created;
  }, []);
  const advancedCommands = useMemo(
    () => advancedCommandRegistry.list(),
    [advancedCommandRegistry],
  );
  const advancedCommand = advancedCommandRegistry.get("image.advanced");
  const activeLayerIndex =
    model && layerState
      ? model.layers.findIndex((layer) => layer.id === layerState.active_layer_id)
      : -1;
  const activeLayer = activeLayerIndex >= 0 ? model?.layers[activeLayerIndex] : undefined;
  const mergeable =
    activeLayer?.kind === "raster" &&
    activeLayerIndex > 0 &&
    model?.layers[activeLayerIndex - 1]?.kind === "raster";
  const flattenable =
    model?.layers.every((layer) => layer.kind === "raster" || layer.kind === "adjustment") ?? false;
  const advancedContext: AdvancedCommandContext = {
    editable: canEdit && layerState !== null && !layerState.viewonly,
    hasModel: model !== null,
    layerCount: model?.layers.length ?? 0,
    selectedCount: layerState?.selected_layer_ids.length ?? 0,
    activeLayerId: activeLayer?.id ?? null,
    mergeable: mergeable === true,
    flattenable,
    ...advancedActions,
  };

  const finishPolygon = () => {
    const points = polygonPoints.current;
    polygonPoints.current = [];
    if (points.length >= 3) void applySelectionOp({ kind: "polygon", points, mode: selectionMode });
  };

  const pickColorSelection = async (point: { x: number; y: number }) => {
    if (!model) return;
    const source = sourceSizeOf(model);
    const x = Math.min(source.width - 1, Math.max(0, Math.floor(point.x)));
    const y = Math.min(source.height - 1, Math.max(0, Math.floor(point.y)));
    try {
      const pixels = await compositePixels(model, { x, y, width: 1, height: 1 });
      const seed: [number, number, number, number] = [
        pixels.rgba[0],
        pixels.rgba[1],
        pixels.rgba[2],
        pixels.rgba[3],
      ];
      await applySelectionOp({ kind: "color", seed_color_rgba: seed, tolerance, mode: selectionMode });
    } catch {
      setNotice(t("errors.image_layers.failed"));
    }
  };

  const advancedPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !canEdit || view.mode !== "advanced" || !model || !layerState) return;
    const tool = layerState.tool;
    if (tool === "wand" || tool === "color" || tool === "move" || tool === "transform") return;
    const point = selectionPoint(event);
    if (!point) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "rectangle" || tool === "ellipse") selectionStart.current = point;
    else if (tool === "lasso") selectionPoints.current = [point];
  };

  const advancedPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (view.mode !== "advanced" || !layerState || layerState.tool !== "lasso") return;
    if (selectionPoints.current.length === 0) return;
    const point = selectionPoint(event);
    if (!point) return;
    if (selectionPoints.current.length >= 100_000) return;
    selectionPoints.current.push(point);
  };

  const advancedPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !canEdit || view.mode !== "advanced" || !model || !layerState) return;
    const point = selectionPoint(event);
    if (!point) return;
    const tool = layerState.tool;
    if (tool === "rectangle" || tool === "ellipse") {
      const start = selectionStart.current;
      selectionStart.current = null;
      if (!start) return;
      const rect = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };
      if (rect.width < 1 || rect.height < 1) return;
      void applySelectionOp({ kind: tool, rect, mode: selectionMode });
      return;
    }
    if (tool === "lasso") {
      const points = selectionPoints.current;
      selectionPoints.current = [];
      if (points.length >= 3) void applySelectionOp({ kind: "polygon", points, mode: selectionMode });
      return;
    }
    if (tool === "polygon") {
      polygonPoints.current.push(point);
      if (event.detail >= 2) finishPolygon();
      return;
    }
    if (tool === "wand") {
      const source = sourceSizeOf(model);
      const seed = {
        x: Math.min(source.width - 1, Math.max(0, Math.floor(point.x))),
        y: Math.min(source.height - 1, Math.max(0, Math.floor(point.y))),
      };
      void applySelectionOp({ kind: "wand", seed, tolerance, mode: selectionMode });
      return;
    }
    if (tool === "color") void pickColorSelection(point);
  };

  const applyTransform = async (matrix: Affine2D, linkedMask: boolean) => {
    if (!model || !layerState) return;
    const ids =
      layerState.selected_layer_ids.length > 0
        ? [...layerState.selected_layer_ids]
        : [layerState.active_layer_id];
    await applyLayerOperation(model.document_id, model.content_id, {
      kind: "transform",
      ids,
      matrix,
      linked_mask: linkedMask,
    });
    setTransformOpen(false);
    setLayerState((current) => (current ? { ...current, tool: "rectangle" } : current));
  };

  const cancelTransform = () => {
    setTransformOpen(false);
    setLayerState((current) => (current ? { ...current, tool: "rectangle" } : current));
  };

  const commitStroke = (points: { x: number; y: number }[]) => {
    if (!model) return;
    const layer = model.layers.find((candidate) => candidate.kind === "raster");
    if (!layer || layer.kind !== "raster") return;
    const erase = view.tool === "eraser" || section === "erase";
    void apply(() =>
      controller!.apply({
        kind: "paint_stroke",
        layer_id: layer.id,
        points,
        color: brush.color,
        width: brush.width,
        hardness: erase ? 1 : view.tool === "pen" ? 1 : brush.hardness,
        opacity: erase ? brush.opacity : view.tool === "highlighter" ? Math.min(0.3, brush.opacity) : brush.opacity,
        mode: erase ? "erase" : "paint",
      }),
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !canEdit || view.mode !== "draw") return;
    const point = pointAt(event);
    if (!point) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (view.tool === "brush" || view.tool === "pen" || view.tool === "highlighter" || view.tool === "eraser") {
      gesture.current = new StrokeGesture();
      gesture.current.add(point);
    } else {
      overlayStart.current = point;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || view.mode !== "draw" || !gesture.current) return;
    const point = pointAt(event);
    if (point) gesture.current.add(point);
  };

  const finishGesture = () => {
    const finished = gesture.current?.finish();
    gesture.current = null;
    if (finished && finished.length > 0) commitStroke(finished);
  };

  const cancelGesture = () => {
    gesture.current?.cancel();
    gesture.current = null;
    overlayStart.current = null;
    selectionStart.current = null;
    selectionPoints.current = [];
    polygonPoints.current = [];
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !canEdit || view.mode !== "draw") return;
    if (gesture.current) {
      const point = pointAt(event);
      if (point) gesture.current.add(point);
      finishGesture();
      return;
    }
    const start = overlayStart.current;
    overlayStart.current = null;
    const end = pointAt(event);
    if (!start || !end || !model) return;
    const kind = view.tool === "arrow" ? "arrow" : view.tool === "shapes" ? "rectangle" : view.tool === "text" ? "text" : "stroke";
    try {
      const overlay = createOverlay(kind, [start, end], model.geometry.output_size, {
        color: brush.color,
        width: brush.width,
        opacity: brush.opacity,
        text: kind === "text" ? overlayText : undefined,
        font_size: kind === "text" ? Math.min(512, Math.max(12, brush.width * 2)) : undefined,
      });
      void apply(() => controller!.apply({ kind: "add_overlay", overlay }));
    } catch (error) {
      setNotice(errorText(t, error, "image_edit"));
    }
  };

  const exportSnapshot = async () => {
    if (!controller || !model) return;
    try {
      const snapshot = await controller.capture(docState.revision, model.content_id);
      setExportInput({ kind: "snapshot", snapshot_id: snapshot.snapshot_id, document_id: snapshot.document_id, revision: snapshot.revision });
    } catch (error) {
      setNotice(errorText(t, error, "image_edit"));
    }
  };

  const save = async () => {
    try {
      const saved = await document.save();
      if (!saved) setNotice(t("errors.image_edit.failed"));
    } catch (error) {
      setNotice(errorText(t, error, "image_edit"));
    }
  };

  const saveCopy = async () => {
    // The 14b capture is PNG (D9 default). Naming the copy with the source
    // extension would write PNG bytes into a .jpg/.webp file.
    const imageMime = document.info.mime.startsWith("image/");
    const fileName = imageMime
      ? `${document.info.name.replace(/\.[^.\\/]+$/, "")}.png`
      : document.info.name;
    const path = await pickSavePath(t("editor.saveAsTitle"), fileName, t("editor.allFiles"));
    if (!path) return;
    // 09f may later allow replacing the source, but the editor never does:
    // Save a copy must create another file.
    const sourcePath = document.info.disk_path;
    if (sourcePath && sameDiskPath(path, sourcePath)) {
      setNotice(t("errors.image_edit.failed"));
      return;
    }
    try {
      const saved = await document.saveCopy(path);
      if (!saved) setNotice(t("errors.image_edit.failed"));
    } catch (error) {
      setNotice(errorText(t, error, "image_edit"));
    }
  };

  const compareButton = (
    <Button
      variant="subtle"
      onPointerDown={() => setComparing(true)}
      onPointerUp={() => setComparing(false)}
      onPointerLeave={() => setComparing(false)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") setComparing(true);
      }}
      onKeyUp={() => setComparing(false)}
      data-adp-image-compare="true"
    >
      <Columns2 size={16} aria-hidden="true" /> {t("imageEdit.compare")}
    </Button>
  );

  const fitted = model && box.width > 0 && box.height > 0
    ? (() => {
        const size = renderSize.width > 0 && renderSize.height > 0 ? renderSize : model.geometry.output_size;
        const scale = Math.min(box.width / size.width, box.height / size.height);
        const width = size.width * scale;
        const height = size.height * scale;
        return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
      })()
    : { x: 0, y: 0, width: 0, height: 0 };

  const selectionBox = (() => {
    if (view.mode !== "advanced" || !model || !source || !layerState?.selection.bounds) return null;
    const output = model.geometry.output_size;
    if (output.width < 1 || output.height < 1) return null;
    const rect = mapRect(layerState.selection.bounds, sourceToOutputAffine(model.geometry, source));
    const scaleX = fitted.width / output.width;
    const scaleY = fitted.height / output.height;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;
    if (width < 1 || height < 1) return null;
    return {
      left: fitted.x + rect.x * scaleX,
      top: fitted.y + rect.y * scaleY,
      width,
      height,
    };
  })();

  return (
    <div
      className={`adp-image-editor${view.mode === "advanced" ? " adp-image-advanced" : ""}`}
      data-adp-image-editor="true"
      data-adp-image-mode={view.mode}
    >
      <div className="adp-image-top" role="toolbar" aria-label={t("imageEdit.edit")}>
        <IconButton icon={Undo2} labelKey="common.undo" onClick={() => void apply(() => controller!.undo())} disabled={!canEdit} />
        <IconButton icon={Redo2} labelKey="common.redo" onClick={() => void apply(() => controller!.redo())} disabled={!canEdit} />
        {compareButton}
        <span className="adp-image-segmented">
          <button type="button" className="adp-image-seg" aria-pressed={view.mode === "edit"} onClick={() => setView((current) => ({ ...current, mode: "edit" }))}>
            {t("imageEdit.edit")}
          </button>
          <button type="button" className="adp-image-seg" aria-pressed={view.mode === "draw"} onClick={() => setView((current) => ({ ...current, mode: "draw" }))}>
            {t("imageEdit.draw")}
          </button>
          <button
            type="button"
            className="adp-image-seg"
            data-adp-image-advanced-toggle="true"
            aria-pressed={view.mode === "advanced"}
            disabled={advancedCommand === undefined || !isCommandEnabled(advancedCommand, advancedContext)}
            onClick={() => advancedCommand?.run(advancedContext)}
          >
            {t("layers.advanced")}
          </button>
        </span>
        <IconButton icon={ZoomOut} labelKey="viewer.zoomOut" onClick={() => setView((current) => ({ ...current, zoom: Math.max(MIN_ZOOM_PERCENT, (current.zoom === "fit" ? 100 : current.zoom) - 25) }))} />
        <IconButton icon={ZoomIn} labelKey="viewer.zoomIn" onClick={() => setView((current) => ({ ...current, zoom: Math.min(MAX_ZOOM_PERCENT, (current.zoom === "fit" ? 100 : current.zoom) + 25) }))} />
        <IconButton icon={Maximize} labelKey="viewer.fitToWindow" onClick={() => setView((current) => ({ ...current, zoom: "fit" }))} />
        <span className="adp-image-top-spacer" />
        <Button variant="subtle" onClick={() => void exportSnapshot()} disabled={!model}>
          <Download size={16} aria-hidden="true" /> {t("common.export")}
        </Button>
        <Button variant="subtle" onClick={() => void saveCopy()} disabled={!canEdit || !docState.can_save_copy}>
          {t("common.saveCopy")}
        </Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!canEdit || !docState.dirty || !docState.can_save_existing}
        >
          <Save size={16} aria-hidden="true" /> {t("common.save")}
        </Button>
        <IconButton icon={HelpCircle} labelKey="common.help" onClick={() => onOpenHelp("editing-images")} />
      </div>

      <div className={`adp-image-body${view.mode === "advanced" ? " adp-image-body-advanced" : ""}`}>
        {view.mode === "advanced" && showHistory && controller ? (
          <HistoryPanel controller={controller} viewonly={!canEdit} />
        ) : null}

        {view.mode !== "advanced" ? (
          <DrawTools
            tool={view.tool}
            onTool={(tool) => {
              setView((current) => ({ ...current, mode: "draw", tool }));
              setSection(tool === "eraser" ? "erase" : "draw");
            }}
            disabled={!canEdit}
          />
        ) : null}

        <div ref={boxRef} className="adp-image-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="adp-image-canvas"
            role={view.mode === "edit" ? "img" : "application"}
            aria-label={t("imageEdit.canvasLabel")}
            aria-describedby={view.mode === "edit" ? undefined : instructionsId}
            data-adp-image-canvas="true"
            tabIndex={view.mode === "edit" ? -1 : 0}
            onPointerDown={(event) => {
              if (view.mode === "advanced") advancedPointerDown(event);
              else onPointerDown(event);
            }}
            onPointerMove={(event) => {
              if (view.mode === "advanced") advancedPointerMove(event);
              else onPointerMove(event);
            }}
            onPointerUp={(event) => {
              if (view.mode === "advanced") advancedPointerUp(event);
              else onPointerUp(event);
            }}
            onPointerCancel={cancelGesture}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelGesture();
                return;
              }
              if (view.mode === "advanced" && event.key === "Enter" && polygonPoints.current.length >= 3) {
                event.preventDefault();
                finishPolygon();
              }
            }}
          />
          <p id={instructionsId} className="adp-image-sr">
            {t("imageEdit.canvasInstructions")}
          </p>
          {view.mode !== "advanced" && model && section === "crop" ? (
            <CropOverlay
              crop={model.geometry.crop}
              source={source ?? { width: model.width, height: model.height }}
              viewport={fitted}
              onChange={canEdit ? (crop) => {
                if (source) applyGeometry(setCrop(model.geometry, source, crop));
              } : undefined}
            />
          ) : null}
          {selectionBox ? (
            <div
              className="adp-advanced-selection"
              data-adp-selection-bounds="true"
              style={selectionBox}
              aria-hidden="true"
            />
          ) : null}
          {notice ? <p className="adp-image-toast" role="alert">{notice}</p> : null}
        </div>

        {view.mode !== "advanced" ? (
          <>
            <div className="adp-image-sections" role="toolbar" aria-label={t("imageEdit.tools")}>
              <SectionButton id="crop" icon={Crop} labelKey="imageEdit.crop" pressed={section === "crop"} onClick={() => setSection("crop")} />
              <SectionButton id="size" icon={Scaling} labelKey="imageEdit.size" pressed={section === "size"} onClick={() => setSection("size")} />
              <SectionButton id="adjust" icon={SlidersHorizontal} labelKey="imageEdit.adjust" pressed={section === "adjust"} onClick={() => setSection("adjust")} />
              <SectionButton id="filters" icon={Wand2} labelKey="imageEdit.filters" pressed={section === "filters"} onClick={() => setSection("filters")} />
              <SectionButton id="markup" icon={Shapes} labelKey="imageEdit.markup" pressed={section === "markup"} onClick={() => { setSection("markup"); setView((current) => ({ ...current, mode: "draw" })); }} />
              <SectionButton id="erase" icon={Eraser} labelKey="imageEdit.erase" pressed={section === "erase"} onClick={() => { setSection("erase"); setView((current) => ({ ...current, mode: "draw", tool: "eraser" })); }} />
              <SectionButton id="draw" icon={Pencil} labelKey="imageEdit.draw" pressed={view.mode === "draw"} onClick={() => setView((current) => ({ ...current, mode: "draw" }))} />
            </div>

            {model && source ? (
              <ImageProperties
                model={model}
                source={source}
                overlayText={overlayText}
                onOverlayText={setOverlayText}
                mode={view.mode === "draw" ? "draw" : "edit"}
                section={section}
                tool={view.tool}
                brush={brush}
                background={background}
                transparent={transparent}
                opaqueFormat={false}
                onBrush={setBrush}
                onBackground={setBackground}
                onTransparent={setTransparent}
                onAdjustments={(adjustments) => void apply(() => controller!.apply({ kind: "set_adjustments", adjustments }))}
                onGeometry={applyGeometry}
              />
            ) : null}
          </>
        ) : null}

        {view.mode === "advanced" && controller && layerState && model ? (
          <AdvancedPanels
            document={document}
            controller={controller}
            commands={advancedCommands}
            ctx={advancedContext}
            state={layerState}
            onStateChange={(next) => setLayerState(next)}
            selection={layerState.selection}
            onSelection={applySelectionOp}
            mode={selectionMode}
            onMode={setSelectionMode}
            tolerance={tolerance}
            onTolerance={setTolerance}
            disabled={!canEdit}
          />
        ) : null}
      </div>

      {transformOpen && model && layerState ? (
        <TransformDialog
          model={model}
          layerIds={
            layerState.selected_layer_ids.length > 0
              ? layerState.selected_layer_ids
              : [layerState.active_layer_id]
          }
          onApply={applyTransform}
          onCancel={cancelTransform}
        />
      ) : null}

      {confirmFlatten ? (
        <Dialog title={t("layers.flatten")} onClose={() => setConfirmFlatten(false)} className="adp-layer-flatten-dialog">
          <p className="adp-layer-warning">{t("layers.flattenWarning")}</p>
          <div className="adp-layer-dialog-actions">
            <Button onClick={() => setConfirmFlatten(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              data-adp-layer-confirm-flatten="true"
              onClick={() => {
                setConfirmFlatten(false);
                void runLayerOperation({ kind: "flatten" });
              }}
            >
              {t("layers.flatten")}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {exportInput ? (
        <QuickConvertDialog
          inputs={[exportInput]}
          onClose={() => setExportInput(null)}
          onCompleted={() => setExportInput(null)}
          onOpenHelp={onOpenHelp}
        />
      ) : null}
    </div>
  );
}
