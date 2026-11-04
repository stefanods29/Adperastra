import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  defaultResidentStartup,
  mergeResidentStartup,
  normalizeResidentStartup,
} from "../services/resident";
import { normalizeSettings, SETTINGS_SCHEMA_VERSION } from "../services/settings";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const helpPages = [
  [
    "windows-integration",
    "Windows Explorer integration",
    "Integración con el Explorador de Windows",
  ],
  ["file-associations", "File associations", "Asociaciones de archivos"],
  ["stay-in-background", "Stay in background", "Permanecer en segundo plano"],
  ["updating-adperastra", "Updating Adperastra", "Actualizar Adperastra"],
] as const;

describe("step 16 settings migration and help", () => {
  it("migration42_preservesprefs", () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(56);
    const schema42Startup = {
      mode: "restore",
      folder: "C:\\Work",
      restored_tabs: 2,
      future_field: { enabled: true },
    };
    const migrated = mergeResidentStartup(
      schema42Startup,
      normalizeResidentStartup(undefined),
    );
    expect(migrated).toMatchObject({
      mode: "restore",
      folder: "C:\\Work",
      restored_tabs: 2,
      stay_in_background: false,
      start_with_windows: false,
    });
    expect(migrated.future_field).toEqual({ enabled: true });

    // The settings normalizer keeps the existing startup preferences while
    // adding the two new false choices (the Rust migrate arm does the same).
    const repaired = normalizeSettings({
      schema_version: 42,
      language: "es",
      startup: schema42Startup,
    });
    expect(repaired.startup).toMatchObject({
      mode: "restore",
      folder: "C:\\Work",
      stay_in_background: false,
      start_with_windows: false,
    });

    const explicit = mergeResidentStartup(schema42Startup, {
      stay_in_background: true,
      start_with_windows: true,
    });
    expect(explicit).toMatchObject({
      mode: "restore",
      stay_in_background: true,
      start_with_windows: true,
    });

    // Starting with Windows without staying in the background is coerced
    // off rather than booting into a hidden app that immediately exits.
    expect(
      normalizeResidentStartup({
        stay_in_background: false,
        start_with_windows: true,
      }).start_with_windows,
    ).toBe(false);
  });

  it("updatesoff_nonetwork", () => {
    for (const file of ["resident.ts", "windowsIntegration.ts"]) {
      const text = readFileSync(join(root, "src", "services", file), "utf8");
      expect(text, `${file}: fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(text, `${file}: XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
      expect(text, `${file}: update check`).not.toMatch(/checkForUpdates/);
      expect(text, `${file}: URL`).not.toMatch(/https?:\/\//);
    }
    expect(defaultResidentStartup()).toEqual({
      stay_in_background: false,
      start_with_windows: false,
    });
  });

  it("classichelper_timeout_survives", () => {
    const classic = readFileSync(
      join(root, "src-tauri", "src", "classic_menu.rs"),
      "utf8",
    );
    expect(classic).toContain(
      "pub const LOAD_TIMEOUT: Duration = Duration::from_secs(5);",
    );
    expect(classic).toContain("fn wait_until_ready");
    expect(classic).toContain("child.kill()");
    expect(classic).not.toContain("LoadLibrary");

    const main = readFileSync(join(root, "src-tauri", "src", "main.rs"), "utf8");
    expect(main).toContain("classic_menu::show(&request)");
    expect(main).toContain("classic_menu::run_helper()");
  });

  it("all four help pages exist in both languages", () => {
    for (const [slug, englishTitle, spanishTitle] of helpPages) {
      const english = readFileSync(join(root, "help", "en", `${slug}.md`), "utf8");
      const spanish = readFileSync(join(root, "help", "es", `${slug}.md`), "utf8");
      expect(english.split(/\r?\n/)[0]).toBe(`# ${englishTitle}`);
      expect(spanish.split(/\r?\n/)[0]).toBe(`# ${spanishTitle}`);
      expect(english).toMatch(/See also:/);
      expect(spanish).toMatch(/Consulta también:/);
      expect(spanish).not.toMatch(/See also:/);
      expect(english.toLowerCase()).not.toMatch(/coming soon|not implemented/);
    }
  });
});
