import { describe, expect, it } from "vitest";
import type { ExtractionSource } from "../services/aiExtractionTypes";
import type { PdfSourceIdentity } from "../services/pdf";
import {
  anchorRectForWord,
  mergeAnchorRects,
  normalizedToPixel,
  pixelToNormalized,
  qualifiesHeading,
  qualifiesTable,
  resolveBoundSources,
  tableRowAgreement,
} from "../extraction/sourceAnchors";

const STAMP_A = {
  path_key: "c:\\scans\\letter.pdf",
  volume_id: "1a2b3c4d",
  file_id: "0011223344556677",
  modified_ticks: "133700000000000000",
  size_bytes: 2048,
};

const STAMP_B = { ...STAMP_A, modified_ticks: "133700000000000001" };

function source(identity: PdfSourceIdentity): ExtractionSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    input: { kind: "document", id: "22222222-2222-4222-8222-222222222222", expected_revision: 1 },
    identity,
    display_name: "letter.pdf",
    page_count: 1,
    sensitive: false,
  };
}

describe("extraction layout heuristics", () => {
  it("layout_heading_threshold", () => {
    expect(qualifiesHeading(14, 10, 20)).toBe(true);
    expect(qualifiesHeading(13, 10, 20)).toBe(false);
    expect(qualifiesHeading(14, 10, 121)).toBe(false);
  });

  it("layout_table_alignment", () => {
    const agreeing = [
      [10, 210, 410],
      [11, 209, 411],
      [10, 210, 410],
      [10, 300, 410],
    ];
    expect(tableRowAgreement(agreeing, 1000)).toBeCloseTo(0.75, 9);
    expect(qualifiesTable(agreeing, 1000)).toBe(true);
    const disagreeing = [
      [10, 210, 410],
      [11, 209, 411],
      [10, 300, 410],
      [10, 320, 410],
    ];
    expect(tableRowAgreement(disagreeing, 1000)).toBeCloseTo(0.5, 9);
    expect(qualifiesTable(disagreeing, 1000)).toBe(false);
  });
});

describe("source anchors", () => {
  it("anchor_pixel_roundtrip", () => {
    expect(pixelToNormalized(100, 1000)).toBe(0.1);
    expect(normalizedToPixel(pixelToNormalized(100, 1000), 1000)).toBe(100);
    const rect = anchorRectForWord({ x: 100, y: 50, width: 200, height: 20 }, 1000, 500);
    expect(rect).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.04 });
    expect(normalizedToPixel(rect.x, 1000)).toBe(100);
  });

  it("anchor_merge_is_bounded", () => {
    const rect = mergeAnchorRects([
      {
        source_id: "11111111-1111-4111-8111-111111111111",
        page: 1,
        word_ids: [1],
        rect: { x: 0.1, y: 0.2, width: 0.1, height: 0.05 },
        quote: "Vendor",
      },
      {
        source_id: "11111111-1111-4111-8111-111111111111",
        page: 1,
        word_ids: [2],
        rect: { x: 0.3, y: 0.2, width: 0.1, height: 0.05 },
        quote: "Acme",
      },
    ]);
    // Normalized float arithmetic: compare the bounds, not bit-identical sums.
    expect(rect!.x).toBeCloseTo(0.1, 9);
    expect(rect!.y).toBeCloseTo(0.2, 9);
    expect(rect!.width).toBeCloseTo(0.3, 9);
    expect(rect!.height).toBeCloseTo(0.05, 9);
  });

  it("source_changed_aborts", () => {
    const bound = source({ kind: "disk", stamp: STAMP_A });
    const unchanged = resolveBoundSources([bound], new Map([[bound.id, { kind: "disk", stamp: STAMP_A }]]));
    expect(unchanged.ok).toBe(true);
    const changed = resolveBoundSources([bound], new Map([[bound.id, { kind: "disk", stamp: STAMP_B }]]));
    expect(changed).toEqual({ ok: false, error: "ai_extract.changed", sources: [] });
    expect(changed.sources).toHaveLength(0);
  });

  it("snapshot_identity_keeps_content_id_and_no_stamp", () => {
    const identity: PdfSourceIdentity = {
      kind: "snapshot",
      document_id: "33333333-3333-4333-8333-333333333333",
      revision: 4,
      content_id: "44444444-4444-4444-8444-444444444444",
      sensitive: false,
    };
    const encoded = JSON.stringify(identity);
    expect(encoded).toContain("44444444-4444-4444-8444-444444444444");
    expect(encoded).not.toContain("stamp");
  });
});
