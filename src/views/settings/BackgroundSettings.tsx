/** Settings > Background work (Step 07a, T8): the shared policy switches,
 * the pause control and the preview cache limit. Every toggle saves one
 * complete settings object, never a partial write. */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Switch from "../../components/Switch";
import {
  CACHE_LIMITS_MB,
  getBackgroundStatus,
  type BackgroundSettings as BackgroundSettingsData,
  type BackgroundStatus,
  type BackgroundTaskKind,
} from "../../services/background";
import type { AppSettings, CacheLimitMb } from "../../services/settings";

export interface BackgroundSettingsProps {
  settings: AppSettings;
  active?: boolean;
  onApply: (settings: AppSettings) => void;
  onOpenHelp: (slug: string) => void;
}

export default function BackgroundSettings({
  settings,
  active = true,
  onApply,
  onOpenHelp,
}: BackgroundSettingsProps) {
  const { t } = useTranslation();
  const background = settings.background;
  const [status, setStatus] = useState<BackgroundStatus | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const refresh = async () => {
      try {
        const next = await getBackgroundStatus();
        if (alive) setStatus(next);
      } catch {
        if (alive) setStatus(null);
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [active, background]);

  const update = (patch: Partial<BackgroundSettingsData>) => {
    onApply({ ...settings, background: { ...background, ...patch } });
  };

  const updateTask = (kind: BackgroundTaskKind, checked: boolean) => {
    update({ tasks: { ...background.tasks, [kind]: checked } });
  };

  const updateCache = (max_mb: CacheLimitMb) => {
    onApply({ ...settings, cache: { ...settings.cache, max_mb } });
  };

  const waiting =
    status?.reason === "idle"
      ? t("background.waitingIdle")
      : status?.reason === "ac"
        ? t("background.waitingAc")
        : null;

  return (
    <section className="adp-settings-section" aria-labelledby="adp-background-title">
      <div className="adp-view-header">
        <h3 id="adp-background-title" className="adp-heading">
          {t("settings.background")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("background-work")} />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={background.enabled}
          label={t("settings.backgroundEnabled")}
          onChange={(checked) => update({ enabled: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={background.tasks.thumbnails}
          label={t("settings.backgroundThumbnails")}
          disabled={!background.enabled}
          onChange={(checked) => updateTask("thumbnails", checked)}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={background.only_idle}
          label={t("settings.backgroundIdle")}
          disabled={!background.enabled}
          onChange={(checked) => update({ only_idle: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={background.only_ac}
          label={t("settings.backgroundAc")}
          disabled={!background.enabled}
          onChange={(checked) => update({ only_ac: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={background.paused}
          label={t("settings.backgroundPaused")}
          onChange={(checked) => update({ paused: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-background-cache">
          {t("settings.cacheLimit")}
        </label>
        <select
          id="adp-background-cache"
          className="adp-defaultapps-select"
          aria-label={t("settings.cacheLimit")}
          data-background-field="max_mb"
          value={settings.cache.max_mb}
          onChange={(event) => updateCache(Number(event.target.value) as CacheLimitMb)}
        >
          {CACHE_LIMITS_MB.map((mb) => (
            <option key={mb} value={mb}>
              {t("settings.cacheLimitOption", { size: mb })}
            </option>
          ))}
        </select>
      </div>
      <p className="adp-note" role="status" aria-busy={status === null}>
        {status === null ? t("components.loading") : (waiting ?? "")}
      </p>
    </section>
  );
}
