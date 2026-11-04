import { useTranslation } from "react-i18next";
import type { AiDevice, UpscaleModel, UpscaleScale } from "../services/localAiTypes";
import type { UpscaleUiOptions } from "./upscale";

export interface UpscaleControlsProps {
  options: UpscaleUiOptions;
  onChange: (patch: Partial<UpscaleUiOptions>) => void;
  disabled?: boolean;
}

const MODELS: readonly UpscaleModel[] = ["general", "photo", "drawing"];
const MODEL_KEYS: Record<UpscaleModel, string> = {
  general: "ai.general",
  photo: "ai.photo",
  drawing: "ai.drawing",
};
const DEVICES: readonly AiDevice[] = ["auto", "cpu", "gpu"];
const DEVICE_KEYS: Record<AiDevice, string> = {
  auto: "ai.auto",
  cpu: "ai.cpu",
  gpu: "ai.gpu",
};

export default function UpscaleControls({ options, onChange, disabled }: UpscaleControlsProps) {
  const { t } = useTranslation();
  return (
    <aside className="adp-ai-upscale-controls" aria-label={t("ai.upscale")}>
      <label className="adp-ai-field">
        <span>{t("ai.model")}</span>
        <select
          className="adp-ai-select"
          value={options.model}
          disabled={disabled}
          onChange={(event) => onChange({ model: event.target.value as UpscaleModel })}
        >
          {MODELS.map((model) => (
            <option key={model} value={model}>
              {t(MODEL_KEYS[model])}
            </option>
          ))}
        </select>
      </label>
      <label className="adp-ai-field">
        <span>{t("ai.scale")}</span>
        <select
          className="adp-ai-select"
          value={options.scale}
          disabled={disabled}
          onChange={(event) => onChange({ scale: Number(event.target.value) as UpscaleScale })}
        >
          <option value={2}>{t("ai.scale2")}</option>
          <option value={4}>{t("ai.scale4")}</option>
        </select>
      </label>
      <label className="adp-ai-field">
        <span>{t("ai.device")}</span>
        <select
          className="adp-ai-select"
          value={options.device}
          disabled={disabled}
          onChange={(event) => onChange({ device: event.target.value as AiDevice })}
        >
          {DEVICES.map((device) => (
            <option key={device} value={device}>
              {t(DEVICE_KEYS[device])}
            </option>
          ))}
        </select>
      </label>
      <p className="adp-ai-note">{t("ai.localOnly")}</p>
    </aside>
  );
}
