import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { DocumentHandle } from "../documents/types";
import type { ImageController, ImageModel } from "../image-edit/types";
import { newUuid } from "../image-edit/types";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  render: vi.fn(),
}));

vi.mock("../image-edit/ImageDocument", () => ({
  acquireImageEditor: (...args: unknown[]) => mocks.acquire(...args),
  imageEditorDefaults: () => ({ default_mode: "edit", background_rgba: [255, 255, 255, 255] }),
}));

vi.mock("../image-edit/render", () => ({
  renderImage: (...args: unknown[]) => mocks.render(...args),
}));

import ImageEditor from "../image-edit/ImageEditor";

class ResizeObserverFake {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const rootPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fixtureModel(): ImageModel {
  const documentId = newUuid();
  const contentId = newUuid();
  const tile = {
    id: newUuid(),
    tile_x: 0,
    tile_y: 0,
    width: 8,
    height: 8,
    byte_len: 8 * 8 * 4,
    generation: 1,
  };
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 8,
    height: 8,
    source_snapshot: {
      snapshot_id: newUuid(),
      document_id: documentId,
      revision: 1,
      content_id: contentId,
      mime: "image/png",
      byte_len: 256,
      storage_policy: "ordinary",
      expires_unix: 9_999_999_999,
    } as ImageModel["source_snapshot"],
    original_tiles: [tile],
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
        tiles: [tile],
      },
    ],
    masks: [],
    geometry: {
      crop: { x: 0, y: 0, width: 8, height: 8 },
      quarter_turns: 0,
      angle_degrees: 0,
      flip_x: false,
      flip_y: false,
      output_size: { width: 8, height: 8 },
    },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, blur: 0, preset: "original" },
    overlays: [],
    metadata: [],
  };
}

function fakeDocument(model: ImageModel): DocumentHandle {
  return {
    id: model.document_id,
    source: { kind: "disk", path: "C:\\Images\\photo.png" },
    info: {
      document_id: model.document_id,
      source: { kind: "disk", path: "C:\\Images\\photo.png" },
      name: "photo.png",
      ext: "png",
      mime: "image/png",
      size: 256,
      modified_unix: 0,
      read_only: false,
      from_internet: false,
      sensitive: false,
    },
    getState: () => ({
      revision: 1,
      saved_revision: 1,
      content_id: model.content_id,
      saved_content_id: model.content_id,
      dirty: false,
      ready: true,
      editing_enabled: true,
      can_save_existing: true,
      can_save_copy: true,
    }),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(0),
    captureSnapshot: async () => model.source_snapshot,
    save: async () => true,
    saveCopy: async () => true,
    discard: async () => undefined,
    release: () => undefined,
  } as unknown as DocumentHandle;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let apply: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverFake as unknown as typeof ResizeObserver;
  apply = vi.fn().mockResolvedValue(undefined);
  const model = fixtureModel();
  const controller = {
    getModel: () => model,
    subscribe: () => () => undefined,
    apply,
    undo: vi.fn().mockResolvedValue(undefined),
    redo: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn(),
    release: vi.fn(),
  } as unknown as ImageController;
  mocks.acquire.mockResolvedValue(controller);
  mocks.render.mockResolvedValue({
    id: newUuid(),
    width: 8,
    height: 8,
    bitmap: {} as ImageBitmap,
    release: vi.fn(),
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

async function renderEditor(options: { active?: boolean; savedState?: unknown } = {}) {
  const model = fixtureModel();
  const handle = fakeDocument(model);
  container = globalThis.document.createElement("div");
  globalThis.document.body.appendChild(container);
  root = createRoot(container);
  const onStateChange = vi.fn();
  await act(async () =>
    root?.render(
      <ImageEditor
        document={handle}
        active={options.active ?? true}
        savedState={(options.savedState ?? null) as import("../documents/types").SerializableViewState | null}
        onStateChange={onStateChange}
        onStatus={() => undefined}
        find={{ text: "", request: 0, backwards: false }}
        previewOnly={false}
        onOpenHelp={() => undefined}
      />,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { model, onStateChange };
}

function setInput(field: string, value: string) {
  const input = container?.querySelector(`[data-adp-image-field="${field}"]`) as HTMLInputElement | null;
  expect(input, field).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return input!;
}

describe("image editor interface", () => {
  it("keyboard_crop_fields_apply", async () => {
    await renderEditor();
    const cropSection = container?.querySelector('[data-adp-image-section="crop"]') as HTMLButtonElement | null;
    expect(cropSection).not.toBeNull();
    act(() => cropSection?.click());
    setInput("crop-x", "1");
    setInput("crop-y", "1");
    setInput("crop-width", "4");
    const height = setInput("crop-height", "4");
    act(() => {
      height.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(apply).toHaveBeenCalled();
    const operation = apply.mock.calls[0][0];
    expect(operation.kind).toBe("set_geometry");
    expect(operation.geometry.crop).toEqual({ x: 1, y: 1, width: 4, height: 4 });
  });

  it("inactive_view_no_pointercommands", async () => {
    await renderEditor({ active: false, savedState: { mode: "draw", tool: "brush", zoom: "fit" } });
    apply.mockClear();
    const canvas = container?.querySelector('[data-adp-image-canvas="true"]') as HTMLCanvasElement;
    act(() => {
      canvas.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("200percent_controls_visible", async () => {
    await renderEditor();
    const css = readFileSync(join(rootPath, "src", "styles", "image-edit.css"), "utf8");
    expect(css).toContain("@container (max-width: 900px)");
    expect(css).toContain("width: min(300px, 80%)");
    const panel = container?.querySelector(".adp-image-properties");
    expect(panel).not.toBeNull();
    const panelLabel = (panel?.getAttribute("aria-label") ?? "").toLowerCase();
    expect(panelLabel.length).toBeGreaterThan(0);
    expect(panel?.querySelectorAll("input, button").length).toBeGreaterThan(0);
  });

  it("file_tab_canvas_uses_available_width", () => {
    const css = readFileSync(join(rootPath, "src", "styles", "image-edit.css"), "utf8");
    const root = css.match(/\.adp-image-editor\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(root).toContain("flex: 1 1 auto");
    expect(root).toContain("min-width: 0");
  });

  it("compare_release_returns_edited", async () => {
    const { model } = await renderEditor();
    const before = model.content_id;
    const compare = container?.querySelector("[data-adp-image-compare]") as HTMLButtonElement;
    mocks.render.mockClear();
    await act(async () => {
      compare.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.render.mock.calls.some((call) => (call[1] as { compare_original: boolean }).compare_original)).toBe(true);
    await act(async () => {
      compare.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const last = mocks.render.mock.calls[mocks.render.mock.calls.length - 1][1] as { compare_original: boolean };
    expect(last.compare_original).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(model.content_id).toBe(before);
  });
});
