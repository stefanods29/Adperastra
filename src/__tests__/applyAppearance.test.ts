import { describe, expect, it } from "vitest";
import { applyAppearanceAttributes, applyThemeAttributes } from "../appearance/applyAppearance";
import { defaultSettings, type AppearanceSettings, type ThemeSettings } from "../services/settings";

const themeWith = (overrides: Partial<ThemeSettings>): ThemeSettings => ({ ...defaultSettings().theme, ...overrides });

const appearanceWith = (overrides: Partial<AppearanceSettings>): AppearanceSettings => ({
  ...defaultSettings().appearance,
  ...overrides,
});

const freshRoot = () => document.createElement("div");

describe("applyAppearance", () => {
  it("theme attributes follow the mode", () => {
    const dark = freshRoot();
    applyThemeAttributes(dark, themeWith({ mode: "dark", dark_theme: "highContrast" }), false);
    expect(dark.dataset.theme).toBe("highContrast");
    expect(dark.dataset.scheme).toBe("dark");

    const system = freshRoot();
    applyThemeAttributes(system, themeWith({ mode: "system", light_theme: "paper" }), false);
    expect(system.dataset.theme).toBe("paper");
    expect(system.dataset.scheme).toBe("light");
  });

  it("appearance attributes", () => {
    const root = freshRoot();
    applyAppearanceAttributes(
      root,
      appearanceWith({ density: "compact", corner_radius: "round", animations: "off" }),
    );
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.radius).toBe("round");
    expect(root.dataset.motion).toBe("off");
  });
});
