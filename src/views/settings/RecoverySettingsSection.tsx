/** Settings > Recovery and diagnostics (Step 09h): keep recovery revisions,
 * the capture interval, the diagnostics dump opt-in, and the always-on path
 * masking. `max_mib` stays out of the UI (the 64 MiB record cap is fixed),
 * and path masking has no off switch. */
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { RecoverySettings } from "../../services/settings";

/** The native validator and `normalizeRecovery` accept this range only. */
const INTERVAL_MIN = 10;
const INTERVAL_MAX = 300;

export interface RecoverySettingsSectionProps {
  recovery: RecoverySettings;
  onChange: (next: RecoverySettings) => void;
  onOpenHelp: (slug: string) => void;
}

export default function RecoverySettingsSection({
  recovery,
  onChange,
  onOpenHelp,
}: RecoverySettingsSectionProps) {
  const { t } = useTranslation();
  const intervalId = useId();
  // A draft keeps typing "45" from being clamped to "10" after the first key.
  const [intervalDraft, setIntervalDraft] = useState(String(recovery.interval_seconds));

  useEffect(() => {
    setIntervalDraft(String(recovery.interval_seconds));
  }, [recovery.interval_seconds]);

  const commitInterval = () => {
    const parsed = Number(intervalDraft);
    if (!Number.isFinite(parsed)) {
      setIntervalDraft(String(recovery.interval_seconds));
      return;
    }
    const interval_seconds = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.round(parsed)));
    setIntervalDraft(String(interval_seconds));
    if (interval_seconds !== recovery.interval_seconds) onChange({ ...recovery, interval_seconds });
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-recovery-title">
      <div className="adp-view-header">
        <h3 id="adp-recovery-title" className="adp-heading">
          {t("recovery.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("recovering-after-a-crash")} />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={recovery.enabled}
          label={t("recovery.enabled")}
          onChange={(enabled) => onChange({ ...recovery, enabled })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor={intervalId}>
          {t("recovery.interval")}
        </label>
        <input
          id={intervalId}
          className="adp-input"
          type="number"
          min={INTERVAL_MIN}
          max={INTERVAL_MAX}
          step={1}
          value={intervalDraft}
          disabled={!recovery.enabled}
          aria-label={t("recovery.interval")}
          onChange={(event) => setIntervalDraft(event.target.value)}
          onBlur={commitInterval}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={recovery.diagnostics_include_dumps}
          label={t("diagnostics.dumps")}
          onChange={(diagnostics_include_dumps) =>
            onChange({ ...recovery, diagnostics_include_dumps })
          }
        />
        <p className="adp-note">{t("diagnostics.dumpWarning")}</p>
      </div>
      <div className="adp-setting-row">
        {/* Masking is the safe default and has no setting: shown as a locked,
            checked box so the choice is visible but cannot be switched off. */}
        <label className="adp-diagnostics-redact">
          <input
            type="checkbox"
            checked
            readOnly
            disabled
            aria-label={t("diagnostics.redact")}
          />
          <span>{t("diagnostics.redact")}</span>
        </label>
      </div>
    </section>
  );
}
