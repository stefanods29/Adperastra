import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import CurvesPanel from "../image-edit/CurvesPanel";
import { encodeImageProject } from "../image-edit/projectCodec";
import { flattenedProjectExportPlan } from "../image-edit/projectCodec";
import { getImageTileStore, publishTileAt } from "../image-edit/tiles";
import {
  createDefaultAdjustments,
  createDefaultGeometry,
  newUuid,
  type ImageModel,
} from "../image-edit/types";
import { initialDocumentState, stateAfterContentChange, stateAfterSave } from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const uploads = vi.hoisted(() => ({
  metadata: null as Record<string, unknown> | null,
  bytesIsUint8: false,
  released: 0,
}));

vi.mock("../services/exportSnapshots", () => ({
  uploadSnapshot: async (metadata: Record<string, unknown>, bytes: Uint8Array): Promise<ExportSnapshot> => {
    uploads.metadata = metadata;
    uploads.bytesIsUint8 = bytes instanceof Uint8Array;
    return {
      snapshot_id: "00000000-0000-4000-8000-000000000010",
      document_id: String(metadata.document_id),
      revision: Number(metadata.revision),
      content_id: String(metadata.content_id),
      mime: String(metadata.mime),
      byte_len: bytes.byteLength,
      storage_policy: "ordinary",
      expires_unix: 0,
    };
  },
  releaseExportSnapshot: async () => {
    uploads.released += 1;
  },
}));

vi.mock("../services/imageProjects", () => ({
  openImageProjectDetailed: async () => {
    throw new Error("image_project.failed");
  },
  captureImageProject: async () => {
    throw new Error("image_project.failed");
  },
}));

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

async function modelWithTile(): Promise<ImageModel> {
  const documentId = newUuid();
  const contentId = newUuid();
  const store = getImageTileStore(documentId);
  const tile = await publishTileAt(store, 0, 0, 1, 1, new Uint8Array([255, 0, 0, 255]));
  return {
    schema_version: 1,
    document_id: documentId,
    content_id: contentId,
    width: 1,
    height: 1,
    source_snapshot: snapshot(documentId, contentId),
    original_tiles: [tile],
    layers: [
      {
        kind: "raster",
        id: newUuid(),
        name: "Base",
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
    geometry: createDefaultGeometry(1, 1),
    adjustments: createDefaultAdjustments(),
    overlays: [],
    metadata: [],
  };
}

let componentRoot: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (componentRoot) await act(async () => componentRoot?.unmount());
  container?.remove();
  componentRoot = null;
  container = null;
});

beforeEach(() => {
  uploads.metadata = null;
  uploads.bytesIsUint8 = false;
  uploads.released = 0;
  localStorage.clear();
  sessionStorage.clear();
});

describe("painting, adjustments and project help", () => {
  it("both languages have the painting, adjustment, text and project pages", () => {
    const english = readdirSync(join(root, "help", "en")).sort();
    const spanish = readdirSync(join(root, "help", "es")).sort();
    expect(spanish).toEqual(english);
    for (const page of ["painting-tools.md", "adjustment-layers.md", "image-text-shapes.md", "image-projects.md"]) {
      expect(english).toContain(page);
      expect(readFileSync(join(root, "help", "en", page), "utf8")).toContain("See also:");
      expect(readFileSync(join(root, "help", "es", page), "utf8")).toContain("Consulta también:");
    }
    expect(readFileSync(join(root, "help", "en", "image-projects.md"), "utf8")).toContain(".adimage");
    expect(readFileSync(join(root, "help", "es", "image-projects.md"), "utf8")).toContain(".adimage");
  });

  it("curveskeyboard_points", async () => {
    const changes: unknown[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    componentRoot = createRoot(container);
    const adjustment = {
      kind: "curves" as const,
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ],
    };
    await act(async () => {
      componentRoot?.render(
        createElement(CurvesPanel, {
          adjustment,
          onChange: (next) => changes.push(next),
          onApply: () => undefined,
          onClose: () => undefined,
        }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-adp-curve-point="1"][data-adp-curve-axis="y"] input',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(changes).toHaveLength(1);
    const next = changes[0] as { kind: "curves"; points: Array<{ x: number; y: number }> };
    expect(next.kind).toBe("curves");
    expect(next.points[1].y).toBeCloseTo(0.51, 6);
  });

  it("projectsave_oldrevision_newdirty", async () => {
    const model = await modelWithTile();
    const snapshot = await encodeImageProject(model, 1, [], 96);
    expect(snapshot.revision).toBe(1);
    expect(uploads.metadata?.document_id).toBe(model.document_id);
    expect(uploads.metadata?.content_id).toBe(model.content_id);
    expect(uploads.metadata?.revision).toBe(1);
    const current = stateAfterContentChange(initialDocumentState(model.content_id), newUuid());
    const afterOldSave = stateAfterSave(current, 1, model.content_id);
    expect(afterOldSave.saved_revision).toBe(1);
    expect(afterOldSave.dirty).toBe(true);
  });

  it("sensitivecache_empty", async () => {
    const model = await modelWithTile();
    await encodeImageProject(model, 1, [], 96);
    expect(uploads.bytesIsUint8).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    const plan = flattenedProjectExportPlan("image/png");
    expect(plan.include_guides).toBe(false);
  });
});
