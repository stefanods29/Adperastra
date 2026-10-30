import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerItem, ListDirHandle, SortSpec } from "../services/explorer";
import { listFolder } from "../services/columnListing";
import { startListDir } from "../services/explorer";

let tauri = true;
vi.mock("../services/explorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/explorer")>();
  return { ...actual, startListDir: vi.fn() };
});
vi.mock("../services/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/settings")>();
  return { ...actual, isTauriRuntime: () => tauri };
});

const sort: SortSpec = { key: "name", direction: "ascending" };

const item = (name: string): ExplorerItem => ({
  path: `C:\\A\\${name}`,
  name,
  kind: "file",
  size: 1,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const handle = (cancel: () => Promise<void>, completion: Promise<{ path: string; total: number; skipped: { path: string; message: string }[] }>): ListDirHandle => ({
  requestId: "list-1",
  cancel,
  completion,
});

beforeEach(() => {
  vi.clearAllMocks();
  tauri = true;
});

describe("listFolder", () => {
  it("collects every batch and reports skipped items", async () => {
    const a = item("a.txt");
    const b = item("b.txt");
    const c = item("c.txt");
    vi.mocked(startListDir).mockImplementation(async (_path, _sort, onBatch) => {
      onBatch([a]);
      onBatch([b, c]);
      return handle(async () => undefined, Promise.resolve({ path: "C:\\A", total: 3, skipped: [{ path: "C:\\A\\x", message: "denied" }] }));
    });
    const request = listFolder("C:\\A", sort);
    await expect(request.done).resolves.toEqual({ items: [a, b, c], partial: true });
  });

  it("cancel stops the listing", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.mocked(startListDir).mockResolvedValue(handle(cancel, new Promise(() => undefined)));
    const request = listFolder("C:\\A", sort);
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancelling before the listing starts stops it as soon as it starts", async () => {
    const cancel = vi.fn(async () => undefined);
    let release: (value: ListDirHandle) => void = () => undefined;
    vi.mocked(startListDir).mockImplementation(
      () =>
        new Promise<ListDirHandle>((resolve) => {
          release = resolve;
        }),
    );
    const request = listFolder("C:\\A", sort);
    request.cancel();
    release(handle(cancel, new Promise(() => undefined)));
    await expect(request.done).rejects.toThrow("cancelled");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("outside the app it lists nothing", async () => {
    tauri = false;
    const request = listFolder("C:\\A", sort);
    await expect(request.done).resolves.toEqual({ items: [], partial: false });
    expect(startListDir).not.toHaveBeenCalled();
  });
});
