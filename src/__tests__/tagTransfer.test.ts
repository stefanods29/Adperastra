import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../services/jobs", () => ({ runJob: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { ConversionReport } from "../convert/types";
import type { JobHandle } from "../services/jobs";
import { runJob } from "../services/jobs";
import {
  applyTagImport,
  exportTags,
  importTags,
  registerTagHistory,
  writeEmbeddedTags,
  type TagCatalog,
  type TagExportResult,
} from "../services/tags";
import { UiHistoryRegistry } from "../services/uiHistory";

const mockedInvoke = vi.mocked(invoke);
const mockedRunJob = vi.mocked(runJob);

const catalog: TagCatalog = {
  schema_version: 1,
  tags: [],
  revision: 2,
  history_id: "11111111-2222-4333-8444-555555555555",
};

const previewId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const incomingId = "0f8fad1e-0001-4a3b-9c4d-000000000001";

registerTagHistory();

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedRunJob.mockReset();
});

function exportHandle(): JobHandle<TagExportResult> {
  return {
    id: "tagsex-test",
    cancel: async () => undefined,
    completion: Promise.resolve({
      path: "C:\\Exports\\tags.adptags",
      bytes: 640,
    }),
  };
}

function copyReport(): ConversionReport {
  return {
    report_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    items: [],
    outputs: [],
    created_paths: [],
    input_total: 1,
    done_count: 1,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    outputs_created: 1,
    cancelled: false,
    job_finished: true,
    complete: true,
  };
}

describe("tag transfer service", () => {
  it("defaultnofilepaths", async () => {
    // The native test tag_transfer::default_has_no_file_paths proves the
    // bytes: a catalog-only export carries no assignments and no location.
    // Here the UI contract is fixed: the default request never asks for
    // personal locations.
    mockedRunJob.mockImplementation(async (_prefix, start) => {
      await start("tagsex-test");
      return exportHandle();
    });
    const handle = await exportTags("C:\\Exports\\tags.adptags", false);
    expect(handle.id).toBe("tagsex-test");
    expect(mockedRunJob.mock.calls[0][0]).toBe("tagsex");
    expect(mockedInvoke).toHaveBeenCalledWith("tags_export_start", {
      destPath: "C:\\Exports\\tags.adptags",
      includePaths: false,
      requestId: "tagsex-test",
    });
  });

  it("importidentitymismatchrefused", async () => {
    // A saved stable identity that no longer matches its file refuses the
    // whole import before any write, and no Undo entry is recorded.
    const historyBefore = UiHistoryRegistry.size;
    mockedInvoke.mockRejectedValueOnce(new Error("tags.import_identity"));
    await expect(applyTagImport(previewId, [], true)).rejects.toThrow(
      "tags.import_identity",
    );
    expect(mockedInvoke).toHaveBeenCalledWith("tags_import_apply", {
      previewId,
      choices: [],
      allowPaths: true,
    });
    expect(UiHistoryRegistry.size).toBe(historyBefore);
  });

  it("import preview reads the chosen file", async () => {
    const preview = {
      preview_id: previewId,
      catalog,
      contains_paths: false,
      conflicts: [
        {
          name: "Work",
          incoming_id: incomingId,
          existing_id: "0f8fad1e-0002-4a3b-9c4d-000000000002",
        },
      ],
    };
    mockedInvoke.mockResolvedValueOnce(preview);
    await expect(importTags("C:\\Exports\\tags.adptags")).resolves.toEqual(
      preview,
    );
    expect(mockedInvoke).toHaveBeenCalledWith("tags_import_preview", {
      path: "C:\\Exports\\tags.adptags",
    });
  });

  it("an explicit merge choice is forwarded and records Undo", async () => {
    const historyBefore = UiHistoryRegistry.size;
    mockedInvoke.mockResolvedValueOnce(catalog);
    await applyTagImport(
      previewId,
      [{ incoming_id: incomingId, action: "merge" }],
      false,
    );
    expect(mockedInvoke).toHaveBeenCalledWith("tags_import_apply", {
      previewId,
      choices: [{ incoming_id: incomingId, action: "merge" }],
      allowPaths: false,
    });
    expect(UiHistoryRegistry.size).toBe(historyBefore + 1);
  });

  it("embedded tags are a bounded new-copy job", async () => {
    // The native tests xmp_unknown_namespace_preserved and
    // pixel_hash_unchanged prove the copy content; this pins the request.
    await expect(writeEmbeddedTags([], null)).rejects.toThrow("tags.invalid");
    expect(mockedRunJob).not.toHaveBeenCalled();

    mockedRunJob.mockImplementation(async (_prefix, start) => {
      await start("tagsw-test");
      return {
        id: "tagsw-test",
        cancel: async () => undefined,
        completion: Promise.resolve(copyReport()),
      };
    });
    await writeEmbeddedTags(["C:\\Photos\\a.jpg"], "C:\\Photos\\Tagged");
    expect(mockedRunJob.mock.calls[0][0]).toBe("tagsw");
    expect(mockedInvoke).toHaveBeenCalledWith("tags_write_start", {
      paths: ["C:\\Photos\\a.jpg"],
      destDir: "C:\\Photos\\Tagged",
      requestId: "tagsw-test",
    });
  });
});
