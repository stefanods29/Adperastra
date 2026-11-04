import { describe, expect, it } from "vitest";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type { DocumentHandle, DocumentState } from "../documents/types";
import { acquireImageEditor, registerImageSourceDecoder } from "../image-edit/ImageDocument";
import { ImageHistory } from "../image-edit/history";
import { collectRenderTiles } from "../image-edit/render";
import { renderPixels } from "../image-edit/worker";
import { newUuid, sourceSizeOf, validateModel, type ImageModel } from "../image-edit/types";

const decoders = new Map<string, { width: number; height: number; rgba: Uint8Array }>();
registerImageSourceDecoder(async (document) => {
  const decoded = decoders.get(document.info.document_id);
  if (!decoded) throw new Error("image_edit.bad_request");
  return decoded;
});

function state(documentId: string, contentId: string): DocumentState {
  return {
    revision: 1,
    saved_revision: 1,
    content_id: contentId,
    saved_content_id: contentId,
    dirty: false,
    ready: true,
    editing_enabled: true,
    can_save_existing: true,
    can_save_copy: true,
    read_only_reason: undefined,
  } as DocumentState;
}

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
  } as ExportSnapshot;
}

function fakeDocument(documentId: string, width: number, height: number, contentId = newUuid()): DocumentHandle {
  const handle = {
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
      disk_path: "C:\\Images\\photo.png",
    },
    getState: () => state(documentId, contentId),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(16),
    captureSnapshot: async () => snapshot(documentId, contentId),
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  };
  return handle as unknown as DocumentHandle;
}

function decoded(width: number, height: number): { width: number; height: number; rgba: Uint8Array } {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = index % 256;
    rgba[index * 4 + 1] = (index * 3) % 256;
    rgba[index * 4 + 2] = (index * 7) % 256;
    rgba[index * 4 + 3] = index % 2 === 0 ? 0 : 255;
  }
  return { width, height, rgba };
}

function modelOf(width = 8, height = 8): ImageModel {
  const documentId = newUuid();
  const contentId = newUuid();
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width,
    height,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [],
    layers: [],
    masks: [],
    geometry: {
      crop: { x: 0, y: 0, width, height },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width, height },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
}

describe("image document model", () => {
  it("two views share tiles and one controller", async () => {
    const documentId = newUuid();
    decoders.set(documentId, decoded(2, 2));
    const document = fakeDocument(documentId, 2, 2);
    const first = await acquireImageEditor(document);
    const second = await acquireImageEditor(document);
    expect(second).toBe(first);
    expect(second.getModel()).toBe(first.getModel());
    expect(second.getModel().original_tiles.map((tile) => tile.id)).toEqual(
      first.getModel().original_tiles.map((tile) => tile.id),
    );
    expect(sourceSizeOf(first.getModel())).toEqual({ width: 2, height: 2 });
    first.release();
    second.release();
  });

  it("100MP_plus_1_refused", async () => {
    const documentId = newUuid();
    decoders.set(documentId, { width: 10_000, height: 10_001, rgba: new Uint8Array(0) });
    const document = fakeDocument(documentId, 10_000, 10_001);
    await expect(acquireImageEditor(document)).rejects.toThrow("image_edit.too_large");
  });

  it("undo_savedcontent_clean", () => {
    const before = modelOf(2, 2);
    const after: ImageModel = { ...before, content_id: newUuid() };
    const history = new ImageHistory(before);
    expect(history.push(before, after, 0)).toBe(true);
    expect(history.isDirty()).toBe(true);
    history.markSaved(before.content_id);
    expect(history.undo()?.content_id).toBe(before.content_id);
    expect(history.isDirty()).toBe(false);
    history.redo();
    expect(history.isDirty()).toBe(true);
  });

  it("compare_does_not_increase_revision", async () => {
    const documentId = newUuid();
    decoders.set(documentId, decoded(2, 2));
    const controller = await acquireImageEditor(fakeDocument(documentId, 2, 2));
    const model = controller.getModel();
    const tiles = await collectRenderTiles(model);
    const base = model.layers[0];
    if (!base || base.kind !== "raster") throw new Error("test fixture has no raster layer");
    const request = {
      type: "render" as const,
      request_id: newUuid(),
      document_id: model.document_id,
      source_size: sourceSizeOf(model),
      layer_tiles: base.tiles,
      original_tiles: model.original_tiles,
      geometry: model.geometry,
      adjustments: model.adjustments,
      overlays: model.overlays,
      edge: 256,
      compare_original: true,
      tiles,
    };
    const result = renderPixels(request);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(controller.getModel().content_id).toBe(model.content_id);
    expect(validateModel(controller.getModel())).toBeUndefined();
    controller.release();
  });
});
