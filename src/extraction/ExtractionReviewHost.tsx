import type { TFunction } from "i18next";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConversionWarningCode } from "../convert/types";
import { errorCode } from "../services/errors";
import { publishExtraction } from "./extractionPublication";
import ExtractionReviewPane from "./ExtractionReviewPane";
import type {
  ExtractionOutputFormat,
  ExtractionReview,
} from "../services/aiExtractionTypes";
import { pickSavePath } from "../services/textFiles";

/** Publication host for one reviewed extraction (Step 17d T5/T8).
 *
 * The review pane owns review/correction state; this host only asks for a
 * real destination and calls `publishExtraction`. It reports the actual
 * ConversionReport outputs and never invents a file path. The original file
 * is never touched: 08a owns staging, collision handling and history.
 */

export interface ExtractionReviewHostProps {
  reviewId: string;
  /** Default stem for the save dialog, without extension. */
  defaultName: string;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
  onOpenFile?: (path: string) => Promise<void>;
  onNotify?: (message: string) => void;
}

function extractionErrorText(t: TFunction, reason: unknown): string {
  const suffix = errorCode(reason).startsWith("ai_extract.")
    ? errorCode(reason).slice("ai_extract.".length)
    : "";
  if (suffix === "unavailable") return t("errors.ai.pack_missing");
  if (["invalid", "changed", "too_large", "unsupported", "uncertain", "failed"].includes(suffix)) {
    return t(`errors.ai_extract.${suffix}`);
  }
  return t("errors.ai_extract.failed");
}

export default function ExtractionReviewHost({
  reviewId,
  defaultName,
  onClose,
  onOpenHelp,
  onOpenFile,
  onNotify,
}: ExtractionReviewHostProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const exporting = useRef(false);

  const exportReview = async (
    review: ExtractionReview,
    format: ExtractionOutputFormat,
    tableId: string | null,
    acceptedWarnings: ConversionWarningCode[],
    includeSourceLabels: boolean,
  ): Promise<void> => {
    if (exporting.current) return;
    exporting.current = true;
    setError(null);
    try {
      const chosen = await pickSavePath(
        t("aiExtract.export"),
        `${defaultName.replace(/[\\/:*?"<>|]/g, "_").replace(/[. ]+$/, "").slice(0, 180) || "review"}.${format}`,
        t("common.export"),
      );
      if (!chosen) return;
      const separator = Math.max(chosen.lastIndexOf("\\"), chosen.lastIndexOf("/"));
      if (separator <= 0) throw new Error("ai_extract.invalid");
      const destDir = chosen.slice(0, separator);
      const name = chosen.slice(separator + 1).replace(/\.[^.]+$/, "");
      const job = await publishExtraction({
        review_id: review.id,
        expected_revision: review.revision,
        expected_content_id: review.content_id,
        format,
        table_id: tableId,
        dest_dir: destDir,
        name,
        accepted_warning_codes: acceptedWarnings,
        include_source_labels: includeSourceLabels,
      });
      const report = await job.completion;
      const outputs = report.outputs.map((output) => output.path);
      onNotify?.(t("aiExtract.partial", { done: outputs.length, failed: 0 }));
      const first = outputs[0];
      if (first && onOpenFile) await onOpenFile(first);
      onClose();
    } catch (reason) {
      setError(extractionErrorText(t, reason));
    } finally {
      exporting.current = false;
    }
  };

  return (
    <>
      {error ? (
        <div className="adp-extraction-status adp-extraction-status--error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}
      <ExtractionReviewPane
        reviewId={reviewId}
        onClose={onClose}
        onOpenHelp={onOpenHelp}
        onExport={(review, format, tableId, warnings, includeSourceLabels) =>
          void exportReview(review, format, tableId, warnings, includeSourceLabels)
        }
      />
    </>
  );
}
