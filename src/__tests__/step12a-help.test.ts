import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PACK_IDS,
  RESERVED_AI_PACK_IDS,
  STORAGE_CATEGORIES,
  type StorageReport,
} from "../services/packTypes";
import { normalizeSettings } from "../services/settings";
import { missingReportCategories } from "../services/storage";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const page = (language: string, name: string) =>
  readFileSync(join(root, "help", language, name), "utf8");

describe("Step 12a help and catalog boundaries", () => {
  it("all help bilingual", () => {
    const expected: Record<string, string[]> = {
      "app-storage.md": ["App storage", "User files are kept"],
      "installing-packs.md": ["Installing and removing packs", "signatures are checked"],
      "background-work.md": ["Background work", "Pause all background work"],
    };
    for (const [name, phrases] of Object.entries(expected)) {
      const english = page("en", name);
      const spanish = page("es", name);
      for (const phrase of phrases) expect(english).toContain(phrase);
      expect(spanish.toLowerCase()).toMatch(/configuración|paquetes|trabajo/);
    }
    expect(page("es", "app-storage.md")).toContain("Almacenamiento de la aplicación");
    expect(page("es", "installing-packs.md")).toContain("Instalar y quitar paquetes");
    expect(page("es", "background-work.md")).toContain("Trabajo en segundo plano");
  });

  it("schema36 migration preserves task choices", () => {
    const raw = {
      schema_version: 36,
      language: "es",
      background: {
        enabled: true,
        only_idle: true,
        only_ac: false,
        paused: false,
        tasks: {
          thumbnails: false,
          metadata: true,
          content_index: true,
          pack_download: true,
        },
        pause_fullscreen: false,
        quiet_hours: { enabled: true, start_minute: 1260, end_minute: 360 },
        cpu_percent: 40,
      },
      pack_catalog: { last_checked_unix: 1_700_000_000 },
    };
    const normalized = normalizeSettings(raw) as unknown as {
      schema_version: number;
      language: string;
      background: {
        tasks: Record<string, boolean>;
        pause_fullscreen: boolean;
        quiet_hours: { enabled: boolean; start_minute: number; end_minute: number };
        cpu_percent: number;
      };
      pack_catalog: { last_checked_unix: number | null };
    };
    expect(normalized.language).toBe("es");
    expect(normalized.background.tasks.thumbnails).toBe(false);
    expect(normalized.background.tasks.content_index).toBe(true);
    expect(normalized.background.tasks.metadata).toBe(true);
    expect(normalized.background.pause_fullscreen).toBe(false);
    expect(normalized.background.quiet_hours.start_minute).toBe(1260);
    expect(normalized.background.cpu_percent).toBe(40);
    expect(normalized.pack_catalog.last_checked_unix).toBe(1_700_000_000);
  });

  it("first run non-AI only", () => {
    expect([...PRODUCTION_PACK_IDS]).toEqual(["media", "office", "ocr"]);
    for (const id of PRODUCTION_PACK_IDS) {
      expect(RESERVED_AI_PACK_IDS).not.toContain(id);
    }
    expect(RESERVED_AI_PACK_IDS).toContain("ai_runtime");
    expect(RESERVED_AI_PACK_IDS).toContain("ai_inpaint");
    expect(PRODUCTION_PACK_IDS).not.toContain("test_fixture");
  });

  it("every registered store is reported", () => {
    expect(new Set(STORAGE_CATEGORIES).size).toBe(STORAGE_CATEGORIES.length);
    expect(STORAGE_CATEGORIES).toHaveLength(18);
    const reports: StorageReport[] = STORAGE_CATEGORIES.map((category) => ({
      category,
      disk_bytes: 0,
      memory_bytes: 0,
      pending_delete_bytes: 0,
      limit_bytes: 0,
      clearable: true,
      loss_key: `storage.loss.${category}`,
      busy: false,
    }));
    expect(missingReportCategories(reports)).toEqual([]);
    expect(
      missingReportCategories(reports.filter((row) => row.category !== "versions")),
    ).toEqual(["versions"]);
  });
});
