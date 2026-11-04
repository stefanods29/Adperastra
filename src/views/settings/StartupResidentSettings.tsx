import { useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "../../components/Switch";
import { errorText } from "../../services/errors";
import {
  formatResidentMemory,
  type ResidentStatus,
  type ResidentStartupChoices,
} from "../../services/resident";

export interface StartupResidentSettingsProps {
  startup: ResidentStartupChoices;
  status: ResidentStatus | null;
  /** The host is loading or saving. */
  pending: boolean;
  error: unknown;
  /** The app language, for the measured size figure. */
  locale: string;
  onChange: (next: ResidentStartupChoices) => Promise<void>;
}

/**
 * The resident part of the existing Startup settings section: two switches
 * and the actual measured background memory. It never enables another
 * background task or an update check.
 */
export default function StartupResidentSettings({
  startup,
  status,
  pending,
  error,
  locale,
  onChange,
}: StartupResidentSettingsProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const disabled = pending || busy;

  const change = async (next: ResidentStartupChoices) => {
    if (disabled) return;
    setBusy(true);
    try {
      await onChange(next);
    } catch {
      // The parent owns the translated error; the switch reflects saved state.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adp-resident-settings" role="group" aria-label={t("resident.enable")}>
      <div className="adp-setting-row">
        <Switch
          checked={startup.stay_in_background}
          disabled={disabled}
          label={t("resident.enable")}
          onChange={(checked) =>
            void change({
              stay_in_background: checked,
              start_with_windows: checked ? startup.start_with_windows : false,
            })
          }
        />
        <p className="adp-note">{t("resident.explain")}</p>
      </div>

      <div className="adp-setting-row">
        <Switch
          checked={startup.start_with_windows}
          disabled={disabled || !startup.stay_in_background}
          label={t("resident.startWindows")}
          onChange={(checked) =>
            void change({ ...startup, start_with_windows: checked })
          }
        />
        {!startup.stay_in_background ? (
          <p className="adp-note">{t("resident.startRequiresBackground")}</p>
        ) : null}
      </div>

      {status && status.measured_unix > 0 ? (
        <p className="adp-resident-memory" aria-live="polite">
          {t("resident.memory", {
            size: formatResidentMemory(status.private_bytes, locale),
          })}
        </p>
      ) : null}

      {error ? (
        <p className="adp-note" role="alert">
          {errorText(t, error, "resident")}
        </p>
      ) : null}
    </div>
  );
}

