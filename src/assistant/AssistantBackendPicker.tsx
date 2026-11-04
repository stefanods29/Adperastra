import { useTranslation } from "react-i18next";
import type { AssistantBackend, AssistantProviderId } from "./types";

export interface AssistantBackendPickerProps {
  backend: AssistantBackend;
  providerId: AssistantProviderId;
  onChange(backend: AssistantBackend): void;
  onProviderChange(providerId: AssistantProviderId): void;
  disabled?: boolean;
}

/**
 * Local AI is the initial choice; API is explicit and Meta is first in the
 * API provider list. The cost/disclosure notice is visible before any Send.
 */
export function AssistantBackendPicker({
  backend,
  providerId,
  onChange,
  onProviderChange,
  disabled,
}: AssistantBackendPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="adp-assistant-backend">
      <fieldset className="adp-assistant-radios" disabled={disabled}>
        <legend className="adp-assistant-label">{t("assistant.provider")}</legend>
        <label className="adp-assistant-radio">
          <input
            type="radio"
            name="assistant-backend"
            checked={backend === "local"}
            onChange={() => onChange("local")}
          />
          <span>{t("assistant.local")}</span>
        </label>
        <label className="adp-assistant-radio">
          <input
            type="radio"
            name="assistant-backend"
            checked={backend === "api"}
            onChange={() => onChange("api")}
          />
          <span>{t("assistant.api")}</span>
        </label>
      </fieldset>
      {backend === "api" ? (
        <>
          <label className="adp-assistant-field">
            <span className="adp-assistant-label">{t("assistant.provider")}</span>
            <select
              value={providerId}
              disabled={disabled}
              onChange={(event) => onProviderChange(event.target.value as AssistantProviderId)}
            >
              <option value="meta">Meta</option>
              <option value="custom_compatible">{t("assistant.otherApi")}</option>
            </select>
          </label>
          <p className="adp-assistant-notice" role="note">
            {t("assistant.apiNotice", { provider: providerId === "meta" ? "Meta" : t("assistant.otherApi") })}
          </p>
          <p className="adp-assistant-notice">{t("assistant.apiHistoryNotice")}</p>
        </>
      ) : (
        <p className="adp-assistant-notice">{t("assistant.localOnly")}</p>
      )}
    </div>
  );
}
