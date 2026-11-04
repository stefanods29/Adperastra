import { describe, expect, it } from "vitest";
import { documentIndent, documentParagraphOperation } from "../office/document/DocumentParagraphDialog";
import { documentFontSize, nextDocumentToggle } from "../office/document/DocumentFontControls";
import { documentMillimetersToPoints, documentPageOperation } from "../office/document/DocumentPageDialog";
import type { PageLayout } from "../office/types";

describe("document formatting", () => {
  it("mixedboldindeterminate,toggle->true", () => {
    expect(nextDocumentToggle({ kind: "mixed" })).toBe(true);
    expect(nextDocumentToggle({ kind: "value", value: true })).toBe(false);
    expect(() => nextDocumentToggle({ kind: "unavailable", reason_key: "office.unsupported" })).toThrow("office_edit.unsupported");
  });
  it("leftindent18->36/outdent18->0", () => {
    expect(documentIndent(18, "indent")).toEqual({ indent_left_pt: 36 });
    expect(documentIndent(18, "outdent")).toEqual({ indent_left_pt: 0 });
    expect(documentIndent(8, "outdent")).toEqual({ indent_left_pt: 0 });
  });
  it("formattingselectionnotwholefile", () => {
    const ids = ["00000000-0000-4000-8000-000000000001"];
    const op = documentParagraphOperation(ids, { line_spacing: 1.5 });
    ids.push("unselected");
    expect(op).toMatchObject({ block_ids: ["00000000-0000-4000-8000-000000000001"] });
    expect(() => documentParagraphOperation([], { align: "left" })).toThrow();
  });
  it("A4margins20mm->56.692913pt", () => {
    expect(documentMillimetersToPoints(20)).toBeCloseTo(56.692913, 6);
  });
  it("invalidmarginsfailwithoutedit", () => {
    const layout: PageLayout = { width_pt: 595.28, height_pt: 841.89,
      margins: { top: 20, right: 400, bottom: 20, left: 20 }, columns: 1, column_gap_pt: 0 };
    expect(() => documentPageOperation("section", layout)).toThrow("office_edit.invalid");
    expect(layout.margins.right).toBe(400);
  });
  it("rejects invalid sizes", () => {
    expect(() => documentFontSize(NaN)).toThrow();
    expect(() => documentFontSize(401)).toThrow();
    expect(documentFontSize(11)).toEqual({ size_pt: 11 });
  });
});
