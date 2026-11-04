import type { TFunction } from "i18next";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import { errorCode } from "../services/errors";
import {
  correctExtraction,
  extractionPage,
  releaseExtraction,
} from "../services/aiExtraction";
import type {
  ExtractionCorrection,
  ExtractionOutputFormat,
  ExtractionReview,
  ExtractionTable,
  ExtractionValue,
} from "../services/aiExtractionTypes";
import type { ConversionWarningCode } from "../convert/types";
import {
  exportBlockers,
  focusAnchor,
  isRectangular,
  mergeReviewPages,
} from "./extractionCorrections";
import ExtractionExportBar from "./ExtractionExportBar";
import ExtractionField, { RECEIPT_FIELD_KEYS } from "./ExtractionFields";
import ExtractionGrid from "./ExtractionGrid";
import ExtractionSourcePane from "./ExtractionSourcePane";

/** Side-by-side correction review (Step 17d T4).
 *
 * A FileTab child, never a second editor controller. The source on the left
 * and the editable extracted model on the right share the selected anchor;
 * corrections are typed, revision-checked and never touch the source. Export
 * is available only after every uncertain, inconsistent or missing field has
 * been reviewed.
 */

export const FIRST_REVIEW_CURSOR = "";

/** Translate every native extraction code; `unavailable` has no dedicated
 * locale key, so it falls back to the ordinary "pack missing" sentence. */
function reviewErrorText(t: TFunction, reason: unknown): string {
  const code = errorCode(reason);
  if (code === "ai_extract.unavailable") return t("errors.ai.pack_missing");
  if (code.startsWith("ai_extract.")) {
    const suffix = code.slice("ai_extract.".length);
    const translated = t(`errors.ai_extract.${suffix}`, { defaultValue: "" });
    if (translated) return translated;
  }
  return t("errors.ai_extract.failed");
}

/** Fetch every bounded page of one review (at most 40) and merge them. */
async function loadAllPages(reviewId: string): Promise<ExtractionReview> {
  const first = await extractionPage(reviewId, FIRST_REVIEW_CURSOR);
  const pages = [first];
  let cursor = first.next_cursor;
  while (cursor) {
    if (pages.length >= 40) throw new Error("ai_extract.too_large");
    const next = await extractionPage(reviewId, cursor);
    pages.push(next);
    cursor = next.next_cursor;
  }
  return mergeReviewPages(pages);
}

export interface ExtractionReviewPaneProps {
  reviewId: string;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
  /** The tab host wires this to the 08a-backed publication service. */
  onExport?: (
    review: ExtractionReview,
    format: ExtractionOutputFormat,
    tableId: string | null,
    acceptedWarnings: ConversionWarningCode[],
    includeSourceLabels: boolean,
  ) => void;
}

export default function ExtractionReviewPane({
  reviewId,
  onClose,
  onOpenHelp,
  onExport,
}: ExtractionReviewPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [review, setReview] = useState<ExtractionReview | null>(null);
  const [initialRevision, setInitialRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [tableId, setTableId] = useState<string | null>(null);
  const [pane, setPane] = useState<"source" | "result">("result");
  const [discardOpen, setDiscardOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await loadAllPages(reviewId);
      setReview(next);
      setInitialRevision(next.revision);
      setTableId(next.tables[0]?.id ?? next.receipts[0]?.line_items.id ?? null);
      setError(null);
      setLoading(false);
    } catch (reason) {
      setError(reviewErrorText(t, reason));
      setLoading(false);
    }
  }, [reviewId, t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAllPages(reviewId)
      .then((next) => {
        if (cancelled) return;
        setReview(next);
        setInitialRevision(next.revision);
        setTableId(next.tables[0]?.id ?? next.receipts[0]?.line_items.id ?? null);
        setError(null);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reviewErrorText(t, reason));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, t]);

  useEffect(() => {
    return () => {
      void releaseExtraction(reviewId);
    };
  }, [reviewId]);

  const focus = useMemo(() => {
    if (!review || !selectedId) return null;
    return focusAnchor(review, selectedId);
  }, [review, selectedId]);

  const focusValue = (value: ExtractionValue) => {
    setSelectedId(value.id);
    if (review && value.id === selectedId) return;
    const found = review ? focusAnchor(review, value.id) : null;
    if (found) setPage(found.page);
  };

  const apply = useCallback(
    async (corrections: ExtractionCorrection[]) => {
      if (!review || busy) return;
      setBusy(true);
      setError(null);
      try {
        const next = await correctExtraction(review.id, review.revision, corrections);
        setReview(next);
      } catch (reason) {
        if (errorCode(reason) === "ai_extract.changed") {
          setError(t("errors.ai_extract.changed"));
          // Reload the immutable current revision; never keep a stale edit.
          try {
            const fresh = await extractionPage(reviewId, FIRST_REVIEW_CURSOR);
            setReview(fresh);
            setInitialRevision(fresh.revision);
          } catch {
            setReview(null);
          }
        } else {
          setError(reviewErrorText(t, reason));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, review, reviewId, t],
  );

  const commitField = (value: ExtractionValue, expected: string, next: string) => {
    if (value.value !== expected) {
      setError(t("errors.ai_extract.changed"));
      return;
    }
    void apply([{ kind: "field", id: value.id, expected, value: next }]);
  };

  const commitCell = (table: ExtractionTable) => (rowId: string, columnId: string, expected: string, next: string) => {
    void apply([
      { kind: "table_cell", table_id: table.id, row_id: rowId, column_id: columnId, expected, value: next },
    ]);
  };

  const dirty = review !== null && review.revision > initialRevision;
  const blockers = review ? exportBlockers(review) : { uncertain: 0, inconsistent: 0, missing: 0, corrected: 0 };

  const requestClose = () => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const fieldRow = (labelKey: string, value: ExtractionValue) => (
    <ExtractionField
      key={value.id}
      labelKey={labelKey}
      value={value}
      selected={selectedId === value.id}
      onFocusValue={focusValue}
      onCommit={(expected, next) => commitField(value, expected, next)}
    />
  );

  return (
    <section
      className="adp-extraction-review"
      aria-labelledby={headingId}
      data-pane={pane}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !discardOpen) requestClose();
      }}
    >
      <h1 id={headingId} className="adp-visually-hidden">
        {t("aiExtract.review")}
      </h1>
      <div className="adp-extraction-tabs" role="tablist" aria-label={t("aiExtract.review")}>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "source"}
          className={pane === "source" ? "adp-btn" : "adp-btn adp-btn--subtle"}
          onClick={() => setPane("source")}
        >
          {t("aiExtract.source")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "result"}
          className={pane === "result" ? "adp-btn" : "adp-btn adp-btn--subtle"}
          onClick={() => setPane("result")}
        >
          {t("aiExtract.result")}
        </button>
      </div>

      {loading ? (
        <div className="adp-extraction-status" role="status">
          {t("aiExtract.progress", { page: 1, total: 1 })}
        </div>
      ) : null}
      {error ? (
        <div className="adp-extraction-status adp-extraction-status--error" role="alert">
          <span>{error}</span>
          <Button variant="primary" onClick={() => void reload()} disabled={busy}>
            {t("aiExtract.retry")}
          </Button>
        </div>
      ) : null}

      <div className="adp-extraction-columns">
        <ExtractionSourcePane
          source={review?.sources[0] ?? null}
          page={focus?.page ?? page}
          pageCount={review?.sources[0]?.page_count ?? 1}
          anchor={focus?.anchor ?? null}
          onPageChange={setPage}
        />

        <section className="adp-extraction-result" aria-label={t("aiExtract.result")}>
          <header className="adp-extraction-result-head">
            <h2>{t("aiExtract.result")}</h2>
            <Button variant="subtle" onClick={() => onOpenHelp("turning-scans-into-documents")}>
              ?
            </Button>
          </header>

          {review ? (
            <div className="adp-extraction-result-scroll">
              {review.receipts.map((receipt) => (
                <article key={receipt.id} className="adp-extraction-receipt">
                  <h3>{t("aiExtract.lineItems")}</h3>
                  <div className="adp-extraction-fields">
                    {RECEIPT_FIELD_KEYS.map(([key, labelKey]) => fieldRow(labelKey, receipt[key]))}
                  </div>
                  <ExtractionGrid
                    table={receipt.line_items}
                    selectedValueId={selectedId}
                    onFocusValue={focusValue}
                    onCommitCell={commitCell(receipt.line_items)}
                    onSplitColumn={(columnId, separator) =>
                      void apply([{ kind: "split_column", table_id: receipt.line_items.id, column_id: columnId, separator }])
                    }
                    onMergeColumns={(columnIds, separator) =>
                      void apply([
                        { kind: "merge_columns", table_id: receipt.line_items.id, column_ids: columnIds, separator },
                      ])
                    }
                  />
                </article>
              ))}

              {review.blocks.map((block) => (
                <div key={block.id} className={`adp-extraction-block adp-extraction-block--${block.kind}`}>
                  {block.text ? fieldRow("aiExtract.result", block.text) : null}
                  {block.list_items.map((item) => fieldRow("aiExtract.lineItems", item))}
                </div>
              ))}

              {review.tables.map((table) => (
                <article key={table.id} className="adp-extraction-table">
                  <label className="adp-extraction-table-choice">
                    <input
                      type="radio"
                      name="extraction-table"
                      checked={tableId === table.id}
                      onChange={() => setTableId(table.id)}
                    />
                    {t("aiExtract.review")}
                  </label>
                  {!isRectangular(table) ? (
                    <p className="adp-extraction-warning" role="status">
                      {t("errors.ai_extract.invalid")}
                    </p>
                  ) : null}
                  <ExtractionGrid
                    table={table}
                    selectedValueId={selectedId}
                    onFocusValue={focusValue}
                    onCommitCell={commitCell(table)}
                    onSplitColumn={(columnId, separator) =>
                      void apply([{ kind: "split_column", table_id: table.id, column_id: columnId, separator }])
                    }
                    onMergeColumns={(columnIds, separator) =>
                      void apply([{ kind: "merge_columns", table_id: table.id, column_ids: columnIds, separator }])
                    }
                  />
                </article>
              ))}

              {review.warnings.length > 0 ? (
                <p className="adp-extraction-warning" role="status">
                  {t("aiExtract.partial", {
                    done: review.sources.length,
                    failed: review.warnings.length,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {review ? (
            <ExtractionExportBar
              review={review}
              tableId={tableId}
              blockers={blockers}
              busy={busy}
              onClose={onClose}
              onExport={(format, chosenTable, warnings, includeSourceLabels) =>
                onExport?.(review, format, chosenTable, warnings, includeSourceLabels)
              }
            />
          ) : null}
        </section>
      </div>

      {discardOpen ? (
        <div className="adp-extraction-confirm" role="alertdialog" aria-modal="true" aria-label={t("aiExtract.discard")}>
          <p>{t("aiExtract.discard")}</p>
          <Button variant="primary" onClick={onClose}>
            {t("aiExtract.discard")}
          </Button>
          <Button onClick={() => setDiscardOpen(false)}>{t("aiExtract.cancel")}</Button>
        </div>
      ) : null}
    </section>
  );
}
