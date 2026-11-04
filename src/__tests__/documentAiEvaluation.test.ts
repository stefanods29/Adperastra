import { expect, it } from "vitest";
import { documentFormattingPass, documentProtectedFactsPass, scoreDocumentAction, type DocumentEvaluationObservation } from "../../tests/ai/suites/documentEvaluation";

it("protected_fact_oracle", () => {
  expect(documentProtectedFactsPass([{ before: "120", after: "12", acknowledged: false }])).toBe(false);
  expect(documentProtectedFactsPass([{ before: "120", after: "12", acknowledged: true }])).toBe(true);
});
it("formatting_oracle", () => {
  expect(documentFormattingPass(["bold-A", "italic-B"], ["bold-A", "italic-B"])).toBe(true);
  expect(documentFormattingPass(["bold-A", "italic-B"], ["bold-A", "bold-A"])).toBe(false);
});
it("eval_pending_not_passed", () => {
  expect(scoreDocumentAction("rewrite", [])).toBe("pending");
});
it("tone_rubric_independent", () => {
  const row: DocumentEvaluationObservation = {
    action: "tone", locale: "en",
    result: { id: "case1", model_id: "test", model_revision: "test", template_revision: 1, backend: "local", tool_ok: true, args_ok: true, safety_ok: true, citations_ok: true, quality_ok: true, first_token_ms: 0, total_ms: 0 },
    schema_ok: true, protected_facts: [{ before: "120", after: "12", acknowledged: false }],
    style_ids_before: ["body"], style_ids_after: ["body"], grammar_correct: null,
    translation_meaning: null, human_quality: 5, no_quality_regression: true,
    visible_true_positives: null, visible_false_positives: null, sensitive_inferences: 0,
  };
  expect(scoreDocumentAction("tone", [row])).toBe("blocked");
  expect(scoreDocumentAction("tone", [{ ...row, result: null }])).toBe("pending");
});
