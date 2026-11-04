import { describe, expect, it } from "vitest";
import {
  SETTINGS_SCHEMA_VERSION,
  clampColumnWidth,
  defaultSettings,
  normalizeSettings,
} from "../services/settings";

describe("normalizeSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
    expect(normalizeSettings("nope")).toEqual(defaultSettings());
    expect(normalizeSettings(42)).toEqual(defaultSettings());
  });

  it("keeps valid values", () => {
    const defaults = defaultSettings();
    expect(
      normalizeSettings({
        schema_version: 1,
        language: "es",
        theme: { mode: "dark", accent_source: "custom", accent_custom: "#0067C0" },
      }),
    ).toEqual({
      ...defaults,
      language: "es",
      theme: {
        ...defaults.theme,
        mode: "dark",
        accent_source: "custom",
        accent_custom: "#0067C0",
      },
      format_options: { ...defaults.format_options, size_base: "legacy" },
      theme_custom: { ...defaults.theme_custom, mode: "manual", manual_scheme: "dark" },
      ai_actions: { ...defaults.ai_actions, dictation_language: "es" },
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
      folder_backgrounds: false,
      column_sets_enabled: false,
    });
    expect(normalizeSettings({ explorer: { group_by: "type" } }).explorer.group_by).toBe("type");
    expect(defaultSettings().schema_version).toBe(SETTINGS_SCHEMA_VERSION);
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
      theme: { mode: "light", accent_source: "bogus", accent_custom: "#AABBCC" },
    });
    expect(result.language).toBe("es");
    expect(result.schema_version).toBe(defaultSettings().schema_version);
    expect(result.theme.mode).toBe("light");
    expect(result.theme.accent_source).toBe("design");
    expect(result.theme.accent_custom).toBe("#AABBCC");
  });

  it("rejects malformed accent colors and theme shapes", () => {
    expect(normalizeSettings({ theme: { accent_custom: "#12345" } }).theme.accent_custom).toBe("#0067C0");
    expect(normalizeSettings({ theme: { accent_custom: "#ABC" } }).theme.accent_custom).toBe("#0067C0");
    expect(normalizeSettings({ theme: { accent_custom: 123 } }).theme.accent_custom).toBe("#0067C0");
    expect(normalizeSettings({ theme: "dark" }).theme).toEqual(defaultSettings().theme);
  });

  it("normalizes schemas 17-27 (conversion through locked folders)", () => {
    const result = normalizeSettings({
      schema_version: 16,
      conversion: {
        default_destination: "ask",
        default_quality: 150,
        concurrent_jobs: 1,
        last_preset: "00000000-0000-4000-8000-000000000001",
        prompt_for_losses: false,
      },
      privacy: {
        mode: "remove",
        image_mode: "ask",
        image_categories: ["gps", "gps", "unknown"],
      },
      updates: { enabled: true, last_seen_version: "0.1.0", last_check_unix: 10 },
      startup: { mode: "restore", folder: "relative\\folder", stay_in_background: true, start_with_windows: true },
      tabs: { drag_hover_ms: 2000 },
      palette: { recent_ids: ["a", "a", ""], show_disabled: false },
      transfers: { verify_copies: true, queue_per_volume: false, max_parallel: 9 },
      shelf: { visible: true, side: "left", size: 900 },
      recovery: { enabled: false, interval_seconds: 5, max_mib: 64 },
      clipboard_history: { enabled: false, max_items: 5, max_mib: 200 },
      locked: { auto_lock_minutes: 2, lock_on_workstation: false },
    });
    expect(result.schema_version).toBe(SETTINGS_SCHEMA_VERSION);
    expect(result.conversion).toEqual({
      default_destination: "ask",
      default_quality: 100,
      preserve_metadata: true,
      concurrent_jobs: 1,
      last_preset: "00000000-0000-4000-8000-000000000001",
      prompt_for_losses: true,
    });
    expect(normalizeSettings({ conversion: { concurrent_jobs: 9 } }).conversion.concurrent_jobs).toBe(2);
    expect(normalizeSettings({ conversion: {} }).conversion.concurrent_jobs).toBe(2);
    expect(result.privacy.image_categories).toEqual(["gps"]);
    expect(result.privacy.image_mode).toBe("ask");
    expect(result.updates).toEqual({ enabled: true, last_seen_version: "0.1.0", last_check_unix: 10 });
    expect(result.startup).toEqual({
      mode: "restore",
      folder: "",
      stay_in_background: true,
      start_with_windows: true,
    });
    expect(result.tabs.drag_hover_ms).toBe(2000);
    expect(result.palette.recent_ids).toEqual(["a"]);
    expect(result.palette.show_disabled).toBe(false);
    expect(result.transfers).toEqual({ verify_copies: true, queue_per_volume: true, max_parallel: 2 });
    expect(result.shelf).toEqual({ visible: true, side: "left", size: 600 });
    expect(result.recovery).toEqual({
      enabled: false,
      interval_seconds: 10,
      max_mib: 1024,
      diagnostics_include_dumps: false,
    });
    expect(result.clipboard_history).toEqual({
      enabled: false,
      capture_windows: false,
      persist: false,
      max_items: 100,
      max_mib: 64,
    });
    expect(result.locked).toEqual({ auto_lock_minutes: 5, lock_on_workstation: false });
  });

  it("normalizes schemas 28-35 (themes through views)", () => {
    const defaults = defaultSettings();
    const result = normalizeSettings({
      schema_version: 27,
      theme: { mode: "dark", light_theme: "paper", dark_theme: "amoled" },
      theme_custom: {
        day: { kind: "builtin", id: "paper" },
        night: { kind: "builtin", id: "amoled" },
        mode: "manual",
        manual_scheme: "dark",
      },
      toolbar_custom: { classic_menu: false, bars: [], quick_access: ["explorer.undo"] },
      keyboard_custom: { active_map: "builtin:windows", custom_maps: [], allow_bare_navigation: true },
      tab_options: { title_limit: 11, width_mode: "bogus" },
      format_options: { decimals: 5, size_base: "legacy" },
      behavior: { open_click: "single" },
      shell_custom: {},
      accessibility: defaults.accessibility,
      search: { index_limit_mb: 300, content_max_chars: 10 },
      views: { date_source: "created", enabled_views: { map: true } },
    });
    expect(result.theme_custom.day).toEqual({ kind: "builtin", id: "paper" });
    expect(result.theme_custom.night).toEqual({ kind: "builtin", id: "amoled" });
    expect(result.theme_custom.manual_scheme).toBe("dark");
    expect(result.toolbar_custom.quick_access).toEqual(["explorer.undo"]);
    expect(result.keyboard_custom.allow_bare_navigation).toBe(true);
    expect(result.tab_options.title_limit).toBe(40);
    expect(result.tab_options.width_mode).toBe("fixed");
    expect(result.format_options.decimals).toBe(1);
    expect(result.format_options.size_base).toBe("legacy");
    expect(result.behavior.open_click).toBe("single");
    expect(result.shell_custom).toEqual(defaults.shell_custom);
    expect(result.accessibility).toEqual(defaults.accessibility);
    expect(result.search.index_limit_mb).toBe(2048);
    expect(result.search.content_max_chars).toBe(100_000);
    expect(result.views.date_source).toBe("created");
    expect(result.views.enabled_views.map).toBe(true);
  });

  it("normalizes schemas 36-42 (folder sizes through media)", () => {
    const result = normalizeSettings({
      schema_version: 41,
      folder_sizes: { enabled: true, network: true, details: true },
      pack_catalog: { last_checked_unix: 1_700_000_000 },
      office_view: { prefer_accurate: false, show_comments: true, keep_engine_warm: false, idle_seconds: 30 },
      pdf_tools: { author: "Ana\u0000 Pérez" },
      image_editor: {
        default_mode: "draw",
        background_rgba: [1, 2, 3, 4],
        history_limit_mb: 32,
        advanced: true,
        selection_tolerance: 150,
        show_history: true,
      },
      local_ai: { enabled: true, device: "cpu", idle_unload_seconds: 5, memory_limit_mb: 100 },
      media_editor: { preview_quality: "480", waveform: false, keep_pitch: false },
    });
    expect(result.folder_sizes).toEqual({ enabled: true, network: true, details: true });
    expect(result.pack_catalog.last_checked_unix).toBe(1_700_000_000);
    expect(result.office_view).toEqual({
      prefer_accurate: false,
      show_comments: true,
      keep_engine_warm: false,
      idle_seconds: 60,
    });
    expect(result.pdf_tools.author).toBe("Ana Pérez");
    expect(result.image_editor).toMatchObject({
      default_mode: "draw",
      background_rgba: [1, 2, 3, 4],
      history_limit_mb: 64,
      advanced: true,
      selection_tolerance: 100,
      show_history: true,
    });
    expect(result.local_ai.enabled).toBe(true);
    expect(result.local_ai.device).toBe("cpu");
    expect(result.local_ai.idle_unload_seconds).toBe(30);
    expect(result.local_ai.memory_limit_mb).toBe(512);
    expect(result.media_editor).toEqual({ preview_quality: "960", waveform: false, keep_pitch: false });
  });

  it("normalizes schemas 44-56 (assistant through decks)", () => {
    const result = normalizeSettings({
      schema_version: 55,
      assistant: { enabled: true, local_server_port: 80 },
      ai_actions: { caption_window_seconds: 10, dictation_language: "es" },
      ai_search: { semantic_text: true },
      ai: {
        writing: { inline_enabled: true, enabled_types: { text: true } },
        documents: { enabled: true, experimental_actions: ["rewrite", "rewrite", "delete"] },
        sheets: { enabled: true, experimental_actions: ["formula", "formula", "delete"] },
        decks: { enabled: true, experimental_actions: ["create", "delete"] },
      },
      timeline: { preview_quality: "1024", snap_enabled: false },
      office_edit: { enabled: true, autosave_default: true, idle_minutes: 99 },
      document_editor: { autosave_default: true, show_ruler: false },
      sheet_editor: { show_formula_bar: false, default_zoom: 500 },
      deck_editor: { show_notes: false, default_aspect: "4:3", presenter_view: false },
    });
    expect(result.assistant.enabled).toBe(true);
    expect(result.assistant.local_server_port).toBe(1024);
    expect(result.ai_actions.caption_window_seconds).toBe(30);
    expect(result.ai_actions.dictation_language).toBe("es");
    expect(result.ai_search.semantic_text).toBe(true);
    expect(result.ai.writing.inline_enabled).toBe(true);
    expect(result.ai.writing.enabled_types).toEqual({ text: true, markdown: false, code: false });
    expect(result.ai.documents.experimental_actions).toEqual(["rewrite"]);
    expect(result.ai.sheets.experimental_actions).toEqual(["formula"]);
    expect(result.ai.decks.experimental_actions).toEqual(["create"]);
    expect(result.timeline).toEqual({ preview_quality: "960", snap_enabled: false, proxy_enabled: false });
    expect(result.office_edit).toEqual({ enabled: true, autosave_default: true, idle_minutes: 5 });
    expect(result.document_editor).toEqual({
      autosave_default: true,
      show_ruler: false,
      show_navigation: false,
      spelling: true,
    });
    expect(result.sheet_editor).toEqual({
      show_formula_bar: false,
      show_gridlines: true,
      show_headings: true,
      default_zoom: 100,
    });
    expect(result.deck_editor).toEqual({
      show_notes: false,
      snap_to_grid: false,
      default_aspect: "wide",
      presenter_view: false,
    });
  });

  it("resets pre-46 AI search and keeps legacy size labels", () => {
    const result = normalizeSettings({
      schema_version: 29,
      format_options: { decimals: 2 },
      ai_search: { semantic_text: true, photo_index: true },
    });
    expect(result.schema_version).toBe(SETTINGS_SCHEMA_VERSION);
    expect(result.format_options.size_base).toBe("legacy");
    expect(result.ai_search.semantic_text).toBe(false);
    expect(result.ai_search.photo_index).toBe(false);
  });

  it("exposes the current schema version and every feature default", () => {
    const settings = defaultSettings();
    expect(SETTINGS_SCHEMA_VERSION).toBe(56);
    expect(settings.schema_version).toBe(SETTINGS_SCHEMA_VERSION);
    expect(settings.theme.accent_custom).toBe("#0067C0");
    expect(settings.theme_custom).toEqual({
      day: { kind: "builtin", id: "light" },
      night: { kind: "builtin", id: "dark" },
      mode: "windows",
      manual_scheme: "light",
      day_start_minute: 420,
      night_start_minute: 1140,
      follow_wallpaper: false,
      type_accents: {},
    });
    expect(settings.toolbar_custom).toEqual({
      classic_menu: false,
      bars: [],
      quick_access: ["explorer.undo", "explorer.redo", "explorer.copyPath"],
    });
    expect(settings.keyboard_custom).toEqual({
      active_map: "builtin:windows",
      custom_maps: [],
      allow_bare_navigation: false,
    });
    expect(settings.tab_options).toEqual({
      width_mode: "fixed",
      fixed_width_px: 180,
      close_button: "always",
      new_position: "end",
      close_activation: "mru",
      hover_preview: false,
      hover_delay_ms: 500,
      type_icons: true,
      type_underline: true,
      title_limit: 40,
      overflow: "scroll",
      double_click_new: true,
    });
    expect(settings.format_options).toEqual({
      locale: "system",
      date_style: "short",
      custom_date: "YYYY-MM-DD HH:mm",
      time_cycle: "system",
      week_start: "system",
      size_base: "binary",
      decimals: 1,
      name_truncation: "end",
      extension_overrides: {},
    });
    expect(settings.behavior).toEqual({
      open_click: "double",
      confirm_changes: false,
      confirmations: {
        recycle: false,
        move: false,
        rename: false,
        convert: false,
        clean: false,
        save: false,
      },
    });
    expect(settings.accessibility.focus_px).toBe(2);
    expect(settings.accessibility.reduced_motion).toBe("system");
    expect(settings.search).toEqual({
      roots: [],
      default_mode: "name",
      index_limit_mb: 2048,
      content_max_chars: 100_000,
      usn_enabled: false,
      excluded_paths: [],
    });
    expect(settings.views).toEqual({
      enabled_views: {
        timeline: true,
        calendar: true,
        by_kind: true,
        recent_activity: true,
        map: false,
      },
      date_source: "modified",
      activity_enabled: true,
      map_online_enabled: false,
      write_embedded_tags: false,
    });
    expect(settings.folder_sizes).toEqual({ enabled: false, network: false, details: false });
    expect(settings.pack_catalog).toEqual({ last_checked_unix: null });
    expect(settings.office_view).toEqual({
      prefer_accurate: true,
      show_comments: false,
      keep_engine_warm: true,
      idle_seconds: 60,
    });
    expect(settings.pdf_tools).toEqual({ author: "" });
    expect(settings.image_editor).toEqual({
      default_mode: "edit",
      background_rgba: [255, 255, 255, 255],
      history_limit_mb: 256,
      advanced: false,
      selection_tolerance: 15,
      show_history: false,
    });
    expect(settings.local_ai).toEqual({
      enabled: false,
      device: "auto",
      tier: "auto",
      idle_unload_seconds: 120,
      memory_limit_mb: 4096,
      tasks: {
        structured_text: false,
        vision_answer: false,
        embed_text: false,
        embed_image: false,
        transcribe: false,
        upscale: false,
        foreground_mask: false,
        inpaint: false,
      },
    });
    expect(settings.media_editor).toEqual({
      preview_quality: "960",
      waveform: true,
      keep_pitch: true,
    });
    expect(settings.assistant).toEqual({
      enabled: false,
      backend: "local",
      provider_id: "meta",
      custom_endpoint_id: null,
      api_model_id: "muse-spark-1.3",
      local_source: "bundled",
      local_server_port: 11434,
      local_server_address: "127.0.0.1",
      name: "",
      answer_length: "normal",
      tone: "neutral",
      language: "app",
      show_steps: false,
      allow_read_contents: false,
      automatic_tools: {
        open_tab: true,
        switch_tab: true,
        search_files: true,
        read_file: false,
        group_tabs: true,
      },
      denied_folders: [],
      keep_history: false,
    });
    expect(settings.ai_actions).toMatchObject({
      transcription_language: "auto",
      caption_language: "auto",
      caption_window_seconds: 30,
      dictation_language: "en",
    });
    expect(Object.keys(settings.ai_actions.enabled)).toHaveLength(16);
    expect(Object.values(settings.ai_actions.enabled).every((flag) => flag === false)).toBe(true);
    expect(settings.ai_search).toEqual({
      semantic_text: false,
      photo_index: false,
      natural_query: false,
      rename: false,
      sort: false,
      roots: [],
      destinations: [],
      disabled_sort_extensions: [],
    });
    expect(settings.ai).toEqual({
      writing: {
        inline_enabled: false,
        enabled_types: { text: false, markdown: false, code: false },
      },
      documents: { enabled: false, experimental_actions: [] },
      sheets: { enabled: false, experimental_actions: [] },
      decks: { enabled: false, experimental_actions: [] },
    });
    expect(settings.timeline).toEqual({
      preview_quality: "960",
      snap_enabled: true,
      proxy_enabled: false,
    });
    expect(settings.office_edit).toEqual({
      enabled: false,
      autosave_default: false,
      idle_minutes: 5,
    });
    expect(settings.document_editor).toEqual({
      autosave_default: false,
      show_ruler: true,
      show_navigation: false,
      spelling: true,
    });
    expect(settings.sheet_editor).toEqual({
      show_formula_bar: true,
      show_gridlines: true,
      show_headings: true,
      default_zoom: 100,
    });
    expect(settings.deck_editor).toEqual({
      show_notes: true,
      snap_to_grid: false,
      default_aspect: "wide",
      presenter_view: true,
    });
  });

  it("normalizes its own defaults without changing a field", () => {
    const defaults = defaultSettings();
    expect(normalizeSettings(defaults)).toEqual(defaults);
  });

  it("resets unknown or newer schema versions instead of guessing", () => {
    const newer = {
      ...defaultSettings(),
      schema_version: SETTINGS_SCHEMA_VERSION + 1,
      language: "es",
    };
    expect(normalizeSettings(newer)).toEqual(defaultSettings());
    expect(normalizeSettings({ schema_version: 0, language: "es" })).toEqual(defaultSettings());
  });

  it("keeps only the known sheet and deck AI actions", () => {
    const result = normalizeSettings({
      ai: {
        sheets: {
          enabled: true,
          experimental_actions: ["formula", "explain", "formula", "script"],
        },
        decks: {
          enabled: true,
          experimental_actions: ["create", "add", "shorten", "notes", "layout", "style", "delete"],
        },
      },
    });
    expect(result.ai.sheets).toEqual({
      enabled: true,
      experimental_actions: ["formula", "explain"],
    });
    expect(result.ai.decks).toEqual({
      enabled: true,
      experimental_actions: ["create", "add", "shorten", "notes", "layout", "style"],
    });
  });
});
