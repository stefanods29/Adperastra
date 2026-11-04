import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { CompositeLeaseTracker } from "../image-edit/composite";
import LayersPanel from "../image-edit/LayersPanel";
import { layerHistoryBytes, reserveLayerHistory } from "../image-edit/layerHistory";
import { createEmptySelection } from "../image-edit/selectionTypes";
import type { LayerSelectionState } from "../image-edit/layerTypes";
import type { DocumentHandle } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  MAX_HISTORY_BYTES,
  newUuid,
  type ImageController,
  type ImageModel,
  type RasterLayer,
} from "../image-edit/types";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  blank: vi.fn(),
}));

vi.mock("../image-edit/layers", () => ({
  applyLayerOperation: (...args: unknown[]) => mocks.apply(...args),
  createBlankRasterLayer: (...args: unknown[]) => mocks.blank(...args),
}));

function snapshot(documentId: string, contentId: string): ExportSnapshot {
  return {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 1,
    content_id: contentId,
    mime: "image/png",
    byte_len: 16,
    storage_policy: "ordinary",
    expires_unix: 9_999_999_999,
  };
}

function raster(name: string): RasterLayer {
  return {
    kind: "raster",
    id: newUuid(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    tiles: [],
  };
}

function fixture(): { model: ImageModel; document: DocumentHandle; controller: ImageController } {
  const documentId = newUuid();
  const contentId = newUuid();
  const layers = [raster("Bottom"), raster("Middle"), raster("Top")];
  const model: ImageModel = {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 2,
    height: 2,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [
      { id: newUuid(), tile_x: 0, tile_y: 0, width: 2, height: 2, byte_len: 16, generation: 1 },
    ],
    layers,
    masks: [],
    geometry: {
      crop: { x: 0, y: 0, width: 2, height: 2 },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width: 2, height: 2 },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
  const controller = {
    getModel: () => model,
    subscribe: () => () => undefined,
    apply: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    capture: vi.fn(),
    release: vi.fn(),
  } as unknown as ImageController;
  const document = {
    id: documentId,
    source: { kind: "disk", path: "C:\\Images\\photo.png" },
    info: {
      document_id: documentId,
      source: { kind: "disk", path: "C:\\Images\\photo.png" },
      name: "photo.png",
      ext: "png",
      mime: "image/png",
      size: 16,
      modified_unix: 0,
      read_only: false,
      from_internet: false,
      sensitive: false,
    },
    getState: () => ({
      revision: 1,
      saved_revision: 1,
      content_id: contentId,
      saved_content_id: contentId,
      dirty: false,
      ready: true,
      editing_enabled: true,
      can_save_existing: true,
      can_save_copy: true,
    }),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(16),
    captureSnapshot: async () => snapshot(documentId, contentId),
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  } as unknown as DocumentHandle;
  return { model, document, controller };
}

function selectionState(model: ImageModel, active: string): LayerSelectionState {
  return {
    active_layer_id: active,
    selected_layer_ids: [active],
    selection: createEmptySelection(2, 2),
    tool: "rectangle",
    viewonly: false,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  mocks.apply.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

async function render(state: LayerSelectionState, onChange: (next: LayerSelectionState) => void, document: DocumentHandle, controller: ImageController) {
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<LayersPanel document={document} controller={controller} state={state} onStateChange={onChange} />);
  });
}

describe("Advanced layers panel", () => {
  it("keyboard_reorder", async () => {
    const { model, document, controller } = fixture();
    const middle = model.layers[1].id;
    const onChange = vi.fn();
    await render(selectionState(model, middle), onChange, document, controller);
    const row = container?.querySelector(`[data-adp-layer-id="${middle}"]`) as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    const operation = mocks.apply.mock.calls[0][2] as { kind: string; ids: string[] };
    expect(operation.kind).toBe("reorder");
    expect(operation.ids).toEqual([model.layers[0].id, model.layers[2].id, middle]);
  });

  it("twoviews_samemodel_independentselection", async () => {
    const { model, document, controller } = fixture();
    const firstActive = model.layers[2].id;
    const secondActive = model.layers[1].id;
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    await act(async () => {
      root = createRoot(container as HTMLDivElement);
      root.render(
        <>
          <LayersPanel
            document={document}
            controller={controller}
            state={selectionState(model, firstActive)}
            onStateChange={firstChange}
          />
          <LayersPanel
            document={document}
            controller={controller}
            state={selectionState(model, secondActive)}
            onStateChange={secondChange}
          />
        </>,
      );
    });
    const panels = container?.querySelectorAll("[data-adp-layer-panel]") ?? [];
    expect(panels).toHaveLength(2);
    const firstRow = panels[1].querySelector(`[data-adp-layer-id="${model.layers[0].id}"]`) as HTMLElement;
    await act(async () => {
      firstRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(firstChange).not.toHaveBeenCalled();
    expect(secondChange).toHaveBeenCalledTimes(1);
    expect(controller.getModel()).toBe(model);
    expect(secondChange.mock.calls[0][0].active_layer_id).toBe(model.layers[0].id);
  });

  it("inactiveGPUreleased", () => {
    const tracker = new CompositeLeaseTracker();
    const first = vi.fn();
    const second = vi.fn();
    tracker.add("doc", "first", first, 1_000);
    tracker.add("doc", "second", second, 20_000);
    expect(tracker.releaseInactive(31_001, 30_000)).toBe(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(tracker.size).toBe(1);
  });

  it("budget_refuses_withoutmutation", async () => {
    const { model } = fixture();
    const before = model.content_id;
    const huge = {
      ...model,
      original_tiles: [{ ...model.original_tiles[0], byte_len: MAX_HISTORY_BYTES }],
    };
    expect(() => reserveLayerHistory(model.document_id, huge, huge, 0)).toThrow(
      "image_layers.history_full",
    );
    expect(layerHistoryBytes(model.document_id)).toBe(0);
    expect(model.content_id).toBe(before);
  });
});
