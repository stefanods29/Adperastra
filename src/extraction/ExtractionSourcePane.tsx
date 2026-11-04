import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ExtractionAnchor, ExtractionSource } from "../services/aiExtractionTypes";

/** The source side of the review (Step 17d T4).
 *
 * The existing PDF or image presenter is rendered as `children`; this pane
 * only adds the selected field's highlight. Selecting a field scrolls to its
 * anchor and never changes or re-renders the source bytes.
 */

export interface ExtractionSourcePaneProps {
  source: ExtractionSource | null;
  page: number;
  pageCount: number;
  anchor: ExtractionAnchor | null;
  onPageChange?: (page: number) => void;
  children?: ReactNode;
}

export default function ExtractionSourcePane({
  source,
  page,
  pageCount,
  anchor,
  onPageChange,
  children,
}: ExtractionSourcePaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const safePage = Math.min(Math.max(1, page), Math.max(1, pageCount));

  return (
    <section className="adp-extraction-source" aria-labelledby={headingId} data-page={safePage}>
      <header className="adp-extraction-source-head">
        <h2 id={headingId}>{t("aiExtract.source")}</h2>
        {source ? <span className="adp-extraction-source-name">{source.display_name}</span> : null}
        {pageCount > 1 ? (
          <label className="adp-extraction-source-page">
            {t("aiExtract.progress", { page: safePage, total: pageCount })}
            <input
              className="adp-input"
              type="number"
              min={1}
              max={pageCount}
              value={safePage}
              aria-label={t("aiExtract.source")}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= 1 && next <= pageCount) {
                  onPageChange?.(next);
                }
              }}
            />
          </label>
        ) : null}
      </header>
      <div className="adp-extraction-source-stage">
        {children ?? (
          <div className="adp-extraction-source-placeholder" role="img" aria-label={source?.display_name ?? t("aiExtract.source")} />
        )}
        {anchor ? (
          <div
            className="adp-extraction-source-anchor"
            data-testid="extraction-anchor"
            data-page={anchor.page}
            aria-hidden="true"
            style={{
              left: `${anchor.rect.x * 100}%`,
              top: `${anchor.rect.y * 100}%`,
              width: `${anchor.rect.width * 100}%`,
              height: `${anchor.rect.height * 100}%`,
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
