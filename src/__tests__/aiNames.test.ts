import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiNameSuggestion } from "../services/aiSearchTypes";
import type { DocumentInfo } from "../documents/types";
import type { SourceStamp } from "../services/cache";
import { previewRename, executeRename } from "../services/bulkRename";

const documentGet = vi.fn();

vi.mock("../documents/DocumentRegistry", () => ({
  DocumentRegistry: { get: (id: string) => documentGet(id) },
}));

vi.mock("../services/bulkRename", () => ({
  previewRename: vi.fn(() => ({
    id: "preview",
    cancel: async () => undefined,
    completion: Promise.resolve({
      plan_id: "44444444-4444-4444-8444-444444444444",
      request_revision: 1,
      rows: [],
      total: 1,
      ready: 1,
      invalid: 0,
      conflicts: 0,
      expires_unix: 2_000_000_000,
      all_rows_valid: true,
    }),
  })),
  executeRename: vi.fn(),
}));

const { assertFreshStamp, fileNameForStem, normalizeProposedStem, previewSuggestedNames } = await import(
  "../rename/aiNameAdapter"
);

const stamp: SourceStamp = {
  path_key: "c:\\docs\\scan001.pdf",
  volume_id: "00000001",
  file_id: "0000000000000001",
  modified_ticks: "133000000000000000",
  size_bytes: 3,
};

const info: DocumentInfo = {
  document_id: "33333333-3333-4333-8333-333333333333",
  source: { kind: "disk", path: "C:\\Docs\\scan001.PDF" },
  name: "scan001.PDF",
  ext: "pdf",
  mime: "application/pdf",
  size: 3,
  modified_unix: 1_655_526_400,
  read_only: false,
  from_internet: false,
  sensitive: false,
  disk_path: "C:\\Docs\\scan001.PDF",
};

const suggestion: AiNameSuggestion = {
  source: {
    kind: "document",
    id: "33333333-3333-4333-8333-333333333333",
    expected_revision: 1,
  },
  source_stamp: stamp,
  proposed_stem: "Invoice",
  reason: "The scan is an invoice.",
  confidence: 0.8,
  citations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  documentGet.mockReturnValue({ info, getState: () => ({}) });
});

describe("AI name suggestions", () => {
  it("ai_name_preserves_extension", () => {
    expect(fileNameForStem("scan001.PDF", "Invoice")).toBe("Invoice.PDF");
  });

  it("ai_name_reserved", () => {
    expect(normalizeProposedStem("CON")).toMatchObject({ valid: false, reason: "reserved" });
    expect(fileNameForStem("scan001.PDF", "CON")).toBe("CON.PDF");
  });

  it("ai_name_separator", () => {
    const normalized = normalizeProposedStem("a/b");
    expect(normalized.stem).toBe("a_b");
    expect(normalized.changed).toBe(true);
  });

  it("ai_name_preview_not_execute", async () => {
    await previewSuggestedNames([suggestion], ["Invoice"], 1);
    expect(previewRename).toHaveBeenCalledTimes(1);
    expect(executeRename).not.toHaveBeenCalled();
  });

  it("ai_name_stale_stamp", () => {
    expect(() => assertFreshStamp({ ...stamp, modified_ticks: "133000000000000001" }, info)).toThrow(
      "ai_search.changed",
    );
  });
});
