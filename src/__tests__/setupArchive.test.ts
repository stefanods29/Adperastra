import { describe, expect, it } from "vitest";
import {
  isSetupEntryName,
  validateSetupApplyRequest,
  validateSetupManifest,
  validateSetupPreview,
  type SetupManifest,
} from "../services/setups";

const SHA = "0".repeat(64);

function manifest(): SetupManifest {
  return {
    schema_version: 1,
    app_version: "0.1.16",
    parts: ["menus"],
    entries: [{ name: "data/menus.json", byte_len: 2, sha256: SHA }],
    contains_personal_paths: false,
    created_unix: 1_800_000_000,
  };
}

function preview(value: SetupManifest = manifest()) {
  return {
    preview_id: "00000000-0000-4000-a000-000000000001",
    manifest: value,
    parts: [{ id: "menus", item_count: 3, warning_codes: [] }],
    expires_unix: 1_800_000_300,
  };
}

describe("setup file data", () => {
  it("traversal/duplicate/executabledeny: refuses traversal, duplicate and executable entry names", () => {
    expect(isSetupEntryName("data/../evil.json")).toBe(false);
    expect(isSetupEntryName("data/menus.json")).toBe(true);
    expect(isSetupEntryName("data/setup.exe")).toBe(false);
    expect(isSetupEntryName("/absolute/data/menus.json")).toBe(false);
    expect(isSetupEntryName("assets/00000000-0000-4000-a000-000000000001.png")).toBe(true);
    const duplicated = manifest();
    duplicated.entries.push({ name: "data/menus.json", byte_len: 2, sha256: SHA });
    expect(validateSetupManifest(duplicated)).toBeNull();
  });

  it("personaldefaultabsent: keeps the personal flag but never invents a personal part", () => {
    const personal = manifest();
    personal.contains_personal_paths = true;
    expect(validateSetupManifest(personal)?.contains_personal_paths).toBe(true);
    expect(validateSetupManifest(personal)!.parts).toEqual(["menus"]);
  });

  it("refuses a manifest whose part has no data file", () => {
    const broken = manifest();
    broken.parts = ["menus", "home"];
    expect(validateSetupManifest(broken)).toBeNull();
  });

  it("validates the preview before anything is applied", () => {
    expect(validateSetupPreview(preview()).parts[0].item_count).toBe(3);
    expect(() => validateSetupPreview({ ...preview(), preview_id: "not-a-uuid" })).toThrow("setup.invalid");
    expect(() =>
      validateSetupPreview({ ...preview(), parts: [{ id: "keyboard", item_count: 1, warning_codes: [] }] }),
    ).toThrow("setup.invalid");
  });

  it("requires a non-empty, unique part selection to apply", () => {
    const base = {
      preview_id: "00000000-0000-4000-a000-000000000001",
      parts: ["menus"],
      accept_personal_paths: false,
    };
    expect(validateSetupApplyRequest(base).parts).toEqual(["menus"]);
    expect(() => validateSetupApplyRequest({ ...base, parts: [] })).toThrow("setup.invalid");
    expect(() => validateSetupApplyRequest({ ...base, parts: ["menus", "menus"] })).toThrow("setup.invalid");
    expect(() => validateSetupApplyRequest({ ...base, parts: ["setup"] })).toThrow("setup.invalid");
  });

  it("hashmismatchbeforepreview: refuses a hash that is not lowercase SHA-256", () => {
    const broken = manifest();
    broken.entries[0].sha256 = "A".repeat(64);
    expect(validateSetupManifest(broken)).toBeNull();
  });
});
