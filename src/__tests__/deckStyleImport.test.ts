import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import {
  importStyleFile,
  importTemplateStyle,
  isDeckTemplateFormatSupported,
  normalizeImportedTheme,
} from "../office/deck/styles/styleImport";
import { DeckStyleError } from "../office/deck/styles/styleTypes";
import { importDeckTheme } from "../office/deck/deckThemeImport";
import { runJob } from "../services/jobs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../office/deck/deckThemeImport", () => ({ importDeckTheme: vi.fn() }));
vi.mock("../services/jobs", () => ({ runJob: vi.fn() }));

const importMock = vi.mocked(importDeckTheme);
const runJobMock = vi.mocked(runJob);
const invokeMock = vi.mocked(invoke);
const templateInspection = "220b0001-0010-4000-8000-000000000001";

function templateTheme() {
  const theme = structuredClone(BUILTIN_DECK_STYLES[0].theme);
  for (const layout of theme.layouts) layout.name = "Confidential customer plan";
  return theme;
}

function code(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof DeckStyleError ? error.code : "unexpected";
  }
}

beforeEach(() => {
  importMock.mockReset();
  runJobMock.mockReset();
  invokeMock.mockReset();
});

describe("deck style import", () => {
  it("accepts POTX/OTP only through the registered template capability", () => {
    for (const format of ["pptx", "potx", "odp", "otp"]) {
      expect(isDeckTemplateFormatSupported(format)).toBe(true);
    }
    expect(isDeckTemplateFormatSupported("docx")).toBe(false);
    expect(isDeckTemplateFormatSupported("ppt")).toBe(false);
  });

  it("imports only normalized data and executes zero external content", async () => {
    importMock.mockResolvedValueOnce(templateTheme());
    const style = await importTemplateStyle(templateInspection, BUILTIN_DECK_STYLES[0].id, "My plan", [
      { from_family: "Arial", to_asset_id: "inter-regular" },
    ]);
    expect(style.name).toBe("My plan");
    expect(style.builtin).toBe(false);
    expect(importMock).toHaveBeenCalledTimes(1);
    expect(importMock.mock.calls[0][3]).toEqual([
      { from_family: "Arial", to_font: { family: "Inter", source: "bundled", embeddable: true } },
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("requires an explicit mapping when a template font is missing", async () => {
    const theme = templateTheme();
    theme.heading_font = { family: "Arial", source: "document", embeddable: false };
    expect(code(() => normalizeImportedTheme(theme, "Mapped"))).toBe("deck_style.font_missing");
    importMock.mockResolvedValueOnce(theme);
    await expect(
      importTemplateStyle(templateInspection, theme.id, "Mapped", [
        { from_family: "Arial", to_asset_id: "inter-bold" },
      ]),
    ).rejects.toMatchObject({ code: "deck_style.font_missing" });
  });

  it("keeps template words out of the catalog style", async () => {
    importMock.mockResolvedValueOnce(templateTheme());
    const style = await importTemplateStyle(templateInspection, BUILTIN_DECK_STYLES[0].id, "Clean", []);
    const serialized = JSON.stringify(style);
    expect(serialized).not.toContain("Confidential");
    for (const layout of style.theme.layouts) {
      expect(layout.name).toBe(`deckStyle.layout.${layout.kind}`);
    }
  });

  it("refuses a newer style file without changing existing bytes", async () => {
    const existingCatalog = { schema_version: 1, styles: [], revision: 3 };
    const before = JSON.stringify(existingCatalog);
    runJobMock.mockResolvedValueOnce({
      id: "deckstyle-1",
      cancel: vi.fn(),
      completion: Promise.reject(new Error("deck_style.schema_newer")),
    } as never);
    await expect(
      importStyleFile({ kind: "file", path: "C:\\styles\\newer.adp-deck-style" } as never),
    ).rejects.toMatchObject({ message: "deck_style.schema_newer" });
    expect(JSON.stringify(existingCatalog)).toBe(before);
  });

  it("leaves the source and catalog unchanged when the job is cancelled", async () => {
    const catalog = { schema_version: 1, styles: [], revision: 9 };
    runJobMock.mockResolvedValueOnce({
      id: "deckstyle-2",
      cancel: vi.fn(),
      completion: Promise.reject(new Error("jobs.cancelled")),
    } as never);
    await expect(
      importStyleFile({ kind: "file", path: "C:\\styles\\cancelled.adp-deck-style" } as never),
    ).rejects.toMatchObject({ message: "jobs.cancelled" });
    expect(catalog).toEqual({ schema_version: 1, styles: [], revision: 9 });
  });
});
