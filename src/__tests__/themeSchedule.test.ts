import { describe, expect, it } from "vitest";
import { defaultThemeCustomSettings } from "../services/customThemes";
import {
  createScheduleState,
  isValidSchedule,
  nextScheduleState,
  nextTransitionMinute,
  scheduleScheme,
} from "../appearance/themeSchedule";

const settings = (overrides = {}) => ({ ...defaultThemeCustomSettings(), ...overrides });

describe("clock schedule", () => {
  it("419 is night, 420 day, 1139 day, 1140 night", () => {
    expect(scheduleScheme(419, 420, 1140)).toBe("dark");
    expect(scheduleScheme(420, 420, 1140)).toBe("light");
    expect(scheduleScheme(1139, 420, 1140)).toBe("light");
    expect(scheduleScheme(1140, 420, 1140)).toBe("dark");
  });

  it("wraps midnight when day starts at 1200 and night at 360", () => {
    expect(scheduleScheme(0, 1200, 360)).toBe("light");
    expect(scheduleScheme(359, 1200, 360)).toBe("light");
    expect(scheduleScheme(360, 1200, 360)).toBe("dark");
    expect(scheduleScheme(1199, 1200, 360)).toBe("dark");
    expect(scheduleScheme(1200, 1200, 360)).toBe("light");
  });

  it("equal starts are rejected and the next transition wraps", () => {
    expect(isValidSchedule(420, 420)).toBe(false);
    expect(isValidSchedule(0, 1439)).toBe(true);
    expect(nextTransitionMinute(1139, 420, 1140)).toBe(1140);
    expect(nextTransitionMinute(1140, 420, 1140)).toBe(420);
    expect(nextTransitionMinute(0, 1200, 360)).toBe(360);
  });
});

describe("runtime override", () => {
  it("resets at the next actual transition, not at the same minute", () => {
    const base = createScheduleState(settings(), new Date(2026, 0, 1, 18, 58), "UTC");
    const withOverride = { ...base, override: "light" as const };
    const stillDay = nextScheduleState(withOverride, {
      minute: 1139,
      timeZone: "UTC",
      dayStart: 420,
      nightStart: 1140,
    });
    expect(stillDay.override).toBe("light");
    const switched = nextScheduleState(stillDay, {
      minute: 1140,
      timeZone: "UTC",
      dayStart: 420,
      nightStart: 1140,
    });
    expect(switched.override).toBeNull();
    expect(switched.scheme).toBe("dark");
  });

  it("timezone change resolves once", () => {
    const state = createScheduleState(settings(), new Date(2026, 0, 1, 8, 0), "Europe/Madrid");
    const changed = nextScheduleState(state, {
      minute: 480,
      timeZone: "America/New_York",
      dayStart: 420,
      nightStart: 1140,
    });
    expect(changed.timeZoneChanged).toBe(true);
    const repeated = nextScheduleState(changed, {
      minute: 481,
      timeZone: "America/New_York",
      dayStart: 420,
      nightStart: 1140,
    });
    expect(repeated.timeZoneChanged).toBe(false);
  });

  it("an override chosen on the same interval survives ordinary ticks", () => {
    const state = { ...createScheduleState(settings(), new Date(2026, 0, 1, 9, 0), "UTC"), override: "dark" as const };
    const ticked = nextScheduleState(state, {
      minute: 901,
      timeZone: "UTC",
      dayStart: 420,
      nightStart: 1140,
    });
    expect(ticked.override).toBe("dark");
    expect(ticked.scheme).toBe("light");
  });
});
