/** Settings > Day and night (Step 10a).
 *
 * Two appearances, three modes, and two distinct local start times. No
 * sunset calculation is offered because it would need the user's location.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Button from "../../components/Button";
import {
  isThemeRef,
  type CustomThemeSummary,
  type ThemeCustomSettings,
  type ThemeRef,
} from "../../services/customThemes";
import { THEMES } from "../../appearance/themes";
import { isValidSchedule } from "../../appearance/themeMath";
import type { ThemeId } from "../../services/settings";

export interface DayNightSettingsProps {
  value: ThemeCustomSettings;
  customThemes: readonly CustomThemeSummary[];
  onChange: (value: ThemeCustomSettings) => void;
  onOpenHelp: (slug: string) => void;
}

const MODES = [
  { id: "windows", labelKey: "themeSchedule.windows" },
  { id: "clock", labelKey: "themeSchedule.clock" },
  { id: "manual", labelKey: "themeSchedule.manual" },
] as const;

function refValue(ref: ThemeRef): string {
  return `${ref.kind}:${ref.id}`;
}

function parseRef(value: string, fallback: ThemeRef): ThemeRef {
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  if (kind === "custom") return { kind: "custom", id };
  if (kind === "builtin") return { kind: "builtin", id: id as ThemeId };
  return fallback;
}

function minuteToTime(minute: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export default function DayNightSettings({ value, customThemes, onChange, onOpenHelp }: DayNightSettingsProps) {
  const { t } = useTranslation();
  const [timeError, setTimeError] = useState(false);
  const valid = isValidSchedule(value.day_start_minute, value.night_start_minute);

  const chooseRef = (slot: "day" | "night", text: string) => {
    const current = value[slot];
    const next = parseRef(text, current);
    if (!isThemeRef(next)) return;
    onChange(slot === "day" ? { ...value, day: next } : { ...value, night: next });
  };

  const chooseTime = (slot: "day" | "night", minute: number) => {
    const other = slot === "day" ? value.night_start_minute : value.day_start_minute;
    if (minute === other) {
      setTimeError(true);
      return;
    }
    setTimeError(false);
    onChange(
      slot === "day"
        ? { ...value, day_start_minute: minute }
        : { ...value, night_start_minute: minute },
    );
  };

  const options = (current: ThemeRef) => (
    <>
      {THEMES.map((entry) => (
        <option key={`builtin:${entry.id}`} value={`builtin:${entry.id}`}>
          {t(entry.labelKey)}
        </option>
      ))}
      {customThemes.map((entry) => (
        <option key={`custom:${entry.id}`} value={`custom:${entry.id}`}>
          {entry.name}
        </option>
      ))}
      {current.kind === "custom" && !customThemes.some((entry) => entry.id === current.id) ? (
        <option value={refValue(current)}>{t("errors.theme.unavailable")}</option>
      ) : null}
    </>
  );

  return (
    <section className="adp-settings-section adp-theme-schedule" aria-labelledby="adp-theme-schedule-title">
      <div className="adp-view-header">
        <h3 id="adp-theme-schedule-title" className="adp-heading">
          {t("themeSchedule.title")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("day-and-night-themes")} />
      </div>

      <label className="adp-setting-row">
        <span className="adp-setting-label">{t("themeSchedule.day")}</span>
        <select
          className="adp-theme-select"
          value={refValue(value.day)}
          aria-label={t("themeSchedule.day")}
          onChange={(event) => chooseRef("day", event.target.value)}
        >
          {options(value.day)}
        </select>
      </label>
      <label className="adp-setting-row">
        <span className="adp-setting-label">{t("themeSchedule.night")}</span>
        <select
          className="adp-theme-select"
          value={refValue(value.night)}
          aria-label={t("themeSchedule.night")}
          onChange={(event) => chooseRef("night", event.target.value)}
        >
          {options(value.night)}
        </select>
      </label>

      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("themeSchedule.title")}</span>
        <div className="adp-button-row">
          {MODES.map((mode) => (
            <Button
              key={mode.id}
              variant={value.mode === mode.id ? "primary" : "default"}
              aria-pressed={value.mode === mode.id}
              onClick={() => onChange({ ...value, mode: mode.id })}
            >
              {t(mode.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {value.mode === "manual" ? (
        <div className="adp-setting-row">
          <span className="adp-setting-label">{t("themeSchedule.manual")}</span>
          <div className="adp-button-row">
            {(["light", "dark"] as const).map((scheme) => (
              <Button
                key={scheme}
                variant={value.manual_scheme === scheme ? "primary" : "default"}
                aria-pressed={value.manual_scheme === scheme}
                onClick={() => onChange({ ...value, manual_scheme: scheme })}
              >
                {t(scheme === "light" ? "settings.themeLight" : "settings.themeDark")}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="adp-theme-schedule-times">
        <label className="adp-theme-field">
          <span>{t("themeSchedule.dayStart")}</span>
          <input
            className="adp-input"
            type="time"
            value={minuteToTime(value.day_start_minute)}
            aria-label={t("themeSchedule.dayStart")}
            aria-invalid={!valid || timeError || undefined}
            onChange={(event) => {
              const minute = timeToMinute(event.target.value);
              if (minute !== null) chooseTime("day", minute);
            }}
          />
        </label>
        <label className="adp-theme-field">
          <span>{t("themeSchedule.nightStart")}</span>
          <input
            className="adp-input"
            type="time"
            value={minuteToTime(value.night_start_minute)}
            aria-label={t("themeSchedule.nightStart")}
            aria-invalid={!valid || timeError || undefined}
            onChange={(event) => {
              const minute = timeToMinute(event.target.value);
              if (minute !== null) chooseTime("night", minute);
            }}
          />
        </label>
      </div>

      {!valid || timeError ? (
        <p className="adp-note" role="alert">
          {t("errors.theme.invalid")}
        </p>
      ) : null}
      <p className="adp-note" role="note">
        {t("themeSchedule.sunUnavailable")}
      </p>
    </section>
  );
}
