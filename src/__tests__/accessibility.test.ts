import { describe, expect, it } from "vitest";
import {
  defaultAccessibilitySettings,
  paletteForMode,
  resolveAccessibility,
  subtitleMeetsContrast,
  systemFromMedia,
  validateAccessibilitySettings,
  type SystemAccessibility,
} from "../services/accessibility";

const system = (patch: Partial<SystemAccessibility> = {}): SystemAccessibility => ({
  forced_colors: false,
  reduced_motion: false,
  text_scale: 1,
  double_click_ms: 500,
  generation: 7,
  ...patch,
});

describe("effective accessibility", () => {
  it("system forced motion wins over an off preference", () => {
    const settings = { ...defaultAccessibilitySettings(), reduced_motion: "off" as const };
    expect(resolveAccessibility(settings, 100, system({ reduced_motion: true })).reduce_motion).toBe(
      true,
    );
    expect(resolveAccessibility(settings, 100, system()).reduce_motion).toBe(false);
    const on = { ...defaultAccessibilitySettings(), reduced_motion: "on" as const };
    expect(resolveAccessibility(on, 100, system()).reduce_motion).toBe(true);
  });

  it("zoom is the larger request snapped once, never multiplied twice", () => {
    expect(resolveAccessibility(defaultAccessibilitySettings(), 200, system({ text_scale: 2 })).effective_zoom).toBe(200);
    expect(resolveAccessibility(defaultAccessibilitySettings(), 100, system({ text_scale: 3 })).effective_zoom).toBe(300);
    expect(resolveAccessibility(defaultAccessibilitySettings(), 300, system({ text_scale: 3 })).effective_zoom).toBe(300);
    expect(resolveAccessibility(defaultAccessibilitySettings(), 100, system({ text_scale: 1.5 })).effective_zoom).toBe(150);
  });

  it("legacy 200 percent zoom is unchanged without Windows scaling", () => {
    const effective = resolveAccessibility(defaultAccessibilitySettings(), 200, system());
    expect(effective.effective_zoom).toBe(200);
    expect(effective.target_px).toBe(24);
    expect(effective.generation).toBe(7);
  });

  it("rejects invalid spacings and values", () => {
    const base = defaultAccessibilitySettings();
    expect(() => validateAccessibilitySettings({ ...base, letter_spacing_em: 0.21 })).toThrow(
      "accessibility.invalid",
    );
    expect(() => validateAccessibilitySettings({ ...base, word_spacing_em: 0.51 })).toThrow(
      "accessibility.invalid",
    );
    expect(() => validateAccessibilitySettings({ ...base, line_height: 0.9 })).toThrow(
      "accessibility.invalid",
    );
    expect(() => validateAccessibilitySettings({ ...base, hover_ms: 100 })).toThrow(
      "accessibility.invalid",
    );
    expect(() => validateAccessibilitySettings({ ...base, focus_px: 5 })).toThrow(
      "accessibility.invalid",
    );
    expect(() =>
      validateAccessibilitySettings({
        ...base,
        subtitle: {
          ...base.subtitle,
          text_color: "#777777",
          background_color: "#888888",
          background_opacity: 1,
        },
      }),
    ).toThrow("accessibility.invalid");
    expect(() => resolveAccessibility(base, 225, system())).not.toThrow();
    expect(() => resolveAccessibility(base, 210, system())).toThrow("accessibility.invalid");
  });

  it("forced colors report system state and restore prior preferences untouched", () => {
    const settings = defaultAccessibilitySettings();
    const snapshot = JSON.parse(JSON.stringify(settings)) as unknown;
    const forced = resolveAccessibility(settings, 100, system({ forced_colors: true }));
    expect(forced.forced_colors).toBe(true);
    expect(forced.settings).toBe(settings);
    const restored = resolveAccessibility(settings, 100, system({ forced_colors: false }));
    expect(restored.forced_colors).toBe(false);
    expect(settings).toEqual(snapshot);
  });

  it("media signals coalesce without rewriting the native snapshot", () => {
    const base = system();
    const merged = systemFromMedia(base, { forcedColors: true, reducedMotion: false });
    expect(merged.forced_colors).toBe(true);
    expect(merged.reduced_motion).toBe(false);
    expect(merged.generation).toBe(base.generation + 1);
    expect(base.forced_colors).toBe(false);
  });

  it("palette orders follow D4 and subtitles need 4.5 contrast", () => {
    expect(paletteForMode("none")[0]).toBe("#E69F00");
    expect(paletteForMode("protanopia")).toEqual([
      "#0072B2",
      "#56B4E9",
      "#009E73",
      "#D55E00",
      "#CC79A7",
      "#E69F00",
      "#F0E442",
      "#000000",
    ]);
    expect(paletteForMode("tritanopia")[0]).toBe("#D55E00");
    expect(subtitleMeetsContrast(defaultAccessibilitySettings().subtitle)).toBe(true);
    expect(
      subtitleMeetsContrast({
        ...defaultAccessibilitySettings().subtitle,
        text_color: "#777777",
        background_color: "#888888",
      }),
    ).toBe(false);
  });
});
