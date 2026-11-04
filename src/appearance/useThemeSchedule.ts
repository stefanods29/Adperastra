/** Minute timer, resume and time-zone handling for day/night switching.
 *
 * A title-bar override is runtime state: it is never persisted and it ends at
 * the next actual schedule transition. Repeated ticks inside the same minute
 * or interval do not fire another switch.
 */
import { useEffect, useRef, useState } from "react";
import type { ThemeCustomSettings } from "../services/customThemes";
import {
  createScheduleState,
  currentTimeZone,
  localMinuteOf,
  nextScheduleState,
  rebaseScheduleState,
  type ScheduleState,
  type ThemeScheme,
} from "./themeSchedule";

export interface ThemeScheduleOptions {
  settings: ThemeCustomSettings;
  now?: () => Date;
  timeZone?: () => string;
  /** Test seam; production uses a 60 s interval. */
  intervalMs?: number;
}

export interface ThemeScheduleResult {
  scheme: ThemeScheme;
  minute: number;
  override: ThemeScheme | null;
  /** Shows the title-bar override until the next transition. */
  setOverride: (scheme: ThemeScheme | null) => void;
  state: ScheduleState;
}

export function useThemeSchedule(options: ThemeScheduleOptions): ThemeScheduleResult {
  const { settings, now = () => new Date(), timeZone = currentTimeZone, intervalMs = 60_000 } = options;
  const [state, setState] = useState<ScheduleState>(() => createScheduleState(settings, now(), timeZone()));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const nowRef = useRef(now);
  nowRef.current = now;
  const timeZoneRef = useRef(timeZone);
  timeZoneRef.current = timeZone;

  useEffect(() => {
    const tick = () => {
      const current = nowRef.current();
      setState((previous) =>
        nextScheduleState(previous, {
          minute: localMinuteOf(current),
          timeZone: timeZoneRef.current(),
          dayStart: settingsRef.current.day_start_minute,
          nightStart: settingsRef.current.night_start_minute,
        }),
      );
    };
    // Resolve the current interval immediately; covers opening the app after
    // it slept through one or more transitions.
    tick();
    const timer = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  useEffect(() => {
    setState((previous) => rebaseScheduleState(previous, settings));
  }, [settings.day_start_minute, settings.night_start_minute, settings.mode, settings.manual_scheme]);

  const setOverride = (scheme: ThemeScheme | null) => {
    setState((previous) => ({ ...previous, override: previous.override === scheme ? null : scheme }));
  };

  return {
    scheme: state.override ?? state.scheme,
    minute: state.minute,
    override: state.override,
    setOverride,
    state,
  };
}
