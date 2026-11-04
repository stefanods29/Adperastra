/** Settings > Version history (Step 06b): on or off, the two limits, the
 * space versions use and Delete all versions. */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import { errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import {
  KEEP_DAYS,
  MAX_VERSIONS_MB,
  type AppSettings,
  type KeepDays,
  type MaxVersionsMb,
} from "../../services/settings";
import { versionsDeleteAll, versionsStoreSize } from "../../services/versions";

const BYTES_PER_MB = 1_048_576;

export interface VersionsSettingsProps {
  settings: AppSettings;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

export default function VersionsSettings({ settings, onApply, onOpenHelp }: VersionsSettingsProps) {
  const { t, i18n } = useTranslation();
  const versions = settings.versions;
  const [storeSize, setStoreSize] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSize = useCallback(async () => {
    try {
      setStoreSize(await versionsStoreSize());
    } catch {
      setStoreSize(0);
    }
  }, []);

  useEffect(() => {
    void refreshSize();
  }, [refreshSize]);

  const update = (patch: Partial<AppSettings["versions"]>) =>
    onApply({ ...settings, versions: { ...versions, ...patch } });

  const deleteAll = async () => {
    try {
      await versionsDeleteAll();
      setConfirmDelete(false);
      setDeleted(true);
      setError(null);
      await refreshSize();
    } catch (caught) {
      setError(errorText(t, caught, "versions"));
    }
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-versions-title">
      <div className="adp-view-header">
        <h3 id="adp-versions-title" className="adp-heading">
          {t("settings.versions")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("version-history")} />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={versions.enabled}
          label={t("settings.versionsEnabled")}
          onChange={(checked) => update({ enabled: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-versions-keep">
          {t("settings.versionsKeep")}
        </label>
        <select
          id="adp-versions-keep"
          className="adp-defaultapps-select"
          aria-label={t("settings.versionsKeep")}
          data-versions-field="keep_days"
          value={versions.keep_days}
          onChange={(event) => update({ keep_days: Number(event.target.value) as KeepDays })}
        >
          {KEEP_DAYS.map((days) => (
            <option key={days} value={days}>
              {t("settings.versionsDays", { count: days })}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-versions-max">
          {t("settings.versionsMax")}
        </label>
        <select
          id="adp-versions-max"
          className="adp-defaultapps-select"
          aria-label={t("settings.versionsMax")}
          data-versions-field="max_mb"
          value={versions.max_mb}
          onChange={(event) => update({ max_mb: Number(event.target.value) as MaxVersionsMb })}
        >
          {MAX_VERSIONS_MB.map((mb) => (
            <option key={mb} value={mb}>
              {formatSize(mb * BYTES_PER_MB, i18n.language)}
            </option>
          ))}
        </select>
        <p className="adp-note">{t("settings.versionsUsed", { size: formatSize(storeSize, i18n.language) })}</p>
      </div>
      <div className="adp-setting-row">
        <Button
          onClick={() => {
            setDeleted(false);
            setConfirmDelete(true);
          }}
        >
          {t("settings.versionsDeleteAll")}
        </Button>
        {deleted ? (
          <p className="adp-note" role="status">
            {t("settings.versionsDeleted")}
          </p>
        ) : null}
        {error ? (
          <p className="adp-note" role="status">
            {error}
          </p>
        ) : null}
      </div>
      {confirmDelete ? (
        <Dialog title={t("settings.versionsDeleteTitle")} onClose={() => setConfirmDelete(false)}>
          <p className="adp-dialog-text">{t("settings.versionsDeleteBody")}</p>
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={() => void deleteAll()}>
              {t("settings.versionsDeleteConfirm")}
            </Button>
            <Button onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
