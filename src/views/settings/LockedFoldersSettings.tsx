import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import type { LockedSettings } from "../../services/lockedFolders";

export interface LockedFoldersSettingsProps {
  settings: LockedSettings;
  onChange: (settings: LockedSettings) => void;
  onOpenHelp: (slug: string) => void;
}

/** Settings > Locked folders (Step 09k, schema 27). No password or key is
 * ever stored here. */
export default function LockedFoldersSettings({
  settings,
  onChange,
  onOpenHelp,
}: LockedFoldersSettingsProps) {
  const { t } = useTranslation();
  return (
    <section className="adp-settings-section">
      <div className="adp-settings-section-header">
        <h3>{t("locked.title")}</h3>
        <HelpButton onOpenHelp={() => onOpenHelp("locking-protection")} />
      </div>
      <label className="adp-settings-row">
        <span>{t("locked.autoLock")}</span>
        <select
          className="adp-select"
          value={settings.auto_lock_minutes}
          onChange={(event) =>
            onChange({
              ...settings,
              auto_lock_minutes: Number(event.target.value) as LockedSettings["auto_lock_minutes"],
            })
          }
          aria-label={t("locked.autoLock")}
        >
          <option value={1}>1</option>
          <option value={5}>5</option>
          <option value={15}>15</option>
          <option value={30}>30</option>
          <option value={0}>{t("locked.never")}</option>
        </select>
      </label>
      <p className="adp-settings-hint">{t("locked.autoLockHint")}</p>
      <div className="adp-settings-row">
        <span>{t("locked.lockOnWorkstation")}</span>
        <Switch
          checked={settings.lock_on_workstation}
          onChange={(checked) => onChange({ ...settings, lock_on_workstation: checked })}
          label={t("locked.lockOnWorkstation")}
        />
      </div>
    </section>
  );
}
