import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPsdCopy, scanPsdForImport, type PsdImportDependencies, type PsdImportPlan } from "../image-edit/psdImport";
import { assertProjectArchiveSize, sha256Hex } from "../image-edit/projectCodec";
import { PROJECT_MIME } from "../image-edit/projectTypes";
import { exportFlattenedProject } from "../services/imageProjects";
import type { ImageProjectInfo } from "../image-edit/projectTypes";
import type { JobHandle } from "../services/jobs";
import type { DocumentHandle } from "../documents/types";
import type { ImageModel } from "../image-edit/types";
import type { ExportSnapshot } from "../services/exportSnapshots";

const captured = vi.hoisted(() => ({
  calls: [] as Array<{ mime: string; revision: number; contentId: string }>,
}));

vi.mock("../image-edit/encode", () => ({
  captureEncodedSnapshot: async (
    _document: unknown,
    _model: unknown,
    revision: number,
    contentId: string,
    options: { mime: string },
  ): Promise<ExportSnapshot> => {
    captured.calls.push({ mime: options.mime, revision, contentId });
    return {
      snapshot_id: "00000000-0000-4000-8000-000000000001",
      document_id: "00000000-0000-4000-8000-000000000002",
      revision,
      content_id: contentId,
      mime: options.mime,
      byte_len: 10,
      storage_policy: "ordinary",
      expires_unix: 0,
    };
  },
}));

function plan(overrides: Partial<PsdImportPlan> = {}): PsdImportPlan {
  return {
    source_path: "C:\\Images\\photo.psd",
    source_sha256: "a".repeat(64),
    source_bytes: 1024,
    width: 16,
    height: 16,
    layers: [],
    unsupported: ["smart_object"],
    composite_available: true,
    editable_layer_count: 0,
    ...overrides,
  };
}

function info(): ImageProjectInfo {
  return {
    project_id: "00000000-0000-4000-8000-000000000003",
    width: 16,
    height: 16,
    layer_count: 1,
    unsupported_features: [],
    editable: true,
  };
}

function job(): JobHandle<ImageProjectInfo> {
  return { id: "test-job", cancel: async () => undefined, completion: Promise.resolve(info()) };
}

type TestDeps = PsdImportDependencies & { startImport: ReturnType<typeof vi.fn> };

function deps(overrides: Partial<PsdImportDependencies> = {}): TestDeps {
  const startImport = vi.fn(async () => job());
  return {
    scan: async () => plan(),
    ...overrides,
    startImport: (overrides.startImport as ReturnType<typeof vi.fn> | undefined) ?? startImport,
  } as TestDeps;
}

describe("PSD import and flattened export", () => {
  beforeEach(() => {
    captured.calls = [];
  });

  it("PSDunsupported_warningbeforecopy", async () => {
    const dependencies = deps();
    await expect(importPsdCopy(plan(), false, dependencies)).rejects.toThrow("image_project.unknown_required");
    expect(dependencies.startImport).not.toHaveBeenCalled();
    const accepted = deps();
    const handle = await importPsdCopy(plan(), true, accepted);
    expect(accepted.startImport).toHaveBeenCalledWith("C:\\Images\\photo.psd", "a".repeat(64), true);
    expect((await handle.completion).project_id).toBe(info().project_id);
  });

  it("sourcehash_unchanged", async () => {
    const dependencies = deps();
    const scanned = await scanPsdForImport("C:\\Images\\photo.psd", dependencies);
    expect(scanned.source_path).toBe("C:\\Images\\photo.psd");
    expect(scanned.source_sha256).toBe("a".repeat(64));
    await importPsdCopy(scanned, true, dependencies);
    expect(dependencies.startImport).toHaveBeenCalledWith("C:\\Images\\photo.psd", "a".repeat(64), true);
  });

  it("PNGexport_notproject", async () => {
    const model = { document_id: "doc", content_id: "content" } as unknown as ImageModel;
    const document = {} as DocumentHandle;
    const snapshot = await exportFlattenedProject(document, model, 3, "content", { mime: "image/png" });
    expect(snapshot.mime).toBe("image/png");
    expect(snapshot.mime).not.toBe(PROJECT_MIME);
    expect(captured.calls).toEqual([{ mime: "image/png", revision: 3, contentId: "content" }]);
  });

  it("encoded256MiBcap", () => {
    expect(() => assertProjectArchiveSize(256 * 1024 * 1024)).not.toThrow();
    expect(() => assertProjectArchiveSize(256 * 1024 * 1024 + 1)).toThrow("image_project.too_large");
    expect(() => assertProjectArchiveSize(0)).toThrow("image_project.bad_request");
  });

  it("sha256_known_vector", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
