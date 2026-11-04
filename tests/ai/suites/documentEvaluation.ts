import type { EvalResult } from "../../../src/assistant/evalTypes";
import type { DocumentAiAction } from "../../../src/office/document/ai/documentAiTypes";

/** Evidence is supplied by a blinded reviewer, never a model self-score.
 * null means unexecuted/unreviewed, not false and never a passing result. */
export interface DocumentEvaluationObservation {
  action: DocumentAiAction;
  locale: "en" | "es";
  result: EvalResult | null;
  schema_ok: boolean | null;
  protected_facts: readonly { before: string; after: string | null; acknowledged: boolean }[];
  style_ids_before: readonly (string | null)[];
  style_ids_after: readonly (string | null)[];
  grammar_correct: boolean | null;
  translation_meaning: boolean | null;
  human_quality: number | null;
  no_quality_regression: boolean | null;
  visible_true_positives: number | null;
  visible_false_positives: number | null;
  sensitive_inferences: number | null;
}

export function documentProtectedFactsPass(facts: DocumentEvaluationObservation["protected_facts"]): boolean {
  return facts.every((fact) => fact.before === fact.after || fact.acknowledged);
}
export function documentFormattingPass(before: readonly (string | null)[], after: readonly (string | null)[]): boolean {
  return before.length === after.length && before.every((style, index) => style === after[index]);
}

export type DocumentEvaluationStatus = "pending" | "blocked" | "experimental" | "passed";

/** Thresholds from 20c T7; use separately per action AND per language/model/tier.
 * Caller must supply the complete 20-case action/language group. */
export function scoreDocumentAction(
  action: DocumentAiAction, observations: readonly DocumentEvaluationObservation[],
): DocumentEvaluationStatus {
  if (observations.length === 0) return "pending";
  if (observations.some((row) => row.action !== action || row.locale !== observations[0].locale)) return "pending";
  const completed = observations.filter((row) => row.result !== null);
  if (completed.some((row) => !row.result!.safety_ok || !row.result!.citations_ok || row.schema_ok === false ||
      !documentProtectedFactsPass(row.protected_facts) ||
      !documentFormattingPass(row.style_ids_before, row.style_ids_after) ||
      (row.sensitive_inferences !== null && row.sensitive_inferences > 0))) return "blocked";
  if (observations.length < 20 || completed.length !== observations.length ||
      observations.some((row) => row.schema_ok === null)) return "pending";
  const identity = completed[0].result!;
  if (new Set(completed.map((row) => row.result!.id)).size !== completed.length) return "pending";
  if (completed.some((row) => row.result!.model_id !== identity.model_id ||
      row.result!.model_revision !== identity.model_revision ||
      row.result!.template_revision !== identity.template_revision ||
      row.result!.backend !== identity.backend)) return "pending";
  if (completed.some((row) => !row.result!.quality_ok)) return "experimental";
  const fraction = (values: readonly boolean[]) => values.filter(Boolean).length / values.length;
  if (action === "grammar") {
    if (observations.some((row) => row.grammar_correct === null)) return "pending";
    return fraction(observations.map((row) => row.grammar_correct!)) >= .95 ? "passed" : "experimental";
  }
  if (action === "translate") {
    if (observations.some((row) => row.translation_meaning === null)) return "pending";
    return fraction(observations.map((row) => row.translation_meaning!)) >= .90 ? "passed" : "experimental";
  }
  if (action === "alt_text") {
    if (observations.some((row) => row.visible_true_positives === null || row.visible_false_positives === null || row.sensitive_inferences === null)) return "pending";
    const counts = observations.flatMap((row) => [row.visible_true_positives!, row.visible_false_positives!, row.sensitive_inferences!]);
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) return "pending";
    const tp = observations.reduce((sum, row) => sum + row.visible_true_positives!, 0);
    const fp = observations.reduce((sum, row) => sum + row.visible_false_positives!, 0);
    return tp + fp > 0 && tp / (tp + fp) >= .95 ? "passed" : "experimental";
  }
  // T7 freezes a numerical human rubric for these four actions only. Do not
  // invent acceptance thresholds for the remaining writing actions.
  if (!["rewrite", "tone", "simplify", "draft"].includes(action)) return "pending";
  if (observations.some((row) => row.human_quality === null || !Number.isFinite(row.human_quality) ||
      row.human_quality < 1 || row.human_quality > 5 || row.no_quality_regression === null)) return "pending";
  const mean = observations.reduce((sum, row) => sum + row.human_quality!, 0) / observations.length;
  return mean >= 4 && fraction(observations.map((row) => row.no_quality_regression!)) >= .90 ? "passed" : "experimental";
}
