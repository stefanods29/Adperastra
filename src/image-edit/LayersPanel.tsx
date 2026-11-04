import { Copy, Eye, EyeOff, Layers, Lock, LockOpen, Merge, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import Slider from "../components/Slider";
import type { DocumentHandle, DocumentState } from "../documents/types";
import type { ImageController, ImageModel } from "./types";
import { createBlankRasterLayer, applyLayerOperation } from "./layers";
import { sourceSizeOf } from "./types";
import type { LayerOperation, LayerSelectionState } from "./layerTypes";
import { BLEND_MODES, MAX_LAYERS } from "./layerTypes";

/** E5: 300 px Layers panel. It never owns a second document registry; every
 * row and action reads the shared controller's immutable model. */

export interface LayersPanelProps {
  document: DocumentHandle;
  controller: ImageController;
  state: LayerSelectionState;
  onStateChange: (state: LayerSelectionState) => void;
}

export default function LayersPanel({ document, controller, state, onStateChange }: LayersPanelProps) {
  const { t } = useTranslation();
  const [model, setModel] = useState<Readonly<ImageModel>>(() => controller.getModel());
  const [docState, setDocState] = useState<DocumentState>(() => document.getState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [opacityDraft, setOpacityDraft] = useState(100);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const skipRenameBlur = useRef(false);

  useEffect(() => {
    setModel(controller.getModel());
    return controller.subscribe((next) => setModel(next));
  }, [controller]);

  useEffect(() => {
    setDocState(document.getState());
    return document.subscribe((next) => setDocState(next));
  }, [document]);

  const editable = useMemo(() => {
    return docState.editing_enabled && !document.info.read_only && !state.viewonly;
  }, [docState.editing_enabled, document.info.read_only, state.viewonly]);

  const active = model.layers.find((layer) => layer.id === state.active_layer_id) ?? model.layers[model.layers.length - 1];
  const selected = [
    ...new Set(state.selected_layer_ids.length > 0 ? state.selected_layer_ids : active ? [active.id] : []),
  ];
  const activeIndex = active ? model.layers.findIndex((layer) => layer.id === active.id) : -1;
  // Merge down is defined for two raster layers only; adjustment/text/shape
  // layers keep their typed data until their own merge rules exist.
  const mergeable =
    active?.kind === "raster" &&
    activeIndex > 0 &&
    model.layers[activeIndex - 1]?.kind === "raster";
  // Flatten bakes visible adjustment layers; text/shape cannot be baked yet.
  const flattenable = model.layers.every((layer) => layer.kind === "raster" || layer.kind === "adjustment");

  useEffect(() => {
    if (active) setOpacityDraft(Math.round(active.opacity * 100));
  }, [active?.id, active?.opacity]);

  useEffect(() => {
    if (model.layers.length === 0) return;
    const available = new Set(model.layers.map((layer) => layer.id));
    const selectedIds = state.selected_layer_ids.filter((id) => available.has(id)).slice(-256);
    const activeId = available.has(state.active_layer_id)
      ? state.active_layer_id
      : model.layers[model.layers.length - 1].id;
    if (!selectedIds.includes(activeId)) {
      selectedIds.push(activeId);
      if (selectedIds.length > 256) selectedIds.shift();
    }
    const unchanged =
      activeId === state.active_layer_id &&
      selectedIds.length === state.selected_layer_ids.length &&
      selectedIds.every((id, index) => id === state.selected_layer_ids[index]);
    if (!unchanged) {
      onStateChange({ ...state, active_layer_id: activeId, selected_layer_ids: selectedIds });
    }
  }, [model.layers, state, onStateChange]);

  const changeState = (patch: Partial<LayerSelectionState>) => {
    onStateChange({ ...state, ...patch });
  };

  const choose = (id: string, additive: boolean) => {
    if (!model.layers.some((layer) => layer.id === id)) return;
    if (additive) {
      const next = selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
      if (next.length === 0) return;
      changeState({ active_layer_id: id, selected_layer_ids: next.slice(-256) });
    } else {
      changeState({ active_layer_id: id, selected_layer_ids: [id] });
    }
  };

  const run = async (operation: LayerOperation) => {
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    try {
      await applyLayerOperation(model.document_id, model.content_id, operation);
      setError(null);
    } catch {
      setError(t("errors.image_layers.failed"));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!editable || busy) return;
    if (model.layers.length >= MAX_LAYERS) {
      setError(t("errors.image_layers.failed"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const source = sourceSizeOf(model);
      const layer = await createBlankRasterLayer(
        model.document_id,
        source.width,
        source.height,
        t("layers.layerName", { number: model.layers.length + 1 }),
      );
      await applyLayerOperation(model.document_id, model.content_id, { kind: "add", layer, index: model.layers.length });
      changeState({ active_layer_id: layer.id, selected_layer_ids: [layer.id] });
      setError(null);
    } catch {
      setError(t("errors.image_layers.failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (selected.length >= model.layers.length) {
      setError(t("errors.image_layers.failed"));
      return;
    }
    await run({ kind: "remove", ids: selected });
  };

  const reorder = async (index: number, delta: number) => {
    const target = index + delta;
    if (!editable || target < 0 || target >= model.layers.length) return;
    const ids = model.layers.map((layer) => layer.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run({ kind: "reorder", ids });
  };

  const commitRename = async (layerId: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!editable || !name) return;
    if (model.layers.find((layer) => layer.id === layerId)?.name === name) return;
    await run({ kind: "rename", id: layerId, name });
  };

  const commitOpacity = async () => {
    if (!active || !editable) return;
    const opacity = Math.min(1, Math.max(0, opacityDraft / 100));
    if (Math.abs(opacity - active.opacity) < 1e-9) return;
    await run({ kind: "opacity", id: active.id, opacity });
  };

  const onRowKeyDown = (event: React.KeyboardEvent<HTMLLIElement>, layerId: string, index: number) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      // The visual list is top-to-bottom while the model is bottom-to-top.
      void reorder(index, 1);
      return;
    }
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      void reorder(index, -1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      // Rows render top-to-bottom, the model is bottom-to-top.
      const next = event.key === "ArrowUp" ? Math.min(model.layers.length - 1, index + 1) : Math.max(0, index - 1);
      choose(model.layers[next].id, false);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault();
      const layer = model.layers.find((candidate) => candidate.id === layerId);
      if (layer) void run({ kind: "visibility", id: layer.id, visible: !layer.visible });
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      if (!editable) return;
      const layer = model.layers.find((candidate) => candidate.id === layerId);
      if (!layer) return;
      skipRenameBlur.current = false;
      setRenamingId(layer.id);
      setRenameValue(layer.name);
    }
  };

  return (
    <aside
      className="adp-layers-panel"
      data-adp-layer-panel="true"
      aria-label={t("layers.title")}
      aria-busy={busy}
    >
      <header className="adp-layers-header">
        <h2>{t("layers.title")}</h2>
        <span className="adp-layers-count">{model.layers.length}</span>
      </header>

      <div className="adp-layers-top">
        <label className="adp-layer-field">
          <span>{t("layers.opacity")}</span>
          <div onPointerUp={() => void commitOpacity()} onKeyUp={() => void commitOpacity()}>
            <Slider
              value={opacityDraft}
              min={0}
              max={100}
              label={t("layers.opacity")}
              disabled={!editable || !active}
              onChange={setOpacityDraft}
            />
          </div>
        </label>
        <label className="adp-layer-field">
          <span>{t("layers.blend")}</span>
          <select
            className="adp-layer-select"
            aria-label={t("layers.blend")}
            value={active?.blend ?? "normal"}
            disabled={!editable || !active}
            onChange={(event) => {
              if (active) void run({ kind: "blend", id: active.id, blend: event.target.value as ImageModel["layers"][number]["blend"] });
            }}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`layers.blendMode.${mode}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="adp-layer-list" role="listbox" aria-label={t("layers.title")} aria-multiselectable="true">
        {[...model.layers].reverse().map((layer) => {
          const index = model.layers.findIndex((candidate) => candidate.id === layer.id);
          const isActive = layer.id === state.active_layer_id;
          const isSelected = selected.includes(layer.id);
          return (
            <li
              key={layer.id}
              className="adp-layer-row"
              role="option"
              aria-selected={isSelected}
              tabIndex={isActive ? 0 : -1}
              data-adp-layer-id={layer.id}
              data-adp-layer-name={layer.name}
              onClick={(event) => choose(layer.id, event.ctrlKey || event.metaKey)}
              onKeyDown={(event) => onRowKeyDown(event, layer.id, index)}
            >
              <button
                type="button"
                className="adp-layer-visibility"
                aria-label={layer.visible ? t("layers.hideNamed", { name: layer.name }) : t("layers.showNamed", { name: layer.name })}
                aria-pressed={layer.visible}
                disabled={busy || !editable}
                onClick={(event) => {
                  event.stopPropagation();
                  void run({ kind: "visibility", id: layer.id, visible: !layer.visible });
                }}
              >
                {layer.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              </button>
              <span className="adp-layer-thumb" data-adp-layer-thumb="true" aria-hidden="true">
                <Layers size={16} />
              </span>
              {renamingId === layer.id ? (
                <input
                  className="adp-layer-rename"
                  aria-label={t("layers.renameNamed", { name: layer.name })}
                  value={renameValue}
                  maxLength={128}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => {
                    if (skipRenameBlur.current) {
                      skipRenameBlur.current = false;
                      return;
                    }
                    void commitRename(layer.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      skipRenameBlur.current = true;
                      void commitRename(layer.id);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      skipRenameBlur.current = true;
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="adp-layer-name"
                  aria-label={t("layers.selectNamed", { name: layer.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    choose(layer.id, event.ctrlKey || event.metaKey);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!editable) return;
                    skipRenameBlur.current = false;
                    setRenamingId(layer.id);
                    setRenameValue(layer.name);
                  }}
                >
                  {layer.name}
                </button>
              )}
              <button
                type="button"
                className="adp-layer-lock"
                aria-label={layer.locked ? t("layers.unlockNamed", { name: layer.name }) : t("layers.lockNamed", { name: layer.name })}
                aria-pressed={layer.locked}
                disabled={busy || !editable}
                onClick={(event) => {
                  event.stopPropagation();
                  void run({ kind: "lock", id: layer.id, locked: !layer.locked });
                }}
              >
                {layer.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="adp-layer-actions" role="toolbar" aria-label={t("layers.title")}>
        <Button variant="subtle" data-adp-layer-action="add" disabled={!editable || busy || model.layers.length >= MAX_LAYERS} onClick={() => void add()}>
          <Plus size={16} aria-hidden="true" /> {t("layers.add")}
        </Button>
        <Button
          variant="subtle"
          data-adp-layer-action="duplicate"
          disabled={!editable || busy || !active || model.layers.length >= MAX_LAYERS}
          onClick={() => active && void run({ kind: "duplicate", id: active.id })}
        >
          <Copy size={16} aria-hidden="true" /> {t("layers.duplicate")}
        </Button>
        <Button
          variant="subtle"
          data-adp-layer-action="delete"
          disabled={!editable || busy || model.layers.length <= 1}
          onClick={() => void remove()}
        >
          <Trash2 size={16} aria-hidden="true" /> {t("layers.delete")}
        </Button>
        <Button
          variant="subtle"
          data-adp-layer-action="merge"
          disabled={!editable || busy || !mergeable}
          onClick={() => active && void run({ kind: "merge_down", id: active.id })}
        >
          <Merge size={16} aria-hidden="true" /> {t("layers.merge")}
        </Button>
        <Button
          variant="subtle"
          data-adp-layer-action="flatten"
          disabled={!editable || busy || model.layers.length <= 1 || !flattenable}
          onClick={() => setConfirmFlatten(true)}
        >
          <Layers size={16} aria-hidden="true" /> {t("layers.flatten")}
        </Button>
      </div>

      {busy ? <p className="adp-layer-working" role="status">{t("layers.working")}</p> : null}
      {error ? <p className="adp-layer-error" role="alert">{error}</p> : null}

      {confirmFlatten ? (
        <Dialog
          title={t("layers.flatten")}
          onClose={() => setConfirmFlatten(false)}
          className="adp-layer-flatten-dialog"
        >
          <p className="adp-layer-warning">{t("layers.flattenWarning")}</p>
          <div className="adp-layer-dialog-actions">
            <Button onClick={() => setConfirmFlatten(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              data-adp-layer-confirm-flatten="true"
              onClick={() => {
                setConfirmFlatten(false);
                void run({ kind: "flatten" });
              }}
            >
              {t("layers.flatten")}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </aside>
  );
}
