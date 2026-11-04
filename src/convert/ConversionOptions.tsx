import { useTranslation } from "react-i18next";
import Switch from "../components/Switch";
import { WARNING_KEYS } from "./ConversionPreview";
import type {
  ConversionWarningCode,
  ConverterSpec,
  MetadataCategory,
  OptionSpec,
} from "./types";

/** The options form below the previews (Step 08a T6). Only option specs the
 * adapter really declares are shown; WebP therefore has no quality field. */

export interface ConversionOptionsProps {
  spec: ConverterSpec;
  values: Readonly<Record<string, boolean | number | string>>;
  onChange: (id: string, value: boolean | number | string) => void;
  metadataKeep: boolean;
  onMetadataKeep: (value: boolean) => void;
  requiredWarnings: readonly ConversionWarningCode[];
  requiredLosses: readonly MetadataCategory[];
  accepted: boolean;
  onAccepted: (value: boolean) => void;
  replaceNotice: boolean;
  disabled?: boolean;
}

export default function ConversionOptions({
  spec,
  values,
  onChange,
  metadataKeep,
  onMetadataKeep,
  requiredWarnings,
  requiredLosses,
  accepted,
  onAccepted,
  replaceNotice,
  disabled = false,
}: ConversionOptionsProps) {
  const { t } = useTranslation();
  const needsAcceptance = requiredWarnings.length > 0 || requiredLosses.length > 0;
  // Only the image adapters keep source metadata; the PDF combine route
  // embeds pixels, so offering a promise it cannot keep would be wrong.
  const keepsMetadata = spec.id.startsWith("image/") || spec.id === "svg/png";
  return (
    <div className="adp-convert-options">
      {spec.options.map((option) => (
        <OptionRow
          key={option.id}
          option={option}
          value={values[option.id] ?? option.default}
          onChange={(value) => onChange(option.id, value)}
          disabled={disabled}
        />
      ))}
      {keepsMetadata ? (
        <div className="adp-convert-row">
          <span className="adp-convert-label">{t("convert.keepMetadata")}</span>
          <Switch
            checked={metadataKeep}
            onChange={onMetadataKeep}
            label={t("convert.keepMetadata")}
            disabled={disabled}
          />
        </div>
      ) : null}
      {replaceNotice ? (
        <p className="adp-convert-note" role="status">
          {t("convert.replaceUnavailable")}
        </p>
      ) : null}
      {needsAcceptance ? (
        <div className="adp-convert-losses" role="group" aria-label={t("convert.lossAccepted")}>
          {requiredLosses.length > 0 ? (
            <p className="adp-convert-note">{t("convert.metadataLoss")}</p>
          ) : null}
          {requiredLosses.length > 0 ? (
            <ul className="adp-convert-loss-list">
              {requiredLosses.map((category) => (
                <li key={category}>
                  <code>{category}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {requiredWarnings.map((code) => (
            <p key={code} className="adp-convert-note">
              {t(WARNING_KEYS[code])}
            </p>
          ))}
          <label className="adp-convert-accept">
            <input
              type="checkbox"
              checked={accepted}
              disabled={disabled}
              onChange={(event) => onAccepted(event.target.checked)}
            />
            <span>{t("convert.lossAccepted")}</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function OptionRow({
  option,
  value,
  onChange,
  disabled,
}: {
  option: OptionSpec;
  value: boolean | number | string;
  onChange: (value: boolean | number | string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const label = t(option.label_key);
  if (option.kind === "boolean") {
    return (
      <div className="adp-convert-row">
        <span className="adp-convert-label">{label}</span>
        <Switch
          checked={value === true}
          onChange={onChange}
          label={label}
          disabled={disabled}
        />
      </div>
    );
  }
  if (option.kind === "integer") {
    return (
      <div className="adp-convert-row">
        <span className="adp-convert-label">{label}</span>
        <input
          className="adp-input adp-convert-number"
          type="number"
          aria-label={label}
          min={option.min}
          max={option.max}
          step={1}
          value={typeof value === "number" ? value : 0}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    );
  }
  return (
    <div className="adp-convert-row">
      <span className="adp-convert-label">{label}</span>
      <select
        className="adp-input"
        aria-label={label}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {(option.choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {t(choice.label_key)}
          </option>
        ))}
      </select>
    </div>
  );
}
