import { describe, expect, it } from "vitest";
import { clampColumnWidth, defaultSettings, normalizeSettings } from "../services/settings";

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
      theme: {
        mode: "dark",
        accent_source: "custom",
        accent_custom: "#0067C0",
        light_theme: "light",
        dark_theme: "dark",
      },
      explorer: defaultSettings().explorer,
      files: defaultSettings().files,
      open: defaultSettings().open,
      layout: defaultSettings().layout,
      appearance: defaultSettings().appearance,
      versions: defaultSettings().versions,
      templates: defaultSettings().templates,
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
      view_mode_order: ["extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content", "columns"],
      hidden_view_modes: [],
      column_width: 240,
      column_preview: true,
    });
    expect(normalizeSettings({ explorer: { group_by: "type" } }).explorer.group_by).toBe("type");
    expect(defaultSettings().schema_version).toBe(11);
    expect(defaultSettings().versions).toEqual({ enabled: true, keep_days: 30, max_mb: 1024 });
    expect(defaultSettings().templates).toEqual({ my_folder: "" });
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
    const order = ["extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content", "columns"];
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
      "columns",
    ]);
    expect(explorer({ view_mode_order: "nope" }).view_mode_order).toEqual(order);
    expect(explorer({ remember_view_per_folder: false }).remember_view_per_folder).toBe(false);
    expect(explorer({ remember_view_per_folder: "no" }).remember_view_per_folder).toBe(true);
  });

  it("normalizes the Column view settings (schema 7)", () => {
    const explorer = (input: Record<string, unknown>) => normalizeSettings({ explorer: input }).explorer;
    expect(explorer({})).toMatchObject({ column_width: 240, column_preview: true });
    expect(explorer({ column_width: 300 }).column_width).toBe(300);
    expect(explorer({ column_width: 100 }).column_width).toBe(160);
    expect(explorer({ column_width: 999 }).column_width).toBe(480);
    expect(explorer({ column_width: 241.6 }).column_width).toBe(242);
    expect(explorer({ column_width: "wide" }).column_width).toBe(240);
    expect(explorer({ column_width: Number.POSITIVE_INFINITY }).column_width).toBe(240);
    expect(explorer({ column_preview: false }).column_preview).toBe(false);
    expect(explorer({ column_preview: "no" }).column_preview).toBe(true);
    expect(explorer({ view_mode: "columns" }).view_mode).toBe("columns");
    expect(explorer({ hidden_view_modes: ["columns"] }).hidden_view_modes).toEqual(["columns"]);
    const eight = ["extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content"];
    expect(explorer({ view_mode_order: eight }).view_mode_order).toEqual([...eight, "columns"]);
  });

  it("normalizes the layout section (schema 8)", () => {
    const layout = (input: Record<string, unknown>) => normalizeSettings({ layout: input }).layout;
    const defaults = defaultSettings().layout;
    expect(defaults).toEqual({
      toolbar_position: "top",
      toolbar_mode: "full",
      tab_bar_position: "top",
      tab_bar_collapsed: false,
      nav_pane_position: "left",
      details_pane_position: "right",
      saved_presets: [],
    });
    expect(layout({})).toEqual(defaults);
    expect(layout({ toolbar_position: "left" }).toolbar_position).toBe("left");
    expect(layout({ toolbar_position: "middle" }).toolbar_position).toBe("top");
    expect(layout({ toolbar_mode: "iconsOnly" }).toolbar_mode).toBe("iconsOnly");
    expect(layout({ toolbar_mode: "tiny" }).toolbar_mode).toBe("full");
    expect(
      layout({ tab_bar_position: "bottom", nav_pane_position: "hidden", details_pane_position: "bottom" }),
    ).toMatchObject({ tab_bar_position: "bottom", nav_pane_position: "hidden", details_pane_position: "bottom" });
    expect(layout({ details_pane_position: "hidden" }).details_pane_position).toBe("right");
    expect(layout({ tab_bar_collapsed: "yes" }).tab_bar_collapsed).toBe(false);
    const kept = layout({
      saved_presets: [
        { name: "  Work ", toolbar_position: "left" },
        { name: "" },
        { name: "work" },
        "x",
        { name: "a".repeat(70) },
      ],
    });
    expect(kept.saved_presets).toEqual([
      {
        name: "Work",
        toolbar_position: "left",
        toolbar_mode: "full",
        tab_bar_position: "top",
        tab_bar_collapsed: false,
        nav_pane_position: "left",
        details_pane_position: "right",
      },
      {
        name: "a".repeat(60),
        toolbar_position: "top",
        toolbar_mode: "full",
        tab_bar_position: "top",
        tab_bar_collapsed: false,
        nav_pane_position: "left",
        details_pane_position: "right",
      },
    ]);
    const many = Array.from({ length: 25 }, (_, index) => ({ name: `p${index}` }));
    expect(layout({ saved_presets: many }).saved_presets.map((preset) => preset.name)).toEqual(
      Array.from({ length: 20 }, (_, index) => `p${index}`),
    );
    expect(layout({ saved_presets: "nope" }).saved_presets).toEqual([]);
  });

  it("normalizes the theme choice and appearance (schema 9)", () => {
    const theme = (input: Record<string, unknown>) => normalizeSettings({ theme: input }).theme;
    const appearance = (input: Record<string, unknown>) => normalizeSettings({ appearance: input }).appearance;
    expect(theme({})).toMatchObject({ light_theme: "light", dark_theme: "dark" });
    expect(theme({ light_theme: "paper", dark_theme: "amoled" })).toMatchObject({
      light_theme: "paper",
      dark_theme: "amoled",
    });
    expect(theme({ light_theme: "dark", dark_theme: "bright" })).toMatchObject({
      light_theme: "light",
      dark_theme: "dark",
    });
    expect(appearance({})).toEqual({
      ui_scale: 100,
      density: "comfortable",
      corner_radius: "standard",
      animations: "full",
    });
    expect(appearance({ ui_scale: 125 }).ui_scale).toBe(125);
    expect(appearance({ ui_scale: 80 }).ui_scale).toBe(100);
    expect(appearance({ ui_scale: "100" }).ui_scale).toBe(100);
    expect(appearance({ density: "spacious" }).density).toBe("spacious");
    expect(appearance({ density: "huge" }).density).toBe("comfortable");
    expect(appearance({ corner_radius: "round" }).corner_radius).toBe("round");
    expect(appearance({ animations: "off" }).animations).toBe("off");
    expect(appearance({ animations: "none" }).animations).toBe("full");
  });

  it("normalizes the version settings (schema 10)", () => {
    const versions = (input: Record<string, unknown>) => normalizeSettings({ versions: input }).versions;
    expect(versions({})).toEqual({ enabled: true, keep_days: 30, max_mb: 1024 });
    expect(versions({ enabled: false }).enabled).toBe(false);
    expect(versions({ enabled: "no" }).enabled).toBe(true);
    expect(versions({ keep_days: 90 }).keep_days).toBe(90);
    expect(versions({ keep_days: 14 }).keep_days).toBe(30);
    expect(versions({ max_mb: 256 }).max_mb).toBe(256);
    expect(versions({ max_mb: 3000 }).max_mb).toBe(1024);
  });

  it("normalizes the templates folder (schema 11)", () => {
    const folder = (input: Record<string, unknown>) => normalizeSettings({ templates: input }).templates.my_folder;
    expect(folder({})).toBe("");
    expect(folder({ my_folder: "C:\\T" })).toBe("C:\\T");
    expect(folder({ my_folder: "\\\\srv\\share\\T" })).toBe("\\\\srv\\share\\T");
    expect(folder({ my_folder: "relative" })).toBe("");
    expect(folder({ my_folder: 5 })).toBe("");
  });

  it("clampColumnWidth rounds and keeps the limits", () => {
    expect(clampColumnWidth(159.4)).toBe(160);
    expect(clampColumnWidth(300.4)).toBe(300);
    expect(clampColumnWidth(480.5)).toBe(480);
    expect(clampColumnWidth(-5)).toBe(160);
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