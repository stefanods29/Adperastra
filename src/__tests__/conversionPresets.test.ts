import { describe, expect, it } from "vitest";
import {
  BUILTIN_CONVERSION_PRESETS,
  BUILTIN_PRESET_IDS,
  MAX_CONVERSION_PRESETS,
  buildConversionRequest,
  findConversionPreset,
  parsePresetCatalog,
  presetAcceptsFormats,
  sanitizePresetOptions,
  serializePresetCatalog,
  validateConversionPreset,
  type ConversionPreset,
} from "../services/conversionPresets";
import { normalizeSettings, SETTINGS_SCHEMA_VERSION } from "../services/settings";
import type { ConvertOptions } from "../convert/types";

function archivePreset(overrides: Partial<ConversionPreset> = {}): ConversionPreset {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Archive",
    converter_id: "zip/seven_z" as never,
    options: {
      kind: "archive",
      value: {
        format: "seven_z",
        level: 6,
        password: "output-secret",
        source_password: "source-secret",
        source_path: "C:\\Users\\someone\\private.zip",
        encrypt_names: false,
        preserve_timestamps: true,
      },
    } as unknown as ConvertOptions,
    name_pattern: "{stem}-{index}.{ext}",
    destination_mode: "source",
    version: 1,
    created_unix: 1,
    modified_unix: 1,
    ...overrides,
  };
}

describe("conversion presets", () => {
  it("strips password and source-secret fields before storage", () => {
    const clean = sanitizePresetOptions(archivePreset().options);
    const json = JSON.stringify(clean);
    expect(json).not.toContain("output-secret");
    expect(json).not.toContain("source-secret");
    expect(json).not.toContain("private.zip");
    expect(json).toContain("seven_z");
  });

  it("imports a catalog only when every preset and the schema are valid", () => {
    const preset = archivePreset();
    const text = JSON.stringify({
      schema_version: 1,
      presets: [{ ...preset, options: archivePreset().options }],
    });
    const parsed = parsePresetCatalog(JSON.parse(text));
    expect("catalog" in parsed).toBe(true);
    if (!("catalog" in parsed)) return;
    const serialized = serializePresetCatalog(parsed.catalog);
    expect(serialized).not.toContain("output-secret");
    expect(serialized).not.toContain("source-secret");
    expect(serialized).not.toContain("private.zip");
  });

  it("refuses an unknown or newer schema without changing the input", () => {
    const input = { schema_version: 2, presets: [] };
    const before = JSON.stringify(input);
    expect(parsePresetCatalog(input)).toEqual({ error: "convert.invalid_preset" });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("refuses 101 presets", () => {
    const presets = Array.from({ length: MAX_CONVERSION_PRESETS + 1 }, (_, index) =>
      archivePreset({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Preset ${index}`,
      }),
    );
    expect(parsePresetCatalog({ schema_version: 1, presets })).toEqual({ error: "convert.invalid_preset" });
  });

  it("keeps the three immutable built-ins and their fixed IDs", () => {
    expect(BUILTIN_CONVERSION_PRESETS.map((preset) => preset.id)).toEqual([
      BUILTIN_PRESET_IDS.webJpg,
      BUILTIN_PRESET_IDS.imagesPdf,
      BUILTIN_PRESET_IDS.tableCsv,
    ]);
    expect(validateConversionPreset(BUILTIN_CONVERSION_PRESETS[1], true)).toBeNull();
    expect(validateConversionPreset(BUILTIN_CONVERSION_PRESETS[1])).toBe("convert.invalid_preset");
  });

  it("builds a request with fresh empty acknowledgements", () => {
    const catalog = { schema_version: 1 as const, presets: [] };
    const preset = findConversionPreset(catalog, BUILTIN_PRESET_IDS.imagesPdf);
    expect(preset).not.toBeNull();
    const request = buildConversionRequest(
      preset!,
      [{ kind: "file", path: "C:\\Pictures\\a.png" }],
      "C:\\Out",
      "2026-11-01",
    );
    expect(request.keep_original).toBe(true);
    expect(request.accepted_losses).toEqual([]);
    expect(request.accepted_warning_codes).toEqual([]);
    expect(request.naming).toEqual({ pattern: "{stem}.{ext}", date_utc: "2026-11-01", start_index: 1 });
  });

  it("matches presets only to compatible input formats", () => {
    const csv = BUILTIN_CONVERSION_PRESETS[2];
    expect(presetAcceptsFormats(csv, ["xlsx"])).toBe(true);
    expect(presetAcceptsFormats(csv, ["csv"])).toBe(false);
  });

  it("keeps an unsaved snapshot as a snapshot instead of reloading the disk", () => {
    const catalog = { schema_version: 1 as const, presets: [] };
    const preset = findConversionPreset(catalog, BUILTIN_PRESET_IDS.tableCsv)!;
    const input = {
      kind: "snapshot" as const,
      snapshot_id: "33333333-3333-4333-8333-333333333333",
      document_id: "doc-1",
      revision: 7,
    };
    const request = buildConversionRequest(preset, [input], "C:\\Out", "2026-11-01");
    expect(request.inputs[0]).toEqual(input);
    expect("path" in request.inputs[0]).toBe(false);
  });

  it("keeps a schema-16 Spanish dark profile at quality 90", () => {
    const settings = normalizeSettings({
      schema_version: 16,
      language: "es",
      theme: { mode: "dark" },
      conversion: {
        default_destination: "source",
        default_quality: 90,
        preserve_metadata: true,
        concurrent_jobs: 2,
        last_preset: null,
        prompt_for_losses: true,
      },
    }) as unknown as {
      schema_version: number;
      language: string;
      theme: { mode: string };
      conversion: { default_quality: number; prompt_for_losses: boolean; last_preset: string | null };
    };
    expect(SETTINGS_SCHEMA_VERSION).toBe(56);
    expect(settings.schema_version).toBe(56);
    expect(settings.language).toBe("es");
    expect(settings.theme.mode).toBe("dark");
    expect(settings.conversion.default_quality).toBe(90);
    expect(settings.conversion.prompt_for_losses).toBe(true);
    expect(settings.conversion.last_preset).toBeNull();
  });
});
