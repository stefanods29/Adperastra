/** Bilingual extraction and inline evaluation (Step 17d T7, `ai-eval-1`).
 *
 * Fixtures are literal, rights-cleared synthetic records; predictions come
 * from a real run. Scoring is deterministic and measured per locale. A failed
 * quality threshold marks the feature Experimental and off; any unsafe inline
 * action fails the whole inline capability. No score exists before a run.
 */

import {
  isUnsafeSuggestion,
  receiptOracle,
  receiptUncertain,
  tableCellF1,
  wordErrorRate,
} from "./extractionScoring";

export type EvalLocale = "en" | "es";
export type Degradation = "clean" | "degraded";

export interface ScanFixture {
  id: string;
  locale: EvalLocale;
  degradation: Degradation;
  text: string;
}

export interface TableFixture {
  id: string;
  locale: EvalLocale;
  degradation: Degradation;
  rows: string[][];
}

export interface ReceiptFixture {
  id: string;
  locale: EvalLocale;
  fields: {
    date: string;
    vendor: string;
    tax_id: string;
    currency: string;
    subtotal: string;
    tax: string;
    total: string;
  };
  uncertain_fields?: string[];
}

export interface InlineCase {
  id: string;
  locale: EvalLocale;
  file_type: "text" | "markdown" | "code";
  before: string;
  acceptable: string[];
}

export interface ScanPrediction {
  id: string;
  text: string;
}

export interface TablePrediction {
  id: string;
  rows: string[][];
}

export interface ReceiptPrediction {
  id: string;
  vendor: string;
  tax_id: string;
  currency_code: string | null;
  date_iso: string | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  total_minor: number | null;
  arithmetic_ok: boolean | null;
  invented_fields?: string[];
}

export interface InlineReview {
  id: string;
  text: string;
  accepted: boolean;
}

export interface ScanQuality {
  clean_wer: number;
  degraded_wer: number;
  cases: number;
}

export interface TableQuality {
  clean_f1: number;
  degraded_f1: number;
  cases: number;
}

export interface ReceiptQuality {
  exact_critical_rate: number;
  uncertain_recall: number;
  invented_fields: number;
  guessed_currency: number;
  cases: number;
}

export interface InlineQuality {
  acceptability: number;
  unsafe_executions: number;
  cases: number;
}

export interface ExtractionEvaluationInput {
  suite_id: string;
  locale: EvalLocale;
  scans: { fixtures: ScanFixture[]; predictions: ScanPrediction[] };
  tables: { fixtures: TableFixture[]; predictions: TablePrediction[] };
  receipts: { fixtures: ReceiptFixture[]; predictions: ReceiptPrediction[] };
  inline: { cases: InlineCase[]; reviews: InlineReview[] };
}

export interface ExtractionEvaluationReport {
  suite_id: string;
  locale: EvalLocale;
  state: "measured";
  scans: ScanQuality;
  tables: TableQuality;
  receipts: ReceiptQuality;
  inline: InlineQuality;
  thresholds_passed: boolean;
  quality_tier: "verified" | "Experimental";
  enabled: boolean;
  unsafe_action_blocked: boolean;
}

export interface PendingEvaluationReport {
  suite_id: string;
  state: "pending";
  scores: null;
  percent: null;
}

export const EXTRACTION_THRESHOLDS = {
  clean_wer: 0.05,
  degraded_wer: 0.15,
  clean_table_f1: 0.95,
  degraded_table_f1: 0.85,
  receipt_exact: 0.95,
  uncertain_recall: 0.95,
  inline_acceptability: 0.8,
} as const;

/** Nothing measured yet: no percent and no pass may be shown (T7). */
export function pendingEvaluationReport(suiteId: string): PendingEvaluationReport {
  return { suite_id: suiteId, state: "pending", scores: null, percent: null };
}


export function evaluateExtractionSuite(input: ExtractionEvaluationInput): ExtractionEvaluationReport {
  const scanPrediction = new Map(input.scans.predictions.map((entry) => [entry.id, entry.text]));
  let cleanTotal = 0;
  let cleanCount = 0;
  let degradedTotal = 0;
  let degradedCount = 0;
  for (const fixture of input.scans.fixtures) {
    const predicted = scanPrediction.get(fixture.id);
    if (predicted === undefined) continue;
    const error = wordErrorRate(fixture.text, predicted);
    if (fixture.degradation === "clean") {
      cleanTotal += error;
      cleanCount += 1;
    } else {
      degradedTotal += error;
      degradedCount += 1;
    }
  }
  const cleanWer = cleanCount === 0 ? 1 : cleanTotal / cleanCount;
  const degradedWer = degradedCount === 0 ? 1 : degradedTotal / degradedCount;

  const tablePrediction = new Map(input.tables.predictions.map((entry) => [entry.id, entry.rows]));
  let cleanF1 = 1;
  let degradedF1 = 1;
  for (const fixture of input.tables.fixtures) {
    const predicted = tablePrediction.get(fixture.id);
    if (!predicted) {
      if (fixture.degradation === "clean") cleanF1 = 0;
      else degradedF1 = 0;
      continue;
    }
    const score = tableCellF1(fixture.rows, predicted).f1;
    if (fixture.degradation === "clean") cleanF1 = Math.min(cleanF1, score);
    else degradedF1 = Math.min(degradedF1, score);
  }

  const receiptPrediction = new Map(input.receipts.predictions.map((entry) => [entry.id, entry]));
  let exact = 0;
  let reviewed = 0;
  let recalled = 0;
  let invented = 0;
  let guessedCurrency = 0;
  for (const fixture of input.receipts.fixtures) {
    const expected = receiptOracle(fixture);
    const predicted = receiptPrediction.get(fixture.id);
    const uncertain = receiptUncertain(fixture);
    reviewed += uncertain.length;
    if (!predicted) {
      continue;
    }
    invented += predicted.invented_fields?.length ?? 0;
    if (expected.currency_code === null && predicted.currency_code !== null) guessedCurrency += 1;
    const critical = [
      fixture.fields.vendor === predicted.vendor,
      fixture.fields.tax_id === predicted.tax_id,
      expected.date_iso === predicted.date_iso,
      expected.currency_code === predicted.currency_code,
      expected.subtotal_minor === predicted.subtotal_minor,
      expected.tax_minor === predicted.tax_minor,
      expected.total_minor === predicted.total_minor,
      expected.arithmetic_ok === predicted.arithmetic_ok,
    ];
    if (critical.every(Boolean)) exact += 1;
    for (const field of uncertain) {
      const flagged =
        (field === "date" && predicted.date_iso === null) ||
        (field === "currency" && predicted.currency_code === null) ||
        (field === "total" && predicted.arithmetic_ok === false);
      if (flagged) recalled += 1;
    }
  }
  const receiptCount = Math.max(1, input.receipts.fixtures.length);
  const exactRate = exact / receiptCount;
  const uncertainRecall = reviewed === 0 ? 1 : recalled / reviewed;

  const inlineReviews = new Map(input.inline.reviews.map((entry) => [entry.id, entry.text]));
  let acceptable = 0;
  let inlineCount = 0;
  let unsafe = 0;
  for (const testCase of input.inline.cases) {
    const text = inlineReviews.get(testCase.id);
    if (text === undefined) continue;
    inlineCount += 1;
    if (isUnsafeSuggestion(text)) unsafe += 1;
    if (testCase.acceptable.some((expected) => text.trim() === expected.trim())) acceptable += 1;
  }
  const acceptability = inlineCount === 0 ? 0 : acceptable / inlineCount;
  const inlineCases = input.inline.cases.length;

  const thresholdsPassed =
    cleanWer <= EXTRACTION_THRESHOLDS.clean_wer &&
    degradedWer <= EXTRACTION_THRESHOLDS.degraded_wer &&
    cleanF1 >= EXTRACTION_THRESHOLDS.clean_table_f1 &&
    degradedF1 >= EXTRACTION_THRESHOLDS.degraded_table_f1 &&
    exactRate >= EXTRACTION_THRESHOLDS.receipt_exact &&
    uncertainRecall >= EXTRACTION_THRESHOLDS.uncertain_recall &&
    invented === 0 &&
    guessedCurrency === 0 &&
    inlineCases > 0 &&
    acceptability >= EXTRACTION_THRESHOLDS.inline_acceptability &&
    unsafe === 0;

  return {
    suite_id: input.suite_id,
    locale: input.locale,
    state: "measured",
    scans: { clean_wer: cleanWer, degraded_wer: degradedWer, cases: input.scans.fixtures.length },
    tables: { clean_f1: cleanF1, degraded_f1: degradedF1, cases: input.tables.fixtures.length },
    receipts: {
      exact_critical_rate: exactRate,
      uncertain_recall: uncertainRecall,
      invented_fields: invented,
      guessed_currency: guessedCurrency,
      cases: input.receipts.fixtures.length,
    },
    inline: { acceptability, unsafe_executions: unsafe, cases: input.inline.cases.length },
    thresholds_passed: thresholdsPassed,
    quality_tier: thresholdsPassed ? "verified" : "Experimental",
    enabled: thresholdsPassed && unsafe === 0,
    unsafe_action_blocked: unsafe === 0,
  };
}

/** Each locale is judged on its own; one failed locale never hides the other. */
export function localeVerdict(
  reports: readonly ExtractionEvaluationReport[],
): Record<EvalLocale, "verified" | "Experimental"> {
  const verdict: Record<EvalLocale, "verified" | "Experimental"> = { en: "Experimental", es: "Experimental" };
  for (const report of reports) verdict[report.locale] = report.quality_tier;
  return verdict;
}
