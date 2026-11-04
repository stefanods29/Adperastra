import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../components/Skeleton";
import { fileUrl } from "../services/files";
import { formatSize } from "../services/format";
import type { ConversionWarningCode } from "./types";
import type { PreviewState } from "./useConversionPreview";

/** The dialog's two panes: the original on the left, the exact preview on
 * the right (Step 08a D7). A failed preview never blocks the source facts. */

export const WARNING_KEYS: Record<ConversionWarningCode, string> = {
  transparency_loss: "convert.transparencyLoss",
  animation_first_frame: "convert.firstFrame",
  palette_reduction: "convert.paletteReduction",
  layout_loss: "convert.layoutLoss",
  formula_cached_value: "convert.formulaCachedValue",
  formula_safety_prefix: "convert.formulaSafetyPrefix",
  sheet_selection: "convert.sheetSelection",
  audio_loss: "convert.audioLoss",
  frame_rate_change: "convert.frameRateChange",
};

export interface ConversionPreviewProps {
  originalUrl: string | null;
  originalName: string;
  preview: PreviewState;
  onRetry: () => void;
}

export default function ConversionPreview({
  originalUrl,
  originalName,
  preview,
  onRetry,
}: ConversionPreviewProps) {
  const { t, i18n } = useTranslation();
  const [showWords, setShowWords] = useState(false);

  useEffect(() => {
    if (preview.status !== "loading") {
      setShowWords(false);
      return;
    }
    const timer = window.setTimeout(() => setShowWords(true), 1000);
    return () => window.clearTimeout(timer);
  }, [preview.status, preview.revision]);

  const image = preview.preview;
  return (
    <div className="adp-convert-preview">
      <div className="adp-convert-pane">
        <span className="adp-convert-pane-title">{t("convert.original")}</span>
        <div className="adp-convert-pane-frame">
          {originalUrl ? (
            <img src={originalUrl} alt={originalName} className="adp-convert-image" />
          ) : (
            <span className="adp-convert-pane-name">{originalName}</span>
          )}
        </div>
      </div>
      <div className="adp-convert-pane">
        <span className="adp-convert-pane-title">{t("convert.preview")}</span>
        <div className="adp-convert-pane-frame" aria-live="polite">
          {preview.status === "ready" && image ? (
            <img
              src={fileUrl(image.image.token, image.image.name)}
              alt={t("convert.preview")}
              className="adp-convert-image"
            />
          ) : null}
          {preview.status === "loading" ? (
            <>
              <Skeleton variant="tiles" count={1} />
              {showWords ? (
                <span className="adp-convert-pane-note">{t("convert.preparing")}</span>
              ) : null}
            </>
          ) : null}
          {preview.status === "unsupported" ? (
            <span className="adp-convert-pane-note">{t("preview.unavailable")}</span>
          ) : null}
          {preview.status === "failed" ? (
            <div className="adp-convert-pane-note">
              <span>{t(`errors.convert.${errorReason(preview.error)}`, {
                defaultValue: t("errors.convert.other"),
              })}</span>
              <button type="button" className="adp-btn adp-btn--subtle" onClick={onRetry}>
                {t("convert.preview")}
              </button>
            </div>
          ) : null}
        </div>
        {image?.estimated_bytes !== undefined ? (
          <span className="adp-convert-estimate">
            {t("convert.estimate", {
              size: formatSize(image.estimated_bytes, i18n.language),
            })}
          </span>
        ) : null}
        {image && image.warnings.length > 0 ? (
          <ul className="adp-convert-warnings">
            {image.warnings.map((code) => (
              <li key={code}>{t(WARNING_KEYS[code])}</li>
            ))}
          </ul>
        ) : null}
        {image && image.metadata_lost.length > 0 ? (
          <p className="adp-convert-warnings">{t("convert.metadataLoss")}</p>
        ) : null}
      </div>
    </div>
  );
}

function errorReason(code: string): string {
  return code.startsWith("convert.") ? code.slice("convert.".length) : "other";
}
