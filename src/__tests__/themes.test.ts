import { describe, expect, it } from "vitest";
import amoled from "../../themes/amoled.tokens.json";
import bright from "../../themes/bright.tokens.json";
import dark from "../../themes/dark.tokens.json";
import highContrast from "../../themes/highContrast.tokens.json";
import light from "../../themes/light.tokens.json";
import paper from "../../themes/paper.tokens.json";
import { contrastRatio } from "../appearance/contrast";
import { THEMES, resolveThemeId, themeScheme } from "../appearance/themes";
import { defaultSettings, type ThemeSettings } from "../services/settings";

const themes = { light, bright, paper, dark, amoled, highContrast };

const themeWith = (overrides: Partial<ThemeSettings>): ThemeSettings => ({ ...defaultSettings().theme, ...overrides });

describe("contrastRatio", () => {
  it("contrastRatio follows WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
    const gray = contrastRatio("#777777", "#FFFFFF");
    expect(gray).toBeGreaterThan(4.47);
    expect(gray).toBeLessThan(4.49);
  });
});

describe("themes", () => {
  it("every theme is readable", () => {
    for (const [name, theme] of Object.entries(themes)) {
      expect(contrastRatio(theme.color.text.primary, theme.color.surface.window), `${name} primary`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.color.text.secondary, theme.color.surface.window), `${name} secondary`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.color.text.primary, theme.color.surface.selectedRow), `${name} selected row`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.color.text.onAccent, theme.color.accent.explorer), `${name} on the accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.color.accent.explorer, theme.color.surface.window), `${name} accent`).toBeGreaterThanOrEqual(3);
    }
  });

  it("high contrast is high", () => {
    expect(contrastRatio(highContrast.color.text.secondary, highContrast.color.surface.window)).toBeGreaterThanOrEqual(7);
  });

  it("resolveThemeId follows the mode", () => {
    expect(resolveThemeId(themeWith({ mode: "light", light_theme: "paper", dark_theme: "amoled" }), false)).toBe("paper");
    expect(resolveThemeId(themeWith({ mode: "light", light_theme: "paper", dark_theme: "amoled" }), true)).toBe("paper");
    expect(resolveThemeId(themeWith({ mode: "dark", light_theme: "paper", dark_theme: "amoled" }), false)).toBe("amoled");
    expect(resolveThemeId(themeWith({ mode: "system", light_theme: "paper", dark_theme: "amoled" }), true)).toBe("amoled");
    expect(resolveThemeId(themeWith({ mode: "system", light_theme: "paper", dark_theme: "amoled" }), false)).toBe("paper");
  });

  it("THEMES lists three themes per scheme", () => {
    expect(THEMES).toHaveLength(6);
    expect(THEMES.map((entry) => entry.id)).toEqual(["light", "bright", "paper", "dark", "amoled", "highContrast"]);
    expect(THEMES.filter((entry) => entry.scheme === "light")).toHaveLength(3);
    for (const entry of THEMES) {
      expect(themeScheme(entry.id)).toBe(entry.scheme);
    }
  });
});
