import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { ImageRect } from "../services/localAiTypes";
import { comparisonKeyboard, PREVIEW_SOURCE_EDGE, validateCrop } from "./upscale";

export interface UpscaleComparisonProps {
  beforeUrl: string | null;
  afterUrl: string | null;
  region: ImageRect | null;
  sourceSize: { width: number; height: number } | null;
  compare: number;
  busy: boolean;
  onRegionChange: (region: ImageRect) => void;
  onCompareChange: (value: number) => void;
}

export default function UpscaleComparison(props: UpscaleComparisonProps) {
  const { t } = useTranslation();
  const { region, sourceSize } = props;
  const cropValid =
    region !== null && sourceSize !== null && validateCrop(region, sourceSize.width, sourceSize.height);

  const patch = (patch: Partial<ImageRect>) => {
    if (!region) return;
    const next = { ...region, ...patch };
    if (sourceSize && validateCrop(next, sourceSize.width, sourceSize.height)) {
      props.onRegionChange(next);
    }
  };

  return (
    <div className="adp-ai-comparison">
      <div
        className="adp-ai-panes"
        style={{ "--adp-ai-compare": `${props.compare}%` } as CSSProperties}
      >
        <figure className="adp-ai-pane" aria-label={t("ai.before")}>
          {props.beforeUrl ? (
            <img src={props.beforeUrl} alt="" draggable={false} />
          ) : (
            <span className="adp-ai-placeholder">{t("ai.before")}</span>
          )}
          <figcaption>{t("ai.before")}</figcaption>
        </figure>
        <figure className="adp-ai-pane" aria-label={t("ai.after")}>
          {props.afterUrl ? (
            <img src={props.afterUrl} alt="" draggable={false} />
          ) : (
            <span className="adp-ai-placeholder">
              {props.busy ? t("ai.processing") : t("ai.after")}
            </span>
          )}
          <figcaption>{t("ai.after")}</figcaption>
        </figure>
      </div>
      <div className="adp-ai-compare-row">
        <label className="adp-ai-compare-label" htmlFor="adp-ai-compare">
          {t("ai.compare")}
        </label>
        <input
          id="adp-ai-compare"
          className="adp-ai-compare"
          type="range"
          min={0}
          max={100}
          step={1}
          value={props.compare}
          aria-valuetext={`${props.compare}%`}
          onKeyDown={(event) => {
            const next = comparisonKeyboard(props.compare, event.key, event.shiftKey);
            if (next !== props.compare) {
              event.preventDefault();
              props.onCompareChange(next);
            }
          }}
          onChange={(event) => props.onCompareChange(Number(event.target.value))}
        />
        <button type="button" className="adp-ai-static" onClick={() => props.onCompareChange(100)}>
          {t("ai.before")}
        </button>
        <button type="button" className="adp-ai-static" onClick={() => props.onCompareChange(0)}>
          {t("ai.after")}
        </button>
      </div>
      <fieldset className="adp-ai-crop" disabled={props.busy || !sourceSize}>
        <legend>{t("ai.preview")}</legend>
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label key={field} className="adp-ai-crop-field">
            <span>{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</span>
            <input
              type="number"
              min={field === "width" || field === "height" ? 1 : 0}
              max={sourceSize ? (field === "width" ? Math.min(sourceSize.width, PREVIEW_SOURCE_EDGE) : field === "height" ? Math.min(sourceSize.height, PREVIEW_SOURCE_EDGE) : undefined) : undefined}
              value={region ? region[field] : 0}
              onChange={(event) => patch({ [field]: Number(event.target.value) })}
            />
          </label>
        ))}
        {!cropValid && sourceSize ? (
          <p className="adp-ai-error" role="alert">
            {t("errors.ai.bad_request")}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
