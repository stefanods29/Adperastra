import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeSettings } from "../services/settings";

describe("normalizeSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
    expect(normalizeSettings("nope")).toEqual(defaultSettings());
    expect(normalizeSettings(42)).toEqual(defaultSettings());
  });

  it("keeps valid values", () => {
    expect(
      normalizeSettings({
        schema_version: 1,
        language: "es",
        theme: { mode: "dark", accent_source: "custom", accent_custom: "#0067C0" },
      }),
    ).toEqual({
      schema_version: 1,
      language: "es",
      theme: { mode: "dark", accent_source: "custom", accent_custom: "#0067C0" },
      explorer: defaultSettings().explorer,
      files: defaultSettings().files,
      open: defaultSettings().open,
    });
  });

  it("keeps valid Explorer view options and repairs invalid ones", () => {
    const result = normalizeSettings({
      explorer: { show_hidden: true, show_extensions: false, item_checkboxes: "yes", group_by: "colour" },
    });
    expect(result.explorer).toEqual({
      show_hidden: true,
      show_extensions: false,
      item_checkboxes: false,
      details_pane: false,
      group_by: "none",
      view_mode: "details",
      remember_view_per_folder: true,
      view_mode_order: ["extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content"],
      hidden_view_modes: [],
    });
    expect(normalizeSettings({ explorer: { group_by: "type" } }).explorer.group_by).toBe("type");
    expect(defaultSettings().schema_version).toBe(6);
    expect(defaultSettings().files.paste_image_format).toBe("png");
    expect(normalizeSettings({ files: { paste_image_format: "jpg" } }).files.paste_image_format).toBe("jpg");
    expect(normalizeSettings({ files: { paste_image_format: "gif" } }).files.paste_image_format).toBe("png");
  });

  it("keeps valid opening-file choices and drops invalid ones", () => {
    expect(defaultSettings().open).toEqual({ protected_view: true, open_with: {} });
    const result = normalizeSettings({
      open: { protected_view: false, open_with: { txt: "windows", md: "builtin", MP4: "windows", "a.b": "windows", png: "paint" } },
    });
    expect(result.open).toEqual({ protected_view: false, open_with: { txt: "windows", md: "builtin" } });
    expect(normalizeSettings({ open: { protected_view: "no", open_with: [] } }).open).toEqual(defaultSettings().open);
    const many: Record<string, string> = {};
    for (let n = 0; n < 600; n += 1) many[`x${n}`] = "windows";
    expect(Object.keys(normalizeSettings({ open: { open_with: many } }).open.open_with)).toHaveLength(500);
  });

  it("normalizes the view settings (schema 6)", () => {
    const order = ["extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content"];
    const explorer = (input: Record<string, unknown>) => normalizeSettings({ explorer: input }).explorer;
    expect(explorer({})).toMatchObject({
      view_mode: "details",
      remember_view_per_folder: true,
      view_mode_order: order,
      hidden_view_modes: [],
    });
    expect(explorer({ view_mode: "tiles" }).view_mode).toBe("tiles");
    expect(explorer({ view_mode: "huge" }).view_mode).toBe("details");
    expect(explorer({ view_mode: "tiles", hidden_view_modes: ["tiles"] })).toMatchObject({
      view_mode: "details",
      hidden_view_modes: ["tiles"],
    });
    expect(explorer({ hidden_view_modes: ["details", "list", "list", "x"] }).hidden_view_modes).toEqual(["list"]);
    expect(explorer({ view_mode_order: ["content", "content", "bogus", "details"] }).view_mode_order).toEqual([
      "content",
      "details",
      "extraLargeIcons",
      "largeIcons",
      "mediumIcons",
      "smallIcons",
      "list",
      "tiles",
    ]);
    expect(explorer({ view_mode_order: "nope" }).view_mode_order).toEqual(order);
    expect(explorer({ remember_view_per_folder: false }).remember_view_per_folder).toBe(false);
    expect(explorer({ remember_view_per_folder: "no" }).remember_view_per_folder).toBe(true);
  });

  it("falls back per-field for invalid values", () => {
    const result = normalizeSettings({
      schema_version: -3,
      language: "fr",
      theme: { mode: "neon", accent_source: "rainbow", accent_custom: "blue" },
    });
    expect(result).toEqual(defaultSettings());
  });

  it("keeps valid fields while replacing only invalid ones", () => {
    const result = normalizeSettings({
      language: "es",
      theme: { mode: "light", accent_source: "bogus", accent_custom: "#ABC" },
    });
    expect(result.language).toBe("es");
    expect(result.schema_version).toBe(defaultSettings().schema_version);
    expect(result.theme.mode).toBe("light");
    expect(result.theme.accent_source).toBe("design");
    expect(result.theme.accent_custom).toBe("#ABC");
  });

  it("rejects malformed accent colors and theme shapes", () => {
    expect(normalizeSettings({ theme: { accent_custom: "#12345" } }).theme.accent_custom).toBeNull();
    expect(normalizeSettings({ theme: { accent_custom: 123 } }).theme.accent_custom).toBeNull();
    expect(normalizeSettings({ theme: "dark" }).theme).toEqual(defaultSettings().theme);
  });
});