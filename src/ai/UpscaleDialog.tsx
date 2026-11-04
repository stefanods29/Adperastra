import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import ProgressBar from "../components/ProgressBar";
import Skeleton from "../components/Skeleton";
import type { ConversionInput } from "../convert/types";
import { errorText } from "../services/errors";
import type { ImageRect, UpscaleOptions } from "../services/localAiTypes";
import UpscaleComparison from "./UpscaleComparison";
import UpscaleControls from "./UpscaleControls";
import { applyUpscale, defaultCrop, initialUpscaleState, outputDimensions, updateUpscaleOptions } from "./upscale";
import { useUpscalePreview } from "./useUpscalePreview";

export interface UpscaleDialogProps {
  input: ConversionInput;
  documentId: string | null;
  expectedContentId: string | null;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
  /** Additive optional values; existing callers keep working. */
  beforeUrl?: string | null;
  sourceSize?: { width: number; height: number } | null;
  onOpenStorage?: () => void;
  onSaveCopy?: () => void;
  onApplied?: () => void;
}

export default function UpscaleDialog(props: UpscaleDialogProps) {
  const { t } = useTranslation();
  const initialRegion: ImageRect | null =
    props.sourceSize && props.sourceSize.width > 0 && props.sourceSize.height > 0
      ? defaultCrop(props.sourceSize.width, props.sourceSize.height)
      : null;
  const [optionState, setOptionState] = useState(() => initialUpscaleState(initialRegion));
  const [compare, setCompare] = useState(50);
  const [showWords, setShowWords] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const options: UpscaleOptions = {
    kind: "upscale",
    scale: optionState.options.scale,
    model: optionState.options.model,
    device: optionState.options.device,
    preview_region: optionState.options.region,
  };
  const output = optionState.options.region
    ? outputDimensions(optionState.options.region, optionState.options.scale)
    : null;
  const preview = useUpscalePreview(
    props.input,
    options,
    optionState.revision,
    props.expectedContentId,
  );
  const startRef = useRef(preview.start);
  startRef.current = preview.start;

  useEffect(() => {
    const timer = window.setTimeout(() => void startRef.current(), 150);
    return () => window.clearTimeout(timer);
  }, [props.input, optionState.revision]);

  useEffect(() => {
    setShowWords(false);
    if (!preview.state.loading) return;
    const timer = window.setTimeout(() => setShowWords(true), 1000);
    return () => window.clearTimeout(timer);
  }, [preview.state.loading]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, []);

  const changeOptions = (patch: Partial<typeof optionState.options>) => {
    setOptionState((current) => updateUpscaleOptions(current, patch));
  };

  const close = async () => {
    await preview.cancel();
    props.onClose();
  };

  const apply = async () => {
    if (!props.documentId || !props.expectedContentId) return;
    setApplying(true);
    setApplyError("");
    try {
      // Apply runs the whole image with the previewed options; applying the
      // 256 px preview itself would discard the rest of the picture.
      const result = await preview.runFull();
      await applyUpscale(props.documentId, props.expectedContentId, result);
      props.onApplied?.();
      props.onClose();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "ai.failed");
    } finally {
      setApplying(false);
    }
  };

  const missingPack =
    preview.state.errorCode === "ai.pack_missing" || preview.state.errorCode === "ai.unverified";
  const shownError = applyError || preview.state.errorCode;
  const cpuFallback =
    preview.state.preview?.result.warnings.includes("cpu_fallback") ?? false;

  return (
    <Dialog title={t("ai.upscale")} onClose={() => void close()} className="adp-ai-upscale">
      <div className="adp-ai-upscale-head">
        <p className="adp-ai-note">{t("ai.localOnly")}</p>
        <HelpButton onOpenHelp={() => props.onOpenHelp("ai-upscaling")} />
      </div>
      <div className="adp-ai-upscale-content">
        <UpscaleControls
          options={optionState.options}
          onChange={changeOptions}
          disabled={preview.state.loading || applying}
        />
        <div className="adp-ai-preview">
          {output ? (
            <p className="adp-ai-note">
              {t("ai.outputSize", { width: output.width, height: output.height })}
            </p>
          ) : null}
          <UpscaleComparison
            beforeUrl={props.beforeUrl ?? null}
            afterUrl={preview.state.afterUrl}
            region={optionState.options.region}
            sourceSize={props.sourceSize ?? null}
            compare={compare}
            busy={preview.state.loading}
            onRegionChange={(region) => changeOptions({ region })}
            onCompareChange={setCompare}
          />
          {preview.state.loading && !showWords ? <Skeleton variant="tiles" count={2} /> : null}
          {preview.state.loading || applying ? (
            <div className="adp-ai-progress" role="status" aria-live="polite">
              <ProgressBar label={t("ai.processing")} />
              {showWords ? <p>{t("ai.processing")}</p> : null}
              <p className="adp-ai-note">{t("ai.calculating")}</p>
              <Button onClick={() => void preview.cancel()}>{t("common.cancel")}</Button>
            </div>
          ) : null}
          {cpuFallback ? (
            <p className="adp-ai-note" role="status">
              {t("ai.cpuFallback")}
            </p>
          ) : null}
          {shownError ? (
            <div className="adp-ai-error" role="alert">
              <p>{errorText(t, shownError, "ai")}</p>
              {missingPack ? (
                <Button
                  variant="primary"
                  data-ai-action="storage"
                  onClick={() => {
                    if (props.onOpenStorage) props.onOpenStorage();
                    else props.onOpenHelp("ai-packs-hardware");
                  }}
                >
                  {t("ai.storage")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="adp-ai-upscale-foot">
        <Button data-ai-action="cancel" onClick={() => void close()}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void preview.start()} disabled={preview.state.loading || applying}>
          {t("ai.preview")}
        </Button>
        {props.onSaveCopy ? (
          <Button onClick={props.onSaveCopy} disabled={!preview.state.preview || applying}>
            {t("ai.newCopy")}
          </Button>
        ) : null}
        {props.documentId && props.expectedContentId ? (
          <Button
            variant="primary"
            disabled={!preview.state.preview || preview.state.loading || applying}
            onClick={() => {
              void apply();
            }}
          >
            {t("ai.apply")}
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
