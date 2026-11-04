import { afterEach, describe, expect, it, vi } from "vitest";
import { validColumnSet, validFolderBackground, validFolderIcon, validCustomizeRequest, getFolderDecorations, customizeFolders, resetFolders, listColumnSets, saveColumnSet } from "../services/folderCustomization";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../services/settings";
import { runJob } from "../services/jobs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: vi.fn(() => true), isViewModeId: vi.fn() }));
vi.mock("../services/jobs", () => ({ runJob: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
});

const key = { volume_id: "12345678", file_id: "0000000000000001", path_key: "c:\\a", stable: true };
const background = { kind: "none", angle_degrees: 0, fit: "fit", opacity: 0.15, blur_px: 0, inherit: false };

describe("folder customization data", () => {
  it("checks finite background bounds and opaque solid colors", () => {
    expect(validFolderBackground(background)).toBe(true);
    expect(validFolderBackground({ ...background, opacity: NaN })).toBe(false);
    expect(validFolderBackground({ ...background, opacity: 0.51 })).toBe(false);
    expect(validFolderBackground({ ...background, angle_degrees: 360 })).toBe(false);
    expect(validFolderBackground({ ...background, kind: "solid", color: "#11223388" })).toBe(false);
    expect(validFolderBackground({ ...background, kind: "gradient", color: "#112233", second_color: "#445566" })).toBe(true);
    expect(validFolderBackground({ ...background, kind: "gradient", color: "#112233" })).toBe(false);
    expect(validFolderBackground({ ...background, kind: "gradient", color: "#11223380", second_color: "#44556600" })).toBe(true);
    expect(validFolderBackground({ ...background, kind: ["none"] })).toBe(false);
    expect(validFolderBackground({ ...background, fit: ["fit"] })).toBe(false);
  });

  it("accepts one grapheme and rejects multiple graphemes or raw image paths", () => {
    expect(validFolderIcon({ kind: "emoji", value: "👨‍👩‍👧‍👦" })).toBe(true);
    expect(validFolderIcon({ kind: "emoji", value: "⭐🌙" })).toBe(false);
    expect(validFolderIcon({ kind: "image", value: "C:\\picture.png" })).toBe(false);
    expect(validFolderIcon({ kind: "lucide", value: "folderLock" })).toBe(true);
    expect(validFolderIcon({ kind: "lucide", value: "run.dll,1" })).toBe(false);
  });

  it("Namecannotremove", () => {
    const set = { id: "12345678-1234-4234-8234-123456789abc", name: "Photos", version: 1, columns: [{ id: "name", width: 320 }] };
    expect(validColumnSet(set)).toBe(true);
    expect(validColumnSet({ ...set, columns: [{ id: "size", width: 100 }] })).toBe(false);
    expect(validColumnSet({ ...set, columns: [{ id: "name", width: 320 }, { id: "name", width: 320 }] })).toBe(false);
    expect(validColumnSet({ ...set, folder_type: ["photos"] })).toBe(false);
  });

  it("bounds requests and keeps consent independent", () => {
    const request = { paths: ["C:\\a"], patch: { color: "#112233" }, expected_keys: [key], apply_windows: false, accepted_windows_change: false };
    expect(validCustomizeRequest(request)).toBe(true);
    expect(validCustomizeRequest({ ...request, paths: Array(1001).fill("C:\\a"), expected_keys: Array(1001).fill(key) })).toBe(false);
    expect(validCustomizeRequest({ ...request, expected_keys: [] })).toBe(false);
    expect(validCustomizeRequest({ ...request, apply_windows: true })).toBe(false);
    expect(validCustomizeRequest({ ...request, apply_windows: true, accepted_windows_change: true })).toBe(true);
    expect(validCustomizeRequest({ ...request, patch: { dangerous: true } })).toBe(false);
    expect(validCustomizeRequest({ ...request, patch: { color: undefined } })).toBe(false);
    expect(validCustomizeRequest({ ...request, patch: { color: null } })).toBe(true);
    expect(validCustomizeRequest({ ...request, paths: ["C:\\a\\..\\b"] })).toBe(false);
  });
});

describe("folder customization service boundary", () => {
  const request = { paths: ["C:\\a"], patch: { color: "#112233" }, expected_keys: [key], apply_windows: false, accepted_windows_change: false };
  const result = { changed_count: 1, windows_applied_count: 0, failures: [], history_id: "12345678-1234-4234-8234-123456789abc", complete: true };

  it("does not send invalid requests to the native boundary", async () => {
    await expect(customizeFolders({ ...request, expected_keys: [] })).rejects.toThrow("folder_custom.invalid");
    await expect(resetFolders(request.paths, [])).rejects.toThrow("folder_custom.invalid");
    expect(invoke).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it("rejects unsupported runtimes without reporting a saved appearance", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    await expect(customizeFolders(request)).rejects.toThrow("folder_custom.unsupported");
    await expect(getFolderDecorations(request.paths)).rejects.toThrow("folder_custom.unsupported");
    expect(runJob).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the job handle before completion and preserves cancellation", async () => {
    let finish!: (value: typeof result) => void;
    const completion = new Promise<typeof result>((resolve) => { finish = resolve; });
    const cancel = vi.fn(async () => undefined);
    vi.mocked(runJob).mockImplementationOnce(async (_prefix, start) => {
      await start("foldercustom-test-1");
      return { id: "foldercustom-test-1", cancel, completion };
    });
    const handle = await customizeFolders(request);
    expect(invoke).toHaveBeenCalledWith("folder_customize_start", { requestId: "foldercustom-test-1", request });
    expect(handle.id).toBe("foldercustom-test-1");
    await handle.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
    finish(result);
    await expect(handle.completion).resolves.toEqual(result);
  });

  it("refuses malformed completion instead of reporting Windows success", async () => {
    vi.mocked(runJob).mockResolvedValueOnce({ id: "job", cancel: vi.fn(), completion: Promise.resolve({ ...result, windows_applied_count: 2 }) });
    const handle = await customizeFolders(request);
    await expect(handle.completion).rejects.toThrow("folder_custom.invalid");
  });

  it("refuses incomplete decoration responses and responses above 768KiB", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await expect(getFolderDecorations(request.paths)).rejects.toThrow("folder_custom.invalid");
    const paths = Array.from({ length: 32 }, (_, index) => `C:\\${index}`);
    vi.mocked(invoke).mockResolvedValueOnce(paths.map(() => ({ icon: { kind: "default" }, warning_codes: [], inherited_from: `C:\\${"a".repeat(32000)}` })));
    await expect(getFolderDecorations(paths)).rejects.toThrow("folder_custom.invalid");
  });

  it("refuses duplicate column-set IDs and invalid saved sets", async () => {
    const set = { id: result.history_id, name: "Photos", version: 1 as const, columns: [{ id: "name" as const, width: 320 }] };
    vi.mocked(invoke).mockResolvedValueOnce([set, set]);
    await expect(listColumnSets()).rejects.toThrow("folder_custom.invalid");
    vi.mocked(invoke).mockResolvedValueOnce({ ...set, version: 2 });
    await expect(saveColumnSet(set)).rejects.toThrow("folder_custom.invalid");
  });
});
