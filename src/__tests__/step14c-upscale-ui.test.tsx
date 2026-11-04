import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";

const fixture = vi.hoisted(() => {
  const artifactId = "11111111-1111-4111-8111-111111111111";
  const result = {
    job_id: "ai-1",
    task: "upscale" as const,
    model_id: "realesr-general-x4v3",
    model_revision: "pack-1",
    result: {
      kind: "image" as const,
      artifact_id: artifactId,
      width: 8,
      height: 8,
      mime: "image/png" as const,
    },
    citations: [],
    warnings: [],
  };
  return {
    artifactId,
    result,
    mode: "ok" as "ok" | "missing",
    cancel: vi.fn(async () => undefined),
    start: vi.fn(),
    commit: vi.fn(async () => {
      throw new Error("image_edit.changed");
    }),
    storage: vi.fn(),
  };
});

vi.mock("../services/localAiRuntime", () => ({
  startAiTask: vi.fn(async () => {
    fixture.start();
    return {
      id: "ai-1",
      cancel: fixture.cancel,
      completion:
        fixture.mode === "missing"
          ? Promise.reject(new Error("ai.pack_missing"))
          : Promise.resolve(fixture.result),
    };
  }),
}));

vi.mock("../services/localAiArtifacts", () => ({
  acquireAiInput: vi.fn(async () => ({
    kind: "snapshot",
    id: "22222222-2222-4222-8222-222222222222",
    expected_revision: 1,
  })),
  releaseAiInput: vi.fn(async () => undefined),
  describeAiArtifact: vi.fn(async () => ({
    id: fixture.artifactId,
    kind: "image",
    byte_len: 16,
    expires_unix: 9_999_999_999,
    sensitive: false,
  })),
  readAiArtifact: vi.fn(async (_id: string, _offset: number, length: number) => new Uint8Array(length)),
  releaseAiArtifact: vi.fn(async () => undefined),
}));

vi.mock("../image-edit/tiles", () => ({
  getImageTileStore: () => ({
    publish: vi.fn(async (width: number, height: number) => ({
      id: "33333333-3333-4333-8333-333333333333",
      tile_x: 0,
      tile_y: 0,
      width,
      height,
      byte_len: width * height * 4,
      generation: 1,
    })),
  }),
}));

vi.mock("../image-edit/transactions", () => ({
  commitImageTransaction: fixture.commit,
}));

import UpscaleDialog from "../ai/UpscaleDialog";
import {
  applyUpscale,
  assertApplyIdentity,
  canDisplayPreview,
  comparisonKeyboard,
  updateUpscaleOptions,
  initialUpscaleState,
} from "../ai/upscale";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  fixture.mode = "ok";
  fixture.start.mockClear();
  fixture.cancel.mockClear();
  fixture.commit.mockClear();
  fixture.storage.mockClear();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 8, height: 8, close: () => undefined })));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(8 * 8 * 4) }),
    })),
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function renderDialog(overrides: Partial<Parameters<typeof UpscaleDialog>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const props = {
    input: {
      kind: "snapshot" as const,
      snapshot_id: "44444444-4444-4444-8444-444444444444",
      document_id: "doc-1",
      revision: 1,
    },
    documentId: "doc-1",
    expectedContentId: "55555555-5555-4555-8555-555555555555",
    onClose: vi.fn(),
    onOpenHelp: vi.fn(),
    beforeUrl: null,
    sourceSize: { width: 8, height: 8 },
    onOpenStorage: fixture.storage,
    ...overrides,
  };
  await act(async () => root?.render(<UpscaleDialog {...props} />));
  return props;
}

const wait = async (ms = 260) => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  });
};

describe("AI upscale dialog", () => {
  it("optionrev2_before1_shows2", () => {
    const first = initialUpscaleState();
    const second = updateUpscaleOptions(first, { scale: 2 });
    const preview = { revision: first.revision, contentId: "c1", result: fixture.result };
    expect(canDisplayPreview(preview, first.revision, "c1")).toBe(true);
    expect(canDisplayPreview(preview, second.revision, "c1")).toBe(false);
    expect(canDisplayPreview({ ...preview, revision: second.revision }, second.revision, "c1")).toBe(true);
    expect(canDisplayPreview({ ...preview, revision: second.revision }, second.revision, "c2")).toBe(false);
  });

  it("preview_never_dirty", async () => {
    await renderDialog();
    await wait();
    expect(fixture.start).toHaveBeenCalledTimes(1);
    expect(fixture.commit).not.toHaveBeenCalled();
  });

  it("apply_expectedcontent_mismatch_refused", async () => {
    expect(() => assertApplyIdentity("expected", "current")).toThrow("ai.source_changed");
    await expect(applyUpscale("doc-1", "expected", fixture.result)).rejects.toThrow("ai.source_changed");
    expect(fixture.commit).toHaveBeenCalledTimes(1);
  });

  it("keyboard_comparison_works", () => {
    expect(comparisonKeyboard(50, "ArrowRight", false)).toBe(51);
    expect(comparisonKeyboard(50, "ArrowRight", true)).toBe(60);
    expect(comparisonKeyboard(50, "ArrowLeft", false)).toBe(49);
    expect(comparisonKeyboard(50, "Home", false)).toBe(0);
    expect(comparisonKeyboard(50, "End", false)).toBe(100);
  });

  it("dialogclose_cancels_and_releases", async () => {
    const props = await renderDialog();
    await wait();
    const cancel = document.querySelector<HTMLButtonElement>("[data-ai-action='cancel']");
    expect(cancel).toBeTruthy();
    await act(async () => cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await wait(20);
    expect(fixture.cancel).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("missingpack_opens_storage_only", async () => {
    fixture.mode = "missing";
    await renderDialog();
    await wait();
    const storage = document.querySelector<HTMLButtonElement>("[data-ai-action='storage']");
    expect(storage).toBeTruthy();
    await act(async () => storage?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(fixture.storage).toHaveBeenCalledTimes(1);
    expect(fixture.start).toHaveBeenCalledTimes(1);
  });
});
