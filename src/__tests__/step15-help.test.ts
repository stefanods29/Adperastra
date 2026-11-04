import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import { RECIPE_EXPORT_NOTICE_KEYS } from "../media-edit/recipeCodec";
import { formatTimeUs, nudgeTimeUs, parseTimeUs } from "../media-edit/timing";
import { normalizeSettings } from "../services/settings";

function help(language: "en" | "es", slug: string): string {
  return readFileSync(repoUrl(`../../help/${language}/${slug}.md`, import.meta.url), "utf8");
}

const MIGRATED = {
  schema_version: 41,
  language: "es",
  theme: { mode: "dark" },
  appearance: { ui_scale: 125, density: "compact", corner_radius: "round", animations: "reduced" },
  image_editor: {
    default_mode: "draw",
    background_rgba: [10, 20, 30, 255],
    history_limit_mb: 128,
  },
  local_ai: {
    enabled: true,
    device: "cpu",
    tier: "small",
    idle_unload_seconds: 60,
    memory_limit_mb: 2048,
    tasks: { upscale: true },
  },
};

describe("media editor settings migration", () => {
  it("schema 41 keeps image and local AI preferences and adds media defaults", () => {
    const output = normalizeSettings(MIGRATED) as unknown as {
      schema_version: number;
      image_editor: { default_mode: string; background_rgba: number[]; history_limit_mb: number };
      local_ai: { enabled: boolean; tasks: { upscale: boolean } };
      media_editor: { preview_quality: string; waveform: boolean; keep_pitch: boolean };
    };
    expect(output.schema_version).toBe(56);
    expect(output.image_editor.default_mode).toBe("draw");
    expect(output.image_editor.background_rgba).toEqual([10, 20, 30, 255]);
    expect(output.local_ai.enabled).toBe(true);
    expect(output.local_ai.tasks.upscale).toBe(true);
    expect(output.media_editor).toEqual({ preview_quality: "960", waveform: true, keep_pitch: true });
  });
});

describe("media editor keyboard ranges", () => {
  it("accepts typed Start/End values and arrow nudges without floats", () => {
    const start = parseTimeUs("00:00:02.000");
    const end = parseTimeUs("00:00:08.000");
    expect(start).toBe(2_000_000);
    expect(end).toBe(8_000_000);
    expect(nudgeTimeUs(start, 1_000_000, 10_000_000)).toBe(3_000_000);
    expect(formatTimeUs(nudgeTimeUs(end, -1_000_000, 10_000_000))).toBe("00:00:07.000");
  });
});

describe("recipe versus export wording", () => {
  it("shows the same distinction in both languages", () => {
    const enMedia = (en as unknown as { mediaEdit: { recipeNotice: string } }).mediaEdit;
    const esMedia = (es as unknown as { mediaEdit: { recipeNotice: string } }).mediaEdit;
    expect(RECIPE_EXPORT_NOTICE_KEYS).toEqual(["mediaEdit.recipeNotice"]);
    expect(enMedia.recipeNotice).toBe(
      "Saving the recipe keeps edit instructions; export creates playable media.",
    );
    expect(esMedia.recipeNotice).toBe(
      "Guardar la receta conserva las instrucciones; exportar crea contenido reproducible.",
    );
  });

  it("each help page states it and exists in English and Spanish", () => {
    const enTrim = help("en", "media-trimming");
    const esTrim = help("es", "media-trimming");
    expect(enTrim).toContain("Save edit recipe keeps the instructions");
    expect(enTrim).toContain("Export media creates a playable file");
    expect(esTrim).toContain("Guardar receta de edición conserva las instrucciones");
    expect(esTrim).toContain("Exportar multimedia crea un archivo reproducible");
    for (const slug of ["media-trimming", "media-extract-audio", "media-subtitles", "media-exporting"]) {
      expect(help("en", slug)).toContain("# ");
      expect(help("es", slug)).toContain("# ");
    }
  });
});