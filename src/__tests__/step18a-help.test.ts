import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import { createImageLayerTransferTarget } from "../image-edit/layerTransfer";
import { MAX_SELECTION_TILE_BYTES, selectionPixelCount } from "../image-edit/selectionRaster";
import { createFullSelection } from "../image-edit/selectionTypes";
import { normalizeSettings } from "../services/settings";
import type { DocumentHandle } from "../documents/types";
import type { TransferEnvelope } from "../transfer/types";
import { newUuid, type ImageModel } from "../image-edit/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGES = ["image-layers", "image-selections", "image-transforming"] as const;

function flattenKeys(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenKeys(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

function imageModel(): ImageModel {
  const documentId = newUuid();
  const contentId = newUuid();
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 1,
    height: 1,
    source_snapshot: {
      snapshot_id: newUuid(),
      document_id: documentId,
      revision: 1,
      content_id: contentId,
      mime: "image/png",
      byte_len: 4,
      storage_policy: "ordinary",
      expires_unix: 9_999_999_999,
    },
    original_tiles: [
      { id: newUuid(), tile_x: 0, tile_y: 0, width: 1, height: 1, byte_len: 4, generation: 1 },
    ],
    layers: [
      {
        kind: "raster",
        id: newUuid(),
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blend: "normal",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        mask_id: null,
        tiles: [],
      },
    ],
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
}

function readonlyDocument(model: ImageModel): DocumentHandle {
  return {
    id: model.document_id,
    source: { kind: "disk", path: "C:\\Images\\photo.png" },
    info: {
      document_id: model.document_id,
      source: { kind: "disk", path: "C:\\Images\\photo.png" },
      name: "photo.png",
      ext: "png",
      mime: "image/png",
      size: 4,
      modified_unix: 0,
      read_only: true,
      from_internet: true,
      sensitive: false,
    },
    getState: () => ({
      revision: 1,
      saved_revision: 1,
      content_id: model.content_id,
      saved_content_id: model.content_id,
      dirty: false,
      ready: true,
      editing_enabled: false,
      can_save_existing: false,
      can_save_copy: true,
      read_only_reason: "protected",
    }),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(4),
    captureSnapshot: async () => model.source_snapshot,
    save: async () => false,
    saveCopy: async () => false,
    discard: async () => undefined,
    release: () => undefined,
  } as unknown as DocumentHandle;
}

describe("layers, selections and transforms help", () => {
  it("migration42_preservesimageprefs", () => {
    const normalized = normalizeSettings({
      schema_version: 47,
      image_editor: {
        default_mode: "draw",
        background_rgba: [1, 2, 3, 4],
        history_limit_mb: 128,
        advanced: true,
        selection_tolerance: 42,
        show_history: true,
      },
    });
    const image = (normalized as unknown as { image_editor?: Record<string, unknown> }).image_editor;
    expect(image?.advanced).toBe(true);
    expect(image?.selection_tolerance).toBe(42);
    expect(image?.show_history).toBe(true);
    expect(image?.default_mode).toBe("draw");
    expect(image?.history_limit_mb).toBe(128);
  });

  it("24MP_tools_budget", () => {
    const selection = createFullSelection(6000, 4000);
    expect(selectionPixelCount(selection)).toBe(24_000_000);
    expect(MAX_SELECTION_TILE_BYTES).toBeGreaterThanOrEqual(24_000_000);
  });

  it("readonly_target_noactions", () => {
    const model = imageModel();
    const document = readonlyDocument(model);
    const target = createImageLayerTransferTarget({
      targetId: "image-layers-test",
      document,
      documentId: model.document_id,
      getModel: () => model,
      getExpectedContentId: () => model.content_id,
      decodeSnapshot: vi.fn(),
      layerName: "Pasted",
    });
    const envelope = {
      transfer_id: newUuid(),
      sensitive: false,
      payload: {
        kind: "image",
        snapshot: model.source_snapshot,
        width: 1,
        height: 1,
      },
      expires_unix: 9_999_999_999,
    } as TransferEnvelope;
    expect(target.describe(envelope)).toEqual([]);
  });

  it("bilingual_help_pages", () => {
    for (const page of PAGES) {
      const english = readFileSync(join(root, "help", "en", `${page}.md`), "utf8");
      const spanish = readFileSync(join(root, "help", "es", `${page}.md`), "utf8");
      expect(english.length, page).toBeGreaterThan(200);
      expect(spanish.length, page).toBeGreaterThan(200);
      expect(english).toContain("See also:");
      expect(spanish).toContain("Consulta también:");
    }
  });

  it("locale_keys_parity", () => {
    const keys = flattenKeys(en);
    const spanishKeys = flattenKeys(es);
    for (const key of [
      "layers.title",
      "layers.advanced",
      "layers.add",
      "layers.duplicate",
      "layers.delete",
      "layers.merge",
      "layers.flatten",
      "layers.visible",
      "layers.locked",
      "layers.opacity",
      "layers.blend",
      "layers.mask",
      "layers.history",
      "layers.working",
      "selection.working",
      "selection.rectangle",
      "selection.ellipse",
      "selection.lasso",
      "selection.polygon",
      "selection.wand",
      "selection.color",
      "selection.replace",
      "selection.add",
      "selection.subtract",
      "selection.intersect",
      "selection.invert",
      "selection.feather",
      "errors.image_layers.failed",
    ]) {
      expect(keys.has(key), `en ${key}`).toBe(true);
      expect(spanishKeys.has(key), `es ${key}`).toBe(true);
    }
  });
});
