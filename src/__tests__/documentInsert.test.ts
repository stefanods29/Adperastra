import { describe, expect, it } from "vitest";
import { documentInsertLink, documentInsertTable } from "../office/document/DocumentInsertDialogs";
import { documentRefreshContents } from "../office/document/DocumentReferenceDialogs";
import { documentRulerPoints } from "../office/document/DocumentRuler";

describe("document insertion", () => {
  const position = { block_id: "00000000-0000-4000-8000-000000000001", offset_utf16: 0 };
  const span = { anchor: position, focus: position, revision: 1 };
  it("linkjavascriptrefused", () => {
    expect(() => documentInsertLink(span, "javascript:alert(1)")).toThrow();
    expect(() => documentInsertLink(span, "data:text/html,hello")).toThrow();
    expect(documentInsertLink(span, "https://example.org")).toMatchObject({ target: { scheme: "https" } });
  });
  it("table100x100valid101rowsrefused", () => {
    expect(documentInsertTable(position, 100, 100)).toMatchObject({ rows: 100, columns: 100 });
    expect(() => documentInsertTable(position, 101, 1)).toThrow();
  });
  it("TOCrefreshonlyfieldID", () => {
    expect(documentRefreshContents(position.block_id)).toEqual({ kind: "refresh_field", field_id: position.block_id });
  });
  it("ruleroperationusesdocumentpointsat200%zoom", () => {
    expect(documentRulerPoints(1280, 595.28, 200)).toBeCloseTo(595.28);
    expect(documentRulerPoints(640, 595.28, 100)).toBeCloseTo(595.28);
  });
});
