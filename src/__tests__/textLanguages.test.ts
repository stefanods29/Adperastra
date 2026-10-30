import { describe, expect, it } from "vitest";
import { languageIdFor, loadLanguage } from "../handlers/text/languages";

describe("text languages", () => {
  it("maps file names to languages", () => {
    expect(languageIdFor("main.rs")).toBe("rust");
    expect(languageIdFor("App.TSX")).toBe("tsx");
    expect(languageIdFor("settings.json")).toBe("json");
    expect(languageIdFor("Dockerfile")).toBe("dockerfile");
    expect(languageIdFor("script.ps1")).toBe("powershell");
    expect(languageIdFor("notes.txt")).toBeNull();
    expect(languageIdFor("README")).toBeNull();
  });

  it("loads a modern and a legacy language", async () => {
    expect(await loadLanguage("json")).toBeTruthy();
    expect(await loadLanguage("powershell")).toBeTruthy();
  });
});
