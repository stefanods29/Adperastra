/** Hosts for the feature-owned Settings bodies that read native status. */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import { clearAssistantHistory } from "../../assistant/history";
import type { AssistantEndpointStatus, CredentialStatus } from "../../assistant/types";
import { semanticStatus } from "../../services/aiSearch";
import type { SemanticStatus } from "../../services/aiSearchTypes";
import {
  assistantEndpointStatus,
  configureAssistantEndpoint,
  credentialStatus,
  editAssistantCredential,
  listAssistantModels,
  probeAssistantEndpoint,
  removeAssistantCredential,
  testAssistantProvider,
} from "../../services/assistantProviders";
import { errorText } from "../../services/errors";
import { residentStatus, setResidentMode } from "../../services/resident";
import type { ResidentStartupChoices, ResidentStatus } from "../../services/resident";
import type { AppSettings } from "../../services/settings";
import {
  applyWindowsIntegration,
  integrationStatus,
  openDefaultAppsSettings,
  type IntegrationRequest,
  type IntegrationStatus,
} from "../../services/windowsIntegration";
import AiSearchSettingsSection from "./AiSearchSettings";
import AssistantSettings from "./AssistantSettings";
import StartupResidentSettings from "./StartupResidentSettings";
import WindowsIntegrationSettings from "./WindowsIntegrationSettings";

export interface SettingsBodyProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

/** Settings > AI search: the native status is loaded only while visible. */
export function AiSearchSettingsBody({ settings, onApply, onOpenHelp }: SettingsBodyProps) {
  const [status, setStatus] = useState<SemanticStatus | null>(null);

  useEffect(() => {
    let live = true;
    void semanticStatus()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <AiSearchSettingsSection
      settings={settings.ai_search}
      indexRoots={settings.search.roots}
      status={status}
      onChange={(aiSearch) => onApply({ ...settings, ai_search: aiSearch })}
      onOpenHelp={onOpenHelp}
    />
  );
}

/** Settings > Assistant: provider status and explicit provider actions. */
export function AssistantSettingsBody({ settings, onApply, onOpenHelp }: SettingsBodyProps) {
  const { t } = useTranslation();
  const [credential, setCredential] = useState<CredentialStatus | null>(null);
  const [endpoint, setEndpoint] = useState<AssistantEndpointStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providerId = settings.assistant.provider_id;

  const refresh = useCallback(async () => {
    try {
      const [nextCredential, nextEndpoint] = await Promise.all([
        credentialStatus(providerId),
        assistantEndpointStatus(),
      ]);
      setCredential(nextCredential);
      setEndpoint(nextEndpoint);
      setError(null);
    } catch (caught) {
      setError(errorText(t, caught, "assistant"));
    }
  }, [providerId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "assistant"));
    }
  };

  return (
    <>
      <AssistantSettings
        settings={settings.assistant}
        credential={credential}
        endpoint={endpoint}
        onChange={(assistant) => onApply({ ...settings, assistant })}
        onOpenHelp={onOpenHelp}
        onEditKey={(id) => run(() => editAssistantCredential(id))}
        onRemoveKey={(id) => run(() => removeAssistantCredential(id))}
        onTest={(id) => run(() => testAssistantProvider(id))}
        onListModels={(id) => run(() => listAssistantModels(id))}
        onConfigureEndpoint={(baseUrl, modelId) =>
          run(() => configureAssistantEndpoint(baseUrl, modelId))
        }
        onProbe={(probe) => {
          const endpointId = endpoint?.id;
          return endpointId ? run(() => probeAssistantEndpoint(endpointId, probe)) : Promise.resolve();
        }}
        onClearHistory={() => run(() => clearAssistantHistory())}
      />
      {error !== null ? (
        <p className="adp-note" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Settings > Startup: the resident switches plus the measured memory. */
export function StartupResidentSettingsBody({ settings, onApply, onOpenHelp }: SettingsBodyProps) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<ResidentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    void residentStatus()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch((caught) => {
        if (live) setError(caught);
      });
    return () => {
      live = false;
    };
  }, []);

  const change = async (next: ResidentStartupChoices) => {
    setPending(true);
    setError(null);
    try {
      const nextStatus = await setResidentMode(next.stay_in_background, next.start_with_windows);
      setStatus(nextStatus);
      onApply({
        ...settings,
        startup: {
          ...settings.startup,
          stay_in_background: next.stay_in_background,
          start_with_windows: next.start_with_windows,
        },
      });
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-startup-title">
      <div className="adp-view-header">
        <h3 id="adp-startup-title" className="adp-heading">
          {t("startup.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("the-settings-page")} />
      </div>
      <StartupResidentSettings
        startup={{
          stay_in_background: settings.startup.stay_in_background,
          start_with_windows: settings.startup.start_with_windows,
        }}
        status={status}
        pending={pending}
        error={error}
        locale={i18n.language}
        onChange={change}
      />
    </section>
  );
}

/** Settings > Windows integration: status loads only while the section is shown. */
export function WindowsIntegrationSettingsBody({ onOpenHelp }: SettingsBodyProps) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    void integrationStatus()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch((caught) => {
        if (live) setError(caught);
      });
    return () => {
      live = false;
    };
  }, []);

  const apply = async (request: IntegrationRequest) => {
    setPending(true);
    setError(null);
    try {
      setStatus(await applyWindowsIntegration(request));
    } catch (caught) {
      setError(caught);
      throw caught;
    } finally {
      setPending(false);
    }
  };

  return (
    <WindowsIntegrationSettings
      status={status}
      error={error}
      pending={pending}
      onApply={apply}
      onChooseDefaults={openDefaultAppsSettings}
      onOpenHelp={onOpenHelp}
    />
  );
}
