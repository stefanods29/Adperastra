import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ShapeLayerEditor, {
  convertBasicOverlays,
  parseShapeLayer,
  serializeShapeLayer,
} from "../image-edit/ShapeLayerEditor";
import { parseTextLayer, serializeTextLayer } from "../image-edit/TextLayerEditor";
import { encodeProjectBytes, flattenedProjectExportPlan } from "../image-edit/projectCodec";
import { getImageTileStore, publishTileAt } from "../image-edit/tiles";
import {
  createDefaultAdjustments,
  createDefaultGeometry,
  newUuid,
  type ImageModel,
  type ImageOverlay,
  type ShapeLayer,
  type TextLayer,
} from "../image-edit/types";
import type { ExportSnapshot } from "../services/exportSnapshots";

const state = vi.hoisted(() => ({
  model: null as ImageModel | null,
  commits: 0,
  result: null as ImageModel | null,
}));

vi.mock("../image-edit/ImageDocument", () => ({
  getImageEditorModel: () => state.model,
}));

vi.mock("../image-edit/transactions", () => ({
  commitImageTransaction: async (
    _documentId: string,
    _expectedContentId: string,
    transform: (current: Readonly<ImageModel>) => ImageModel,
  ) => {
    state.commits += 1;
    state.result = transform(state.model as ImageModel);
  },
}));

const base = (id: string, name: string) => ({
  id,
  name,
  visible: true,
  locked: false,
  opacity: 1,
  blend: "normal" as const,
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  mask_id: null,
});

function textLayer(text: string): TextLayer {
  return {
    ...base(newUuid(), "Caption"),
    kind: "text",
    text,
    font_asset_id: "inter-regular",
    font_size: 24,
    color: [10, 20, 30, 255],
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    align: "left",
  };
}

function shapeLayer(text: string): ShapeLayer {
  const overlay: ImageOverlay = {
    id: newUuid(),
    kind: "text",
    points: [{ x: 0, y: 0 }],
    bounds: { x: 0, y: 0, width: 5, height: 5 },
    color: [0, 0, 0, 255],
    width: 1,
    opacity: 1,
    text,
    font_size: 12,
  };
  return { ...base(newUuid(), "Shape"), kind: "shape", overlay };
}

function snapshot(documentId: string, contentId: string): ExportSnapshot {
  return {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 1,
    content_id: contentId,
    mime: "image/png",
    byte_len: 1,
    storage_policy: "ordinary",
    expires_unix: 0,
  };
}

async function modelWithTile(width = 1, height = 1): Promise<ImageModel> {
  const documentId = newUuid();
  const contentId = newUuid();
  const store = getImageTileStore(documentId);
  const tile = await publishTileAt(store, 0, 0, width, height, new Uint8Array(width * height * 4));
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width,
    height,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [tile],
    layers: [
      {
        ...base(newUuid(), "Base"),
        kind: "raster",
        tiles: [tile],
      },
    ],
    masks: [],
    geometry: createDefaultGeometry(width, height),
    adjustments: createDefaultAdjustments(),
    overlays: [],
    metadata: [],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

beforeEach(() => {
  state.model = null;
  state.commits = 0;
  state.result = null;
});

describe("editable text, shapes and guides", () => {
  it("text_roundtripUnicode", () => {
    const layer = textLayer("Hola 👋 ñ 日本語");
    const restored = parseTextLayer(serializeTextLayer(layer));
    expect(restored).toEqual(layer);
    expect(restored.text).toBe("Hola 👋 ñ 日本語");
  });

  it("shape_notSVGexecution", async () => {
    const layer = shapeLayer("<script>alert(1)</script>");
    const restored = parseShapeLayer(serializeShapeLayer(layer, { width: 10, height: 10 }), { width: 10, height: 10 });
    expect(restored.overlay.text).toBe("<script>alert(1)</script>");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ShapeLayerEditor
          layer={layer}
          canvas={{ width: 10, height: 10 }}
          onChange={() => undefined}
          onApply={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    // The text stays data: no script, object, embed or image element exists.
    expect(container.querySelector("script, object, embed, img")).toBeNull();
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe("<script>alert(1)</script>");
  });

  it("guides_notexported", async () => {
    const model = await modelWithTile(1, 1);
    const bytes = await encodeProjectBytes(model, 1, [{ x_or_y: "x", position: 0.5 }], 96);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"guides":[{"x_or_y":"x","position":0.5}]');
    const plan = flattenedProjectExportPlan("image/png");
    expect(plan.include_guides).toBe(false);
    expect(plan.flatten_layers).toBe(true);
  });

  it("basic_overlay_conversion_undoable", async () => {
    const model = await modelWithTile(10, 10);
    state.model = {
      ...model,
      overlays: [
        {
          id: newUuid(),
          kind: "text",
          points: [{ x: 1, y: 1 }],
          bounds: { x: 0, y: 0, width: 5, height: 5 },
          color: [0, 0, 0, 255],
          width: 1,
          opacity: 1,
          text: "Hello",
          font_size: 12,
        },
        {
          id: newUuid(),
          kind: "rectangle",
          points: [{ x: 0, y: 0 }, { x: 4, y: 4 }],
          bounds: { x: 0, y: 0, width: 4, height: 4 },
          color: [255, 0, 0, 255],
          width: 2,
          opacity: 1,
        },
      ],
    };
    await convertBasicOverlays(state.model.document_id, state.model.content_id);
    expect(state.commits).toBe(1);
    const result = state.result as ImageModel;
    expect(result.layers).toHaveLength(3);
    expect(result.overlays).toHaveLength(0);
    expect(result.layers[1].kind).toBe("text");
    expect(result.layers[2].kind).toBe("shape");
  });
});
