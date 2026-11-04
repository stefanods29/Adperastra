import { describe, expect, it } from "vitest";
import scansEn from "../../tests/fixtures/ai/extraction/scans.en.json";
import scansEs from "../../tests/fixtures/ai/extraction/scans.es.json";
import tablesEn from "../../tests/fixtures/ai/extraction/tables.en.json";
import tablesEs from "../../tests/fixtures/ai/extraction/tables.es.json";
import receiptsEn from "../../tests/fixtures/ai/extraction/receipts.en.json";
import receiptsEs from "../../tests/fixtures/ai/extraction/receipts.es.json";
import inlineEn from "../../tests/fixtures/ai/extraction/inline.en.json";
import inlineEs from "../../tests/fixtures/ai/extraction/inline.es.json";
import manifest from "../../tests/fixtures/ai/extraction/manifest.json";
import {
  evaluateExtractionSuite,
  localeVerdict,
  pendingEvaluationReport,
  type InlineCase,
  type ReceiptFixture,
  type ReceiptPrediction,
  type ScanFixture,
  type TableFixture,
} from "../../tests/ai/suites/extractionEvaluation";
import {
  receiptOracle,
  tableCellF1,
} from "../../tests/ai/suites/extractionScoring";

const SCANS_EN = scansEn as ScanFixture[];
const SCANS_ES = scansEs as ScanFixture[];
const TABLES_EN = tablesEn as TableFixture[];
const TABLES_ES = tablesEs as TableFixture[];
const RECEIPTS_EN = receiptsEn as ReceiptFixture[];
const RECEIPTS_ES = receiptsEs as ReceiptFixture[];
const INLINE_EN = inlineEn as InlineCase[];
const INLINE_ES = inlineEs as InlineCase[];

function perfectReceipts(fixtures: ReceiptFixture[]): ReceiptPrediction[] {
  return fixtures.map((fixture) => {
    const oracle = receiptOracle(fixture);
    return {
      id: fixture.id,
      vendor: fixture.fields.vendor,
      tax_id: fixture.fields.tax_id,
      currency_code: oracle.currency_code,
      date_iso: oracle.date_iso,
      subtotal_minor: oracle.subtotal_minor,
      tax_minor: oracle.tax_minor,
      total_minor: oracle.total_minor,
      arithmetic_ok: oracle.arithmetic_ok,
    };
  });
}

function suite(locale: "en" | "es", scans: ScanFixture[]) {
  const tables = locale === "en" ? TABLES_EN : TABLES_ES;
  const receipts = locale === "en" ? RECEIPTS_EN : RECEIPTS_ES;
  const inline = locale === "en" ? INLINE_EN : INLINE_ES;
  return {
    suite_id: `extraction-${locale}`,
    locale,
    scans: {
      fixtures: scans,
      predictions: scans.map((fixture) => ({ id: fixture.id, text: fixture.text })),
    },
    tables: {
      fixtures: tables,
      predictions: tables.map((fixture) => ({ id: fixture.id, rows: fixture.rows })),
    },
    receipts: { fixtures: receipts, predictions: perfectReceipts(receipts) },
    inline: {
      cases: inline,
      reviews: inline.map((testCase) => ({
        id: testCase.id,
        text: testCase.acceptable[0],
        accepted: true,
      })),
    },
  };
}

describe("extraction evaluation", () => {
  it("extraction_f1_oracle", () => {
    const expected = [
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ];
    const predicted = [
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "z"],
    ];
    const score = tableCellF1(expected, predicted);
    expect(score.tp).toBe(8);
    expect(score.fp).toBe(1);
    expect(score.fn).toBe(1);
    expect(score.f1).toBeCloseTo(0.8888889, 6);
    expect(score.precision).toBeCloseTo(8 / 9, 9);
    expect(score.recall).toBeCloseTo(8 / 9, 9);
  });

  it("receipt_currency_not_guessed", () => {
    const input = suite("en", SCANS_EN);
    const prediction = input.receipts.predictions.find((entry) => entry.id === "rec-en-19")!;
    prediction.currency_code = "USD";
    const report = evaluateExtractionSuite(input);
    expect(report.receipts.guessed_currency).toBe(1);
    expect(report.thresholds_passed).toBe(false);
    expect(report.quality_tier).toBe("Experimental");
    expect(report.enabled).toBe(false);
    // The oracle itself never guesses.
    const fixture = RECEIPTS_EN.find((entry) => entry.id === "rec-en-19")!;
    expect(receiptOracle(fixture).currency_code).toBeNull();
  });

  it("inline_safety_oracle", () => {
    const input = suite("en", SCANS_EN);
    const review = input.inline.reviews[0];
    review.text = "powershell -Command Remove-Item -Recurse C:\\Data";
    const report = evaluateExtractionSuite(input);
    expect(report.inline.unsafe_executions).toBe(1);
    expect(report.unsafe_action_blocked).toBe(false);
    expect(report.enabled).toBe(false);
    expect(report.thresholds_passed).toBe(false);
  });

  it("extraction_no_scores_before_run", () => {
    const pending = pendingEvaluationReport("extraction");
    expect(pending.state).toBe("pending");
    expect(pending.scores).toBeNull();
    expect(pending.percent).toBeNull();
    expect(JSON.stringify(pending)).not.toContain("%");
    expect(JSON.stringify(pending)).not.toContain("passed");
  });

  it("extraction_fixture_counts_and_locales", () => {
    expect(SCANS_EN).toHaveLength(30);
    expect(SCANS_ES).toHaveLength(30);
    expect(TABLES_EN).toHaveLength(20);
    expect(TABLES_ES).toHaveLength(20);
    expect(RECEIPTS_EN).toHaveLength(20);
    expect(RECEIPTS_ES).toHaveLength(20);
    expect(INLINE_EN).toHaveLength(50);
    expect(INLINE_ES).toHaveLength(50);
    expect(manifest.counts.scans_en).toBe(30);
    expect(manifest.counts.inline_es).toBe(50);
    const ids = new Set([...SCANS_EN, ...SCANS_ES].map((fixture) => fixture.id));
    for (const id of manifest.injection_cases) expect(ids.has(id), id).toBe(true);
    expect(SCANS_EN.every((fixture) => fixture.locale === "en")).toBe(true);
    expect(SCANS_ES.every((fixture) => fixture.locale === "es")).toBe(true);
  });

  it("extraction_each_locale_independent", () => {
    const english = evaluateExtractionSuite(suite("en", SCANS_EN));
    expect(english.thresholds_passed).toBe(true);
    expect(english.quality_tier).toBe("verified");

    const degraded = suite("es", SCANS_ES);
    degraded.scans.predictions = degraded.scans.predictions.map((entry) => ({ ...entry, text: "" }));
    const spanish = evaluateExtractionSuite(degraded);
    expect(spanish.thresholds_passed).toBe(false);
    expect(spanish.quality_tier).toBe("Experimental");
    expect(localeVerdict([english, spanish])).toEqual({
      en: "verified",
      es: "Experimental",
    });
  });
});
