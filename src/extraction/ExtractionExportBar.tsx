import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import type { ConversionWarningCode } from "../convert/types";
import {
  buildOutputModel,
  requiredExtractionWarnings,
} from "../convert/extractionConverters";
import type {
  ExtractionOutputFormat,
  ExtractionPublish,
  ExtractionReview,
} from "../services/aiExtractionTypes";
import { canExportReview, type ExportBlockers } from "./extractionCorrections";

/** Export controls and required acknowledgements (Step 17d T5).
 *
 * The parent owns naming and publication; this bar only collects the format,
 * the selected table and the exact warning acknowledgements. It stays
 * disabled until every uncertain, inconsistent or missing field was reviewed.
 */

export const EXPORT_FORMATS: readonly ExtractionOutputFormat[] = ["docx", "md", "txt", "xlsx", "csv"];

export interface ExtractionExportBarProps {
  review: ExtractionReview;
  tableId: string | null;
  blockers: ExportBlockers;
  busy?: boolean;
  onExport?: (
    format: ExtractionOutputFormat,
    tableId: string | null,
    acceptedWarnings: ConversionWarningCode[],
    includeSourceLabels: boolean,
  ) => void;
  onClose: () => void;
}

export default function ExtractionExportBar({
  review,
  tableId,
  blockers,
  busy = false,
  onExport,
  onClose,
}: ExtractionExportBarProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExtractionOutputFormat>("docx");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [includeSourceLabels, setIncludeSourceLabels] = useState(true);
  const needsTable = format === "xlsx" || format === "csv";

  const requiredWarnings: ConversionWarningCode[] = useMemo(() => {
    const candidate: ExtractionPublish = {
      review_id: review.id,
      expected_revision: review.revision,
      expected_content_id: review.content_id,
      format,
      table_id: needsTable ? tableId : null,
      dest_dir: "",
      name: "review",
      accepted_warning_codes: [],
      include_source_labels: false,
    };
    return requiredExtractionWarnings(buildOutputModel(review, candidate));
  }, [review, format, tableId, needsTable]);

  const accepted = requiredWarnings.filter((code) => acknowledged.includes(code));
  const exportable =
    canExportReview(review) &&
    !busy &&
    onExport !== undefined &&
    accepted.length === requiredWarnings.length &&
    (!needsTable || tableId !== null);
  const blocked = blockers.uncertain + blockers.inconsistent + blockers.missing > 0;

  return (
    <>
      <div className="adp-extraction-acknowledge">
        <label className="adp-extraction-acknowledge-item">
          <input
            type="checkbox"
            checked={includeSourceLabels}
            onChange={(event) => setIncludeSourceLabels(event.target.checked)}
          />
          <span>{t("aiExtract.sourceLabels")}</span>
        </label>
        {requiredWarnings.map((code) => (
          <label key={code} className="adp-extraction-acknowledge-item">
            <input
              type="checkbox"
              checked={acknowledged.includes(code)}
              onChange={(event) =>
                setAcknowledged((current) =>
                  event.target.checked
                    ? [...current.filter((entry) => entry !== code), code]
                    : current.filter((entry) => entry !== code),
                )
              }
            />
            <span>
              {code === "layout_loss"
                ? t("convert.layoutLoss")
                : code === "formula_safety_prefix"
                  ? `${t("convert.formulaSafetyPrefix")} ${t("aiExtract.formulaSafety")}`
                  : t("aiExtract.review")}
            </span>
          </label>
        ))}
      </div>
      <footer className="adp-extraction-result-footer">
        <span className="adp-extraction-blockers" role="status" aria-live="polite">
          {blocked ? t("aiExtract.uncertain") : t("aiExtract.corrected")}
        </span>
        <label className="adp-extraction-format">
          {t("aiExtract.export")}
          <select
            className="adp-input"
            value={format}
            aria-label={t("aiExtract.export")}
            onChange={(event) => setFormat(event.target.value as ExtractionOutputFormat)}
          >
            {EXPORT_FORMATS.map((option) => (
              <option key={option} value={option}>
                {option.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <Button variant="subtle" onClick={onClose}>
          {t("aiExtract.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!exportable}
          title={canExportReview(review) ? undefined : t("errors.ai_extract.uncertain")}
          onClick={() => {
            if (!exportable || !onExport) return;
            onExport(format, needsTable ? tableId : null, accepted, includeSourceLabels);
          }}
        >
          {t("aiExtract.export")}
        </Button>
      </footer>
    </>
  );
}
