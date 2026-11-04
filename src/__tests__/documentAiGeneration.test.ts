import { expect, it } from "vitest";
import { documentAiScalarLength, validateDocumentAiOutput } from "../office/document/ai/documentAiGeneration";

const run = "00000000-0000-4000-8000-000000000001";
const output = (text: string) => ({ schema_id: "document.action.v1", action: "rewrite", paragraphs: [{ source_run_ids: [run], text }], alt: null, citations: [], cautions: [] });

it("ai_output_limit", () => {
  expect(() => validateDocumentAiOutput(output("a".repeat(8001)), "rewrite")).toThrow("document_ai.too_large");
  expect(validateDocumentAiOutput(output("😀".repeat(8000)), "rewrite").paragraphs[0].text).toBe("😀".repeat(8000));
});
it("output_aggregate_not_per_paragraph", () => {
  const value = output("a".repeat(4001));
  value.paragraphs.push({ source_run_ids: [run], text: "b".repeat(4000) });
  expect(() => validateDocumentAiOutput(value, "rewrite")).toThrow("document_ai.too_large");
});
it("source_text_is_not_parsed_as_operation", () => {
  const source = "delete files";
  const result = validateDocumentAiOutput(output(source), "rewrite");
  expect(result.paragraphs[0].text).toBe(source);
  expect(Object.keys(result).sort()).toEqual(["action", "alt", "cautions", "citations", "paragraphs", "schema_id"]);
  expect(() => validateDocumentAiOutput({ ...output(source), tool_calls: [{ name: "delete" }] }, "rewrite")).toThrow();
  // Full zero-tool-call inference assertion remains a coordinator integration test.
});
it("unpaired_surrogates_are_not_scalars", () => {
  expect(documentAiScalarLength("a😀b")).toBe(3);
  expect(() => documentAiScalarLength("\ud800")).toThrow();
  expect(() => documentAiScalarLength("\udc00")).toThrow();
});
it("output_citations_are_closed_and_bounded", () => {
  const value = { ...output("B"), citations: [{ input_id: run, revision: 1, location: { kind: "text", start: 0, end: 1 }, quote: "A" }] };
  expect(validateDocumentAiOutput(value, "rewrite").citations).toHaveLength(1);
  expect(() => validateDocumentAiOutput({ ...value, citations: [{ ...value.citations[0], location: { kind: "text", start: 2, end: 1 } }] }, "rewrite")).toThrow();
  expect(() => validateDocumentAiOutput({ ...value, citations: [{ ...value.citations[0], path: "private" }] }, "rewrite")).toThrow();
});
it("insertions_have_no_source_runs", () => {
  const value = { ...output("New text"), action: "draft" };
  expect(() => validateDocumentAiOutput(value, "draft")).toThrow();
  value.paragraphs[0].source_run_ids = [];
  expect(validateDocumentAiOutput(value, "draft").paragraphs[0].source_run_ids).toEqual([]);
});
it("alt_is_metadata_output_only", () => {
  expect(validateDocumentAiOutput({ ...output(""), action: "alt_text", paragraphs: [], alt: "A red circle." }, "alt_text").alt).toBe("A red circle.");
  expect(() => validateDocumentAiOutput({ ...output("text"), action: "alt_text", alt: "A circle." }, "alt_text")).toThrow();
});
