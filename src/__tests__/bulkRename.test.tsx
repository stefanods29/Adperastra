import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BulkRenameDialog from "../rename/BulkRenameDialog";
import { catalogForStorage, presetForStorage } from "../services/renamePresets";
import type { RenamePlanPage, RenamePreset, RenameRequest } from "../services/bulkRename";

const api = vi.hoisted(() => ({ preview: vi.fn(), page: vi.fn(), execute: vi.fn(), reportPage: vi.fn(), release: vi.fn(), list: vi.fn(), write: vi.fn(), remove: vi.fn() }));
vi.mock("../services/bulkRename", () => ({ previewRename: api.preview, renamePreviewPage: api.page, executeRename: api.execute, renameReportPage: api.reportPage, releaseRenamePlan: api.release, listRenamePresets: api.list, writeRenamePreset: api.write, removeRenamePreset: api.remove }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => `translated:${key}` }) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: (options: { count: number }) => ({ getTotalSize: () => options.count * 28, scrollToIndex: vi.fn(), getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 28 })) }) }));

let root: Root | null;
let container: HTMLDivElement;
function page(revision = 1, status: "ready" | "invalid" | "conflict" = "ready"): RenamePlanPage {
  return { plan_id: `plan-${revision}`, request_revision: revision, total: 1, ready: status === "ready" ? 1 : 0, invalid: status === "invalid" ? 1 : 0, conflicts: status === "conflict" ? 1 : 0, all_rows_valid: status === "ready", expires_unix: 9999999999, rows: [{ input_index: 0, source_path: "C:\\fixture\\a.txt", source: { path_key: "c:\\fixture\\a.txt", volume_id: "00000001", file_id: "0000000000000001", modified_ticks: "133000000000000001", size_bytes: 1 }, old_name: "a.txt", new_name: "b.txt", status }] };
}
async function render(paths = ["C:\\fixture\\a.txt"], onClose = vi.fn()) {
  await act(async () => root?.render(<BulkRenameDialog paths={paths} onClose={onClose} onCompleted={vi.fn()} onOpenHelp={vi.fn()} />));
  return onClose;
}
async function tick(ms = 150) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function action() { return [...container.querySelectorAll("button")].find(button => button.textContent === "translated:rename.action")!; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  api.list.mockResolvedValue({ schema_version: 1, revision: 1, presets: [] });
  api.release.mockResolvedValue(undefined);
  api.preview.mockImplementation(async (request: RenameRequest) => ({ id: "job", cancel: vi.fn().mockResolvedValue(undefined), completion: Promise.resolve(page(request.request_revision)) }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; container.remove(); vi.useRealTimers(); });

describe("Bulk rename", () => {
  it("150ms_debounce", async () => {
    await render(); await tick(149); expect(api.preview).not.toHaveBeenCalled();
    await tick(1); expect(api.preview).toHaveBeenCalledTimes(1);
  });
  it("invalid_disabled", async () => {
    api.preview.mockImplementation(async (r: RenameRequest) => ({ id: "job", cancel: vi.fn(), completion: Promise.resolve(page(r.request_revision, "invalid")) }));
    await render(); await tick(); expect(action().disabled).toBe(true); expect(api.execute).not.toHaveBeenCalled();
  });
  it("exclude_conflict", async () => {
    api.preview.mockImplementation(async (r: RenameRequest) => ({ id: "job", cancel: vi.fn(), completion: Promise.resolve(page(r.request_revision, "conflict")) }));
    await render(); await tick();
    const exclude = container.querySelector<HTMLInputElement>('[aria-label="translated:rename.excludeNamed"]')!;
    await act(async () => exclude.click());
    expect(action().disabled).toBe(true);
    await tick(); expect(api.preview.mock.calls[1][0].excluded_indices).toEqual([0]);
  });
  it("1001_refused", async () => {
    await render(Array.from({ length: 1001 }, (_, i) => `C:\\fixture\\${i}.txt`)); await tick();
    expect(api.preview).not.toHaveBeenCalled(); expect(action().disabled).toBe(true);
  });
  it("stale_generation_ignored", async () => {
    const old = deferred<RenamePlanPage>();
    const cancel = vi.fn().mockResolvedValue(undefined);
    api.preview.mockResolvedValueOnce({ id: "old", cancel, completion: old.promise });
    await render(); await tick();
    await render(["C:\\fixture\\new.txt"]); await tick();
    await act(async () => old.resolve(page(1, "conflict")));
    expect(cancel).toHaveBeenCalled(); expect(api.release).toHaveBeenCalledWith("plan-1"); expect(action().disabled).toBe(false);
  });
  it("keyboard_and_all_texts_use_translation", async () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const close = await render(); await tick();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("translated:rename.title");
    expect(container.textContent).toContain("translated:rename.includeExtension");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount()); root = null;
    expect(document.activeElement).toBe(trigger); trigger.remove();
  });
  it("pages_keep_global_counts_and_disable_until_loaded", async () => {
    const tail = deferred<RenamePlanPage>();
    api.preview.mockImplementation(async (r: RenameRequest) => ({ id: "job", cancel: vi.fn(), completion: Promise.resolve({ ...page(r.request_revision), total: 2, ready: 2, next_cursor: "cursor" }) }));
    api.page.mockReturnValue(tail.promise);
    await render(["C:\\fixture\\a.txt", "C:\\fixture\\b.txt"]); await tick(); expect(action().disabled).toBe(true);
    const next = page(1); next.rows[0].input_index = 1; next.total = 2; next.ready = 2;
    await act(async () => tail.resolve(next)); expect(action().disabled).toBe(false);
  });
  it("keyboard_reaches_preview_rows", async () => {
    api.preview.mockImplementation(async (request: RenameRequest) => {
      const result = page(request.request_revision);
      result.total = 2; result.ready = 2;
      result.rows.push({ ...result.rows[0], input_index: 1, old_name: "second.txt", new_name: "second-new.txt" });
      return { id: "job", cancel: vi.fn(), completion: Promise.resolve(result) };
    });
    await render(["C:\\fixture\\a.txt", "C:\\fixture\\second.txt"]); await tick();
    const first = container.querySelector<HTMLInputElement>('[data-rename-index="0"]')!;
    const second = container.querySelector<HTMLInputElement>('[data-rename-index="1"]')!;
    first.focus();
    await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(second);
    await act(async () => second.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(first);
  });
});

describe("Rename preset projection", () => {
  const preset: RenamePreset = { id: "00000000-0000-4000-8000-000000000001", name: "Photos", operations: [{ kind: "prefix", text: "Photo-" }], include_extension: false, date_zone: "utc", version: 1 };
  it("no_source_path_persist", () => {
    const contaminated = { ...preset, paths: ["C:\\private\\photo.jpg"], operations: [{ kind: "prefix" as const, text: "Photo-", source_path: "C:\\private" }] };
    expect(presetForStorage(contaminated)).toEqual(preset);
    expect(JSON.stringify(catalogForStorage({ schema_version: 1, revision: 1, presets: [contaminated] }))).not.toContain("private");
  });
  it("explicit_names_preset_refused", () => {
    expect(() => presetForStorage({ ...preset, operations: [{ kind: "explicit_names", names: [{ input_index: 0, new_name: "a.txt" }] }] })).toThrow("rename.bad_request");
  });
});
