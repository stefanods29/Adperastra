import { describe, expect, it } from "vitest";
import dark from "../../themes/dark.tokens.json";
import light from "../../themes/light.tokens.json";
import {
  canAddTheme,
  createCustomTheme,
  MAX_THEMES,
  normalizeCustomTheme,
  normalizeThemeCustom,
  themeCustomFromLegacy,
  themeStyleCss,
  type CustomTheme,
} from "../services/customThemes";
import { defaultSettings, type ThemeSettings } from "../services/settings";
import {
  defaultThemeTokens,
  flattenThemeTokens,
  THEME_TOKEN_PATHS,
} from "../appearance/themeTokens";

const ID = "11111111-1111-4111-8111-111111111111";

const themeWith = (overrides: Partial<ThemeSettings>): ThemeSettings => ({
  ...defaultSettings().theme,
  ...overrides,
});

function draft(overrides: Partial<CustomTheme> = {}): CustomTheme {
  return { ...createCustomTheme("Example", "light", ID), ...overrides };
}

describe("custom theme data", () => {
  it("legacy_day_night_refs_preserved", () => {
    const migrated = themeCustomFromLegacy(
      themeWith({ mode: "dark", light_theme: "paper", dark_theme: "amoled" }),
    );
    expect(migrated.day).toEqual({ kind: "builtin", id: "paper" });
    expect(migrated.night).toEqual({ kind: "builtin", id: "amoled" });
    expect(migrated.mode).toBe("manual");
    expect(migrated.manual_scheme).toBe("dark");

    const system = themeCustomFromLegacy(
      themeWith({ mode: "system", light_theme: "bright", dark_theme: "highContrast" }),
    );
    expect(system.mode).toBe("windows");
    expect(system.day).toEqual({ kind: "builtin", id: "bright" });
    expect(system.night).toEqual({ kind: "builtin", id: "highContrast" });
  });

  it("normalizes a theme_custom section without asking the disk", () => {
    const normalized = normalizeThemeCustom(
      {
        mode: "clock",
        day_start_minute: 500,
        night_start_minute: 500,
        type_accents: { explorer: "#112233", nope: "#445566" },
      },
      themeWith({ light_theme: "paper", dark_theme: "amoled" }),
    );
    expect(normalized.day).toEqual({ kind: "builtin", id: "paper" });
    expect(normalized.night).toEqual({ kind: "builtin", id: "amoled" });
    expect(normalized.day_start_minute).toBe(500);
    expect(normalized.night_start_minute).not.toBe(500);
    expect(normalized.type_accents).toEqual({ explorer: "#112233" });
  });

  it("unknown_token_rejected", () => {
    const value = draft({ tokens: { ...defaultThemeTokens("light"), "color.nope": "#FFFFFF" } });
    expect(normalizeCustomTheme(value)).toBeNull();
  });

  it("a complete built-in snapshot is accepted", () => {
    expect(normalizeCustomTheme(draft())).not.toBeNull();
    expect(Object.keys(defaultThemeTokens("light")).length).toBeGreaterThan(40);
  });

  it("url_style_rejected", () => {
    const value = draft({
      styles: [
        {
          selector: ".adp-window{background:url(https://example.com/x)}" as never,
          property: "border-radius",
          value: 8,
          unit: "px",
        },
      ],
    });
    expect(normalizeCustomTheme(value)).toBeNull();
    expect(themeStyleCss(draft())).toBe("");
    const trusted = draft({
      styles: [{ selector: ".adp-window", property: "border-radius", value: 8, unit: "px" }],
    });
    expect(themeStyleCss(trusted)).toBe(".adp-window{border-radius:8px;}");
  });

  it("style values stay inside the whitelist bounds", () => {
    for (const [property, value] of [
      ["border-radius", 17],
      ["padding-inline", 25],
      ["letter-spacing", 3],
      ["line-height", 0.5],
    ] as const) {
      const unit = property === "line-height" ? "ratio" : "px";
      const candidate = draft({
        styles: [{ selector: ".adp-tab", property, value, unit }],
      });
      expect(normalizeCustomTheme(candidate), property).toBeNull();
    }
  });

  it("one_hundred_first_theme_refused", () => {
    expect(MAX_THEMES).toBe(100);
    expect(canAddTheme(99)).toBe(true);
    expect(canAddTheme(100)).toBe(false);
    expect(canAddTheme(101)).toBe(false);
  });

  it("every editable theme-file field is documented", () => {
    for (const tree of [light, dark]) {
      const leaves = flattenThemeTokens(tree as Record<string, unknown>);
      for (const path of leaves.keys()) {
        if (path === "font.family" || path.startsWith("shadow.")) continue;
        expect(THEME_TOKEN_PATHS, path).toContain(path);
      }
    }
  });

  it("numeric tokens use the documented bounds", () => {
    const value = draft({ tokens: { ...defaultThemeTokens("light"), "font.size.body": 7 } });
    expect(normalizeCustomTheme(value)).toBeNull();
    const tooLarge = draft({ tokens: { ...defaultThemeTokens("light"), "radius.md": 33 } });
    expect(normalizeCustomTheme(tooLarge)).toBeNull();
  });
});
