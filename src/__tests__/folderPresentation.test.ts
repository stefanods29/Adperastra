import { describe, expect, it, vi } from "vitest";
import { defaultColumns, legacyPresentation, validPresentation, setFolderPresentation } from "../services/folderPresentation";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
describe("folder presentation", () => {
  it("legacy_mode_retained", () => expect(legacyPresentation("list")).toEqual({ view_mode: "list", sort: { key: "name", direction: "ascending" }, group_by: "none", columns: defaultColumns() }));
  it("name_column_required", () => expect(validPresentation({ ...legacyPresentation("details"), columns: [{ id: "size", width: 100 }] })).toBe(false));
  it("duplicate_column_refused", () => expect(validPresentation({ ...legacyPresentation("details"), columns: [...defaultColumns(), { id: "size", width: 100 }] })).toBe(false));
  it("width95_refused", () => expect(validPresentation({ ...legacyPresentation("details"), columns: [{ id: "name", width: 320 }, { id: "size", width: 95 }] })).toBe(false));
  it("long_path_not_persisted_but_browsable", async () => {
    await expect(setFolderPresentation(`C:\\${"a".repeat(1100)}`, legacyPresentation("details"))).resolves.toBeUndefined();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("prototype_and_unknown_keys_refused", () => expect(validPresentation({ ...legacyPresentation("details"), extra: true })).toBe(false));
});
