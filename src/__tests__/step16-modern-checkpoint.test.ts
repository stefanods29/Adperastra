import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import i18n, { applyLanguage } from "../i18n";
import {
  applyWindowsIntegration,
  MODERN_MENU_OWNER_APPROVED,
  modernMenuPresentation,
  planWindowsIntegration,
  type IntegrationRequest,
} from "../services/windowsIntegration";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const t = i18n.t.bind(i18n) as TFunction;

function request(overrides: Partial<IntegrationRequest> = {}): IntegrationRequest {
  return {
    classic_enabled: false,
    extensions: [],
    start_with_windows: false,
    modern_requested: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("modern menu owner checkpoint", () => {
  it("modern_status_not_claimedenabled", () => {
    expect(MODERN_MENU_OWNER_APPROVED).toBe(false);
    const presentation = modernMenuPresentation("enabled");
    expect(presentation.state).not.toBe("enabled");
    expect(presentation.requestable).toBe(false);
    expect(presentation.messageKey).toBe("windowsIntegration.identityRequired");

    const manifest = readFileSync(
      join(root, "installer", "modern", "AppxManifest.xml"),
      "utf8",
    );
    expect(manifest).toContain("windows.fileExplorerContextMenus");
    expect(manifest).toContain("Windows.FullTrustApplication");
    expect(manifest).toContain("PLACEHOLDER");

    const checkpoint = readFileSync(
      join(root, "docs", "windows", "modern-menu-checkpoint.md"),
      "utf8",
    );
    expect(checkpoint).toMatch(/OWNER CHECKPOINT/);
    expect(checkpoint).toMatch(/not installed/i);
    expect(checkpoint).toMatch(/classic menu/i);
    expect(checkpoint).toMatch(/no certificate/i);
  });

  it("classic_label_truthful", async () => {
    await applyLanguage("en");
    const classicEnglish = t("windowsIntegration.classic");
    const modernEnglish = t("windowsIntegration.modern");
    await applyLanguage("es");
    const classicSpanish = t("windowsIntegration.classic");
    const modernSpanish = t("windowsIntegration.modern");

    expect(classicEnglish).toContain("Show more options");
    expect(classicSpanish).toContain("Mostrar más opciones");
    expect(classicEnglish).not.toContain("main menu");
    expect(classicSpanish.toLowerCase()).not.toContain("menú principal");
    expect(modernEnglish).toContain("Windows 11 main menu");
    expect(modernSpanish).toContain("Menú principal de Windows 11");
    await applyLanguage("en");
  });

  it("ownercheckpoint_onlydependentpath", async () => {
    const plan = planWindowsIntegration(request({ modern_requested: true }));
    expect(plan.send).toBe(false);
    expect(plan.blocked_reason).toBe("windows_integration.identity_required");
    await expect(
      applyWindowsIntegration(request({ modern_requested: true })),
    ).rejects.toThrow("windows_integration.identity_required");
    expect(invoke).not.toHaveBeenCalled();
  });
});
