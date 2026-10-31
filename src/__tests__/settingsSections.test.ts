import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { defaultSettings, type AppSettings } from "../services/settings";
import {
  SETTINGS_SECTIONS,
  plainSearchText,
  resetAllSettings,
  resetSection,
  sectionMatches,
  type SettingsSectionId,
} from "../views/settings/sections";

const t = (key: string) => i18n.t(key) as string;

const section = (id: SettingsSectionId) => SETTINGS_SECTIONS.find((entry) => entry.id === id)!;

/** The settings the reset tests start from: every section changed. */
function changedSettings(): AppSettings {
  const settings = defaultSettings();
  return {
    ...settings,
    language: "es",
    files: { ...settings.files, paste_image_format: "jpg" },
    appearance: { ...settings.appearance, density: "compact" },
    layout: {
      ...settings.layout,
      toolbar_position: "left",
      saved_presets: [
        {
          name: "Mine",
          toolbar_position: "left",
          toolbar_mode: "full",
          tab_bar_position: "top",
          tab_bar_collapsed: false,
          nav_pane_position: "left",
          details_pane_position: "right",
        },
      ],
    },
    explorer: { ...settings.explorer, view_mode: "tiles", show_hidden: true },
  };
}

describe("settings sections", () => {
  it("plainSearchText ignores case and accents", () => {
    expect(plainSearchText("  Apariéncia ")).toBe("apariencia");
  });

  it("sectionMatches looks at titles and labels", () => {
    expect(sectionMatches(section("appearance"), "density", t)).toBe(true);
    expect(sectionMatches(section("appearance"), "DENS", t)).toBe(true);
    expect(sectionMatches(section("theme"), "amoled", t)).toBe(true);
    expect(sectionMatches(section("layout"), "density", t)).toBe(false);
    expect(sectionMatches(section("views"), "", t)).toBe(true);
  });

  it("resetSection touches only its section", () => {
    const settings = changedSettings();

    const general = resetSection("general", settings);
    expect(general.files.paste_image_format).toBe("png");
    expect(general.language).toBe("es");

    const appearance = resetSection("appearance", settings);
    expect(appearance.appearance.density).toBe("comfortable");
    expect(appearance.layout.toolbar_position).toBe("left");

    const layout = resetSection("layout", settings);
    expect(layout.layout.toolbar_position).toBe("top");
    expect(layout.layout.saved_presets).toEqual(settings.layout.saved_presets);

    const views = resetSection("views", settings);
    expect(views.explorer.view_mode).toBe("details");
    expect(views.explorer.show_hidden).toBe(true);
  });

  it("resetAllSettings keeps the language and the saved presets", () => {
    const settings = changedSettings();
    const reset = resetAllSettings(settings);
    expect(reset).toEqual({
      ...defaultSettings(),
      language: "es",
      layout: { ...defaultSettings().layout, saved_presets: settings.layout.saved_presets },
    });
  });
});
