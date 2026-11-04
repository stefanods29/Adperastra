import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import HelpButton from "../../components/HelpButton";
import Skeleton from "../../components/Skeleton";
import Switch from "../../components/Switch";
import TextInput from "../../components/TextInput";
import {
  CACHE_LIMITS_MB,
  getBackgroundStatus,
  listBackgroundTasks,
  pauseAllBackground,
  BACKGROUND_TASK_KINDS,
  type BackgroundStatus,
  type BackgroundTaskKind,
  type BackgroundTaskStatus,
} from "../../services/background";
import { errorText } from "../../services/errors";
import {
  normalizeOcrLanguages,
  ocrLanguages,
  type OcrLanguage,
} from "../../services/ocr";
import type { CacheLimitMb, FolderSizeSettings } from "../../services/settings";

/** The schema-37 background controls the Settings page edits. */
export interface BackgroundControlsView {
  enabled: boolean;
  only_idle: boolean;
  only_ac: boolean;
  paused: boolean;
  pause_fullscreen: boolean;
  quiet_hours: {
    enabled: boolean;
    start_minute: number;
    end_minute: number;
  };
  cpu_percent: number;
  tasks: Record<BackgroundTaskKind, boolean>;
}

export interface BackgroundWorkSettingsProps {
  controls: BackgroundControlsView;
  onChange: (patch: Partial<BackgroundControlsView>) => void;
  cacheLimit: CacheLimitMb;
  ocrLanguage: string;
  onCacheLimitChange: (max_mb: CacheLimitMb) => void;
  onOcrLanguageChange: (language: string) => void;
  /** Optional background folder sizes (Step 11c). */
  folderSizes: FolderSizeSettings;
  onFolderSizesChange: (next: FolderSizeSettings) => void;
  onOpenHelp: (slug: string) => void;
}

function timeValue(minute: number): string {
  const safe = Math.min(24 * 60 - 1, Math.max(0, Math.round(minute)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function minuteValue(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Settings > Background work (Step 12a, expanding Step 07a). */
export default function BackgroundWorkSettings({
  controls,
  onChange,
  cacheLimit,
  ocrLanguage,
  onCacheLimitChange,
  onOcrLanguageChange,
  folderSizes,
  onFolderSizesChange,
  onOpenHelp,
}: BackgroundWorkSettingsProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [tasks, setTasks] = useState<BackgroundTaskStatus[]>([]);
  const [languages, setLanguages] = useState<OcrLanguage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pauseBusy = useRef(false);

  useEffect(() => {
    let alive = true;
    void ocrLanguages()
      .then((list) => {
        if (alive) setLanguages(normalizeOcrLanguages(list));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextTasks] = await Promise.all([
        getBackgroundStatus(),
        listBackgroundTasks(),
      ]);
      setStatus(nextStatus);
      setTasks(nextTasks);
      setError(null);
    } catch (caught) {
      setError(errorText(t, caught, "background"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const paused = status?.paused ?? controls.paused;
  const togglePause = async () => {
    if (pauseBusy.current) return;
    pauseBusy.current = true;
    setBusy(true);
    try {
      await pauseAllBackground(!paused);
      await refresh();
    } catch (caught) {
      setError(errorText(t, caught, "background"));
    } finally {
      pauseBusy.current = false;
      setBusy(false);
    }
  };

  const taskRow = (kind: BackgroundTaskKind) => {
    const state = tasks.find((task) => task.kind === kind);
    const enabled = controls.tasks[kind] ?? state?.enabled ?? false;
    let statusText = t("common.ready");
    if (state?.last_error_code) {
      statusText = errorText(t, state.last_error_code, "background");
    } else if (!enabled) {
      statusText = t("background.disabled");
    } else if (state && !state.eligible) {
      statusText = state.reason
        ? t(`background.reason.${state.reason}`, { defaultValue: t("background.waiting") })
        : t("background.waiting");
    } else if (state && state.running > 0) {
      statusText = t("background.runningCount", { count: state.running });
    }
    return (
      <div className="adp-background-row" role="row" key={kind} data-background-task={kind}>
        <span role="cell">
          <Switch
            checked={enabled}
            label={t(`background.task.${kind}`)}
            onChange={(checked) =>
              onChange({ tasks: { ...controls.tasks, [kind]: checked } })
            }
          />
        </span>
        <span role="cell" aria-live="polite">
          {statusText}
          {state && state.queued > 0
            ? ` · ${t("background.queuedCount", { count: state.queued })}`
            : ""}
        </span>
      </div>
    );
  };

  if (loading) {
    return (
      <section className="adp-settings-section" aria-labelledby="adp-background-title">
        <h3 id="adp-background-title" className="adp-heading">
          {t("background.title")}
        </h3>
        <Skeleton count={3} />
      </section>
    );
  }

  return (
    <section className="adp-settings-section" aria-labelledby="adp-background-title">
      <div className="adp-view-header">
        <h3 id="adp-background-title" className="adp-heading">
          {t("background.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("background-work")} />
      </div>
      {error ? (
        <p className="adp-note" role="alert">
          {error}
        </p>
      ) : null}

      <div className="adp-background-summary" role="status" aria-live="polite">
        <span>
          {paused
            ? t("background.pausedNote")
            : status?.eligible
              ? t("background.readyNote")
              : t("background.waiting")}
        </span>
        <Button
          variant={paused ? "primary" : "default"}
          disabled={busy}
          onClick={() => void togglePause()}
        >
          {paused ? t("background.resume") : t("background.pause")}
        </Button>
      </div>

      <h4 className="adp-heading adp-background-subtitle">{t("background.tasks")}</h4>
      <div className="adp-background-table" role="table" aria-label={t("background.tasks")}>
        {BACKGROUND_TASK_KINDS.map(taskRow)}
      </div>

      <h4 className="adp-heading adp-background-subtitle">{t("folderSizes.title")}</h4>
      <div className="adp-setting-row">
        <Switch
          checked={folderSizes.enabled}
          label={t("folderSizes.enable")}
          onChange={(enabled) => onFolderSizesChange({ ...folderSizes, enabled })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={folderSizes.network}
          label={t("folderSizes.network")}
          disabled={!folderSizes.enabled}
          onChange={(network) => onFolderSizesChange({ ...folderSizes, network })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={folderSizes.details}
          label={t("folderSizes.details")}
          disabled={!folderSizes.enabled}
          onChange={(details) => onFolderSizesChange({ ...folderSizes, details })}
        />
      </div>

      <h4 className="adp-heading adp-background-subtitle">{t("background.rules")}</h4>
      <div className="adp-setting-row">
        <Switch
          checked={controls.enabled}
          label={t("background.enabled")}
          onChange={(checked) => onChange({ enabled: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={controls.only_idle}
          label={t("background.idle")}
          onChange={(checked) => onChange({ only_idle: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={controls.only_ac}
          label={t("background.ac")}
          onChange={(checked) => onChange({ only_ac: checked })}
        />
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={controls.pause_fullscreen}
          label={t("background.fullscreen")}
          onChange={(checked) => onChange({ pause_fullscreen: checked })}
        />
      </div>
      <div className="adp-setting-row adp-background-quiet">
        <Switch
          checked={controls.quiet_hours.enabled}
          label={t("background.quiet")}
          onChange={(checked) =>
            onChange({ quiet_hours: { ...controls.quiet_hours, enabled: checked } })
          }
        />
        <label className="adp-setting-label" htmlFor="adp-quiet-start">
          {t("background.quietStart")}
        </label>
        <TextInput
          inputId="adp-quiet-start"
          type="time"
          value={timeValue(controls.quiet_hours.start_minute)}
          disabled={!controls.quiet_hours.enabled}
          onChange={(value) => {
            const minute = minuteValue(value);
            if (minute !== null) {
              onChange({ quiet_hours: { ...controls.quiet_hours, start_minute: minute } });
            }
          }}
        />
        <label className="adp-setting-label" htmlFor="adp-quiet-end">
          {t("background.quietEnd")}
        </label>
        <TextInput
          inputId="adp-quiet-end"
          type="time"
          value={timeValue(controls.quiet_hours.end_minute)}
          disabled={!controls.quiet_hours.enabled}
          onChange={(value) => {
            const minute = minuteValue(value);
            if (minute !== null) {
              onChange({ quiet_hours: { ...controls.quiet_hours, end_minute: minute } });
            }
          }}
        />
      </div>
      <div className="adp-setting-row adp-background-cpu">
        <label className="adp-setting-label" htmlFor="adp-background-cpu">
          {t("background.cpu")}
        </label>
        <input
          id="adp-background-cpu"
          type="range"
          min={5}
          max={100}
          step={1}
          value={controls.cpu_percent}
          aria-valuetext={t("background.cpuValue", { percent: controls.cpu_percent })}
          onChange={(event) => onChange({ cpu_percent: Number(event.target.value) })}
        />
        <output htmlFor="adp-background-cpu">
          {t("background.cpuValue", { percent: controls.cpu_percent })}
        </output>
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
          value={cacheLimit}
          onChange={(event) =>
            onCacheLimitChange(Number(event.target.value) as CacheLimitMb)
          }
        >
          {CACHE_LIMITS_MB.map((mb) => (
            <option key={mb} value={mb}>
              {t("settings.cacheLimitOption", { size: mb })}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-background-ocr-language">
          {t("ocr.language")}
        </label>
        <select
          id="adp-background-ocr-language"
          className="adp-defaultapps-select"
          aria-label={t("ocr.language")}
          data-background-field="ocr.language"
          value={ocrLanguage}
          onChange={(event) => onOcrLanguageChange(event.target.value)}
        >
          <option value="auto">{t("ocr.automatic")}</option>
          {languages.map((language) => (
            <option key={language.tag} value={language.tag}>
              {language.name}
            </option>
          ))}
        </select>
      </div>
      <p className="adp-note">{t("ocr.languageHelp")}</p>
    </section>
  );
}

