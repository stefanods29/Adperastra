import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DocumentHandle, DocumentState } from "../documents/types";
import { ImageHistory } from "../image-edit/history";
import { applyLayerOperationToModel, createRasterLayerFromPixels } from "../image-edit/layers";
import { copySelection, cutSelection } from "../image-edit/layerTransfer";
import { selectedPixels } from "../image-edit/selectionPixels";
import { createFullSelection } from "../image-edit/selectionTypes";
import { getImageTileStore } from "../image-edit/tiles";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { newUuid, type ImageModel, type RasterLayer } from "../image-edit/types";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  release: vi.fn(),
  createTransfer: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("../services/exportSnapshots", () => ({
  beginExportSnapshot: (...args: unknown[]) => mocks.begin(...args),
  appendExportSnapshot: (...args: unknown[]) => mocks.append(...args),
  finishExportSnapshot: (...args: unknown[]) => mocks.finish(...args),
  releaseExportSnapshot: (...args: unknown[]) => mocks.release(...args),
}));

vi.mock("../services/contentTransfer", () => ({
  createTransfer: (...args: unknown[]) => mocks.createTransfer(...args),
}));

vi.mock("../image-edit/transactions", () => ({
  commitImageTransaction: (...args: unknown[]) => mocks.commit(...args),
}));

function snapshot(documentId: string, contentId: string): ExportSnapshot {
  return {
    snapshot_id: newUuid(),
    document_id: documentId,
    revision: 7,
    content_id: contentId,
    mime: "image/png",
    byte_len: 4,
    storage_policy: "ordinary",
    expires_unix: 9_999_999_999,
  };
}

async function model(): Promise<{ model: ImageModel; layer: RasterLayer }> {
  const documentId = newUuid();
  const contentId = newUuid();
  const store = getImageTileStore(documentId);
  const tile = await store.publish(1, 1, new Uint8Array([255, 0, 0, 255]));
  const layer: RasterLayer = {
    kind: "raster",
    id: newUuid(),
    name: "Photo",
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    mask_id: null,
    tiles: [tile],
  };
  const value: ImageModel = {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 1,
    height: 1,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [tile],
    layers: [layer],
    masks: [],
    geometry: {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width: 1, height: 1 },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
  return { model: value, layer };
}

function state(contentId: string, sensitive: boolean): DocumentState {
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
  };
}

function documentHandle(contentId: string, sensitive: boolean): DocumentHandle {
  return {
    id: newUuid(),
    source: { kind: "disk", path: "C:\\Images\\photo.png" },
    info: {
      document_id: newUuid(),
      source: { kind: "disk", path: "C:\\Images\\photo.png" },
      name: "photo.png",
      ext: "png",
      mime: "image/png",
      size: 4,
      modified_unix: 0,
      read_only: false,
      from_internet: false,
      sensitive,
    },
    getState: () => state(contentId, sensitive),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(4),
    captureSnapshot: async () => snapshot(newUuid(), contentId),
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  } as unknown as DocumentHandle;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue({ snapshot_id: newUuid(), upload_token: "a".repeat(32) });
  mocks.append.mockResolvedValue(undefined);
  mocks.release.mockResolvedValue(undefined);
  mocks.finish.mockImplementation(async (snapshotId: string) => {
    const found = snapshot(newUuid(), newUuid());
    return { ...found, snapshot_id: snapshotId };
  });
  mocks.createTransfer.mockResolvedValue({
    transfer_id: newUuid(),
    source_document_id: newUuid(),
    sensitive: false,
    payload: { kind: "text", text: "unused" },
    expires_unix: 9_999_999_999,
  });
  mocks.commit.mockResolvedValue(undefined);
});

describe("selected-content transfer", () => {
  it("copy_encodedPNG", async () => {
    const value = await model();
    const selection = createFullSelection(1, 1);
    const result = await selectedPixels(value.model, 7, selection, null);
    expect(result.mime).toBe("image/png");
    expect(mocks.begin).toHaveBeenCalledTimes(1);
    const metadata = mocks.begin.mock.calls[0][0] as { revision: number; content_id: string; mime: string };
    expect(metadata.revision).toBe(7);
    expect(metadata.content_id).toBe(value.model.content_id);
    expect(metadata.mime).toBe("image/png");
    const bytes = mocks.append.mock.calls[0][3] as Uint8Array;
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16)).toBe(1);
    expect(view.getUint32(20)).toBe(1);
  });

  it("capturedR_latereditRplus1_snapshot_staysR", async () => {
    const value = await model();
    const later = { ...value.model, content_id: newUuid() };
    const selection = createFullSelection(1, 1);
    await selectedPixels(value.model, 7, selection, null);
    expect((mocks.begin.mock.calls[0][0] as { revision: number }).revision).toBe(7);
    expect((mocks.begin.mock.calls[0][0] as { content_id: string }).content_id).toBe(value.model.content_id);
    expect(later.content_id).not.toBe(value.model.content_id);
  });

  it("failedcopy_no_cut", async () => {
    const value = await model();
    const document = documentHandle(value.model.content_id, false);
    const selection = createFullSelection(1, 1);
    mocks.createTransfer.mockRejectedValueOnce(new Error("transfer.failed"));
    await expect(
      cutSelection(document, value.model, 7, selection, value.layer.id),
    ).rejects.toThrow("transfer.failed");
    expect(mocks.commit).not.toHaveBeenCalled();
    const raster = value.model.layers[0];
    if (raster.kind !== "raster") throw new Error("expected a raster layer");
    expect(raster.tiles[0].id).toBe(value.layer.tiles[0].id);
  });

  it("paste_onelayer_oneUndo", async () => {
    const value = await model();
    const layer = await createRasterLayerFromPixels(
      value.model.document_id,
      1,
      1,
      new Uint8Array([0, 255, 0, 255]),
      "Pasted",
    );
    const added = await applyLayerOperationToModel(value.model, { kind: "add", layer, index: 1 });
    expect(added.model.layers).toHaveLength(2);
    const history = new ImageHistory(value.model);
    expect(history.push(value.model, added.model, added.changedBytes)).toBe(true);
    const undone = history.undo();
    expect(undone?.layers).toHaveLength(1);
    expect(history.canRedo).toBe(true);
  });

  it("sensitivecopy_requiresdecision", async () => {
    const value = await model();
    const document = documentHandle(value.model.content_id, true);
    const selection = createFullSelection(1, 1);
    await expect(copySelection(document, value.model, 7, selection, null)).rejects.toThrow("transfer.sensitive");
    expect(mocks.begin).not.toHaveBeenCalled();
  });
});
