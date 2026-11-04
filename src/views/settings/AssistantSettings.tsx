import { useTranslation } from "react-i18next";
import type {
  AssistantEndpointStatus,
  AssistantProviderId,
  AssistantSettings as AssistantSettingsValue,
  CredentialStatus,
} from "../../assistant/types";
import { ASSISTANT_AUTOMATIC_TOOL_KEYS } from "../../assistant/types";

export interface AssistantSettingsProps {
  settings: AssistantSettingsValue;
  credential: CredentialStatus | null;
  endpoint: AssistantEndpointStatus | null;
  onChange(settings: AssistantSettingsValue): void;
  onOpenHelp(slug: string): void;
  onEditKey?(providerId: AssistantProviderId): Promise<void>;
  onRemoveKey?(providerId: AssistantProviderId): Promise<void>;
  onTest?(providerId: AssistantProviderId): Promise<void>;
  onListModels?(providerId: AssistantProviderId): Promise<void>;
  onConfigureEndpoint?(baseUrl: string, modelId: string): Promise<void>;
  onProbe?(probe: "models" | "structured" | "vision"): Promise<void>;
  onClearHistory?(): Promise<void>;
}

/**
 * Assistant preferences (Step 17a T7). Local AI is the default; API mode
 * discloses possible charges before Save. The key is never read back: only
 * `has_key` and the masked hint are shown. Custom endpoint testing is a
 * separate explicit click.
 */
export function AssistantSettings({
  settings,
  credential,
  endpoint,
  onChange,
  onOpenHelp,
  onEditKey,
  onRemoveKey,
  onTest,
  onListModels,
  onConfigureEndpoint,
  onProbe,
  onClearHistory,
}: AssistantSettingsProps) {
  const { t } = useTranslation();
  const patch = (part: Partial<AssistantSettingsValue>) => onChange({ ...settings, ...part });

  return (
    <form className="adp-assistant-settings" onSubmit={(event) => event.preventDefault()}>
      <fieldset>
        <legend>{t("assistant.title")}</legend>
        <label className="adp-assistant-field">
          <span>{t("assistant.name")}</span>
          <input
            type="text"
            maxLength={40}
            value={settings.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <fieldset className="adp-assistant-radios">
          <legend>{t("assistant.provider")}</legend>
          <label className="adp-assistant-radio">
            <input
              type="radio"
              name="assistant-settings-backend"
              checked={settings.backend === "local"}
              onChange={() => patch({ backend: "local" })}
            />
            <span>{t("assistant.local")}</span>
          </label>
          <label className="adp-assistant-radio">
            <input
              type="radio"
              name="assistant-settings-backend"
              checked={settings.backend === "api"}
              onChange={() => patch({ backend: "api", provider_id: "meta" })}
            />
            <span>{t("assistant.api")}</span>
          </label>
        </fieldset>
        {settings.backend === "api" ? (
          <>
            <label className="adp-assistant-field">
              <span>{t("assistant.provider")}</span>
              <select
                value={settings.provider_id}
                onChange={(event) => {
                  const providerId = event.target.value as AssistantProviderId;
                  patch({
                    provider_id: providerId,
                    custom_endpoint_id: providerId === "meta" ? null : settings.custom_endpoint_id,
                  });
                }}
              >
                <option value="meta">Meta</option>
                <option value="custom_compatible">{t("assistant.otherApi")}</option>
              </select>
            </label>
            <p className="adp-assistant-notice" role="note">
              {t("assistant.apiNotice", {
                provider: settings.provider_id === "meta" ? "Meta" : t("assistant.otherApi"),
              })}
            </p>
            <p className="adp-assistant-notice">{t("assistant.apiHistoryNotice")}</p>
            <div className="adp-assistant-key-row">
              <span>{credential?.has_key ? t("assistant.keyPresent", { hint: credential.masked_hint }) : t("assistant.noKey")}</span>
              <button type="button" className="adp-button" onClick={() => void onEditKey?.(settings.provider_id)}>
                {t("assistant.editKey")}
              </button>
              <button type="button" className="adp-button" onClick={() => void onRemoveKey?.(settings.provider_id)}>
                {t("assistant.removeKey")}
              </button>
              <button type="button" className="adp-button" onClick={() => void onTest?.(settings.provider_id)}>
                {t("assistant.test")}
              </button>
              <button type="button" className="adp-button" onClick={() => void onListModels?.(settings.provider_id)}>
                {t("assistant.models")}
              </button>
            </div>
            <label className="adp-assistant-field">
              <span>{t("assistant.model")}</span>
              <input
                type="text"
                maxLength={96}
                value={settings.api_model_id}
                disabled={settings.provider_id === "meta"}
                onChange={(event) => patch({ api_model_id: event.target.value })}
              />
            </label>
            {settings.provider_id === "custom_compatible" ? (
              <fieldset>
                <legend>{t("assistant.otherApi")}</legend>
                <label className="adp-assistant-field">
                  <span>{t("assistant.endpoint")}</span>
                  <input
                    type="url"
                    maxLength={2048}
                    defaultValue={endpoint?.display_origin ?? ""}
                    onBlur={(event) => {
                      if (event.target.value.trim()) {
                        void onConfigureEndpoint?.(event.target.value, settings.api_model_id);
                      }
                    }}
                  />
                </label>
                <p className="adp-assistant-notice">{t("assistant.endpointNotice", { origin: endpoint?.display_origin ?? "" })}</p>
                <div className="adp-assistant-action-buttons">
                  <button type="button" className="adp-button" onClick={() => void onProbe?.("structured")}>
                    {t("assistant.testStructured")}
                  </button>
                  <button type="button" className="adp-button" onClick={() => void onProbe?.("vision")}>
                    {t("assistant.testVision")}
                  </button>
                </div>
                <p className="adp-assistant-meta">
                  <span aria-hidden="true">{endpoint?.schema_supported ? "✓" : "—"}</span>{" "}
                  {t("assistant.testStructured")}
                  {" · "}
                  <span aria-hidden="true">{endpoint?.vision_supported ? "✓" : "—"}</span>{" "}
                  {t("assistant.testVision")}
                </p>
              </fieldset>
            ) : null}
          </>
        ) : (
          <>
            <p className="adp-assistant-notice">{t("assistant.localOnly")}</p>
            <label className="adp-assistant-field">
              <span>{t("assistant.localServer")}</span>
              <select
                value={settings.local_source}
                onChange={(event) => patch({ local_source: event.target.value as AssistantSettingsValue["local_source"] })}
              >
                <option value="bundled">{t("assistant.local")}</option>
                <option value="user_server">{t("assistant.localServer")}</option>
              </select>
            </label>
            {settings.local_source === "user_server" ? (
              <>
                <p className="adp-assistant-notice">{t("assistant.serverNotice")}</p>
                <label className="adp-assistant-field">
                  <span>{t("assistant.endpoint")}</span>
                  <input
                    type="text"
                    maxLength={16}
                    value={settings.local_server_address}
                    onChange={(event) =>
                      patch({ local_server_address: event.target.value === "::1" ? "::1" : "127.0.0.1" })
                    }
                  />
                </label>
                <label className="adp-assistant-field">
                  <span>{t("assistant.endpoint")}</span>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={settings.local_server_port}
                    onChange={(event) =>
                      patch({ local_server_port: Math.min(65_535, Math.max(1_024, Number(event.target.value))) })
                    }
                  />
                </label>
              </>
            ) : null}
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>{t("assistant.length")}</legend>
        <label className="adp-assistant-field">
          <span>{t("assistant.length")}</span>
          <select
            value={settings.answer_length}
            onChange={(event) => patch({ answer_length: event.target.value as AssistantSettingsValue["answer_length"] })}
          >
            <option value="short">{t("assistant.short")}</option>
            <option value="normal">{t("assistant.normal")}</option>
            <option value="detailed">{t("assistant.detailed")}</option>
          </select>
        </label>
        <label className="adp-assistant-field">
          <span>{t("assistant.tone")}</span>
          <select value={settings.tone} onChange={(event) => patch({ tone: event.target.value as AssistantSettingsValue["tone"] })}>
            <option value="friendly">{t("assistant.friendly")}</option>
            <option value="neutral">{t("assistant.neutral")}</option>
          </select>
        </label>
        <label className="adp-assistant-field">
          <span>{t("assistant.language")}</span>
          <select value={settings.language} onChange={(event) => patch({ language: event.target.value as AssistantSettingsValue["language"] })}>
            <option value="app">{t("assistant.followApp")}</option>
            <option value="input">{t("assistant.followInput")}</option>
          </select>
        </label>
        <label className="adp-assistant-radio">
          <input type="checkbox" checked={settings.show_steps} onChange={(event) => patch({ show_steps: event.target.checked })} />
          <span>{t("assistant.showSteps")}</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>{t("assistant.automaticTools")}</legend>
        {ASSISTANT_AUTOMATIC_TOOL_KEYS.map((tool) => (
          <label className="adp-assistant-radio" key={tool}>
            <input
              type="checkbox"
              checked={settings.automatic_tools[tool]}
              onChange={(event) =>
                patch({ automatic_tools: { ...settings.automatic_tools, [tool]: event.target.checked } })
              }
            />
            <span>{t(`assistant.tool.${tool}`)}</span>
          </label>
        ))}
        <label className="adp-assistant-radio">
          <input
            type="checkbox"
            checked={settings.allow_read_contents}
            onChange={(event) => patch({ allow_read_contents: event.target.checked })}
          />
          <span>{t("assistant.readContents")}</span>
        </label>
        <button type="button" className="adp-button" onClick={() => onOpenHelp("assistant-preferences")}>
          {t("assistant.deniedFolders")}
        </button>
      </fieldset>

      <fieldset>
        <legend>{t("assistant.keepHistory")}</legend>
        <label className="adp-assistant-radio">
          <input type="checkbox" checked={settings.keep_history} onChange={(event) => patch({ keep_history: event.target.checked })} />
          <span>{t("assistant.keepHistory")}</span>
        </label>
        <p className="adp-assistant-notice">{t("assistant.historyPrivate")}</p>
        <button type="button" className="adp-button" onClick={() => void onClearHistory?.()}>
          {t("assistant.clearHistory")}
        </button>
      </fieldset>
    </form>
  );
}

export default AssistantSettings;
