/** Clock schedule and the runtime-only title-bar override (Step 10a).
 *
 * Windows and fixed local times only. Sunrise/sunset is deliberately absent:
 * it needs a separately approved location input and specification.
 */
import type { ThemeCustomSettings } from "../services/customThemes";
import {
  isValidSchedule,
  normalizeMinute,
  scheduleScheme,
  type ThemeScheme,
} from "./themeMath";

export { isValidSchedule, normalizeMinute, scheduleScheme };
export type { ThemeScheme };

export const DEFAULT_DAY_START_MINUTE = 420;
export const DEFAULT_NIGHT_START_MINUTE = 1140;

export interface ScheduleTick {
  minute: number;
  timeZone: string;
  dayStart: number;
  nightStart: number;
}

export interface ScheduleState {
  minute: number;
  timeZone: string;
  scheme: ThemeScheme;
  intervalKey: string;
  override: ThemeScheme | null;
  /** True exactly once after the local time zone changed. */
  timeZoneChanged: boolean;
}

export function localMinuteOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

/** The start of the interval the clock is in: day starts or night starts. */
export function intervalStart(minute: number, dayStart: number, nightStart: number): number {
  return scheduleScheme(minute, dayStart, nightStart) === "light" ? dayStart : nightStart;
}

export function intervalKey(minute: number, dayStart: number, nightStart: number): string {
  return `${scheduleScheme(minute, dayStart, nightStart)}:${intervalStart(minute, dayStart, nightStart)}`;
}

/** The next day/night boundary strictly after `minute`, wrapping midnight. */
export function nextTransitionMinute(minute: number, dayStart: number, nightStart: number): number {
  const current = normalizeMinute(minute);
  const forward = (start: number) => {
    const distance = (normalizeMinute(start) - current + 1440) % 1440;
    return distance === 0 ? 1440 : distance;
  };
  const dayDistance = forward(dayStart);
  const nightDistance = forward(nightStart);
  return normalizeMinute(current + Math.min(dayDistance, nightDistance));
}

export function createScheduleState(
  settings: ThemeCustomSettings,
  now: Date = new Date(),
  timeZone: string = currentTimeZone(),
): ScheduleState {
  const minute = localMinuteOf(now);
  return {
    minute,
    timeZone,
    scheme: scheduleScheme(minute, settings.day_start_minute, settings.night_start_minute),
    intervalKey: intervalKey(minute, settings.day_start_minute, settings.night_start_minute),
    override: null,
    timeZoneChanged: false,
  };
}

/** One clock/timer/visibility observation. Overrides end at a real switch. */
export function nextScheduleState(state: ScheduleState, tick: ScheduleTick): ScheduleState {
  const minute = normalizeMinute(tick.minute);
  const scheme = scheduleScheme(minute, tick.dayStart, tick.nightStart);
  const key = intervalKey(minute, tick.dayStart, tick.nightStart);
  const timeZoneChanged = state.timeZone !== tick.timeZone;
  const override = timeZoneChanged || key !== state.intervalKey ? null : state.override;
  return {
    minute,
    timeZone: tick.timeZone,
    scheme,
    intervalKey: key,
    override,
    timeZoneChanged,
  };
}

/** An override is displayed only while the schedule still matches it. */
export function overrideIsActive(state: ScheduleState): boolean {
  return state.override !== null;
}

/** Settings changed while a title-bar override is showing: keep it only if
 * the schedule itself did not move to another interval. */
export function rebaseScheduleState(state: ScheduleState, settings: ThemeCustomSettings): ScheduleState {
  const key = intervalKey(state.minute, settings.day_start_minute, settings.night_start_minute);
  return {
    ...state,
    scheme: scheduleScheme(state.minute, settings.day_start_minute, settings.night_start_minute),
    intervalKey: key,
    override: key === state.intervalKey ? state.override : null,
  };
}
