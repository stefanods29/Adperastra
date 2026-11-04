import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFolderSizeBatcher,
  mergeFolderSizeBatch,
  onFolderSize,
  releaseFolderSize,
  requestFolderSize,
  type FolderSizeDisplayState,
  type FolderSizeValue,
} from "../services/folderSizes";
import { compareSizeValues, resortAllowed } from "../views/explorer/folderSizeSort";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

function value(path: string, state: FolderSizeValue["state"], bytes: number | null): FolderSizeValue {
  return {
    key: {
      volume_id: "00000001",
      file_id: "0000000000000001",
      path_key: path.toLowerCase(),
      stable: false,
    },
    state,
    logical_bytes: bytes,
    item_count: bytes === null ? null : 1,
    calculated_unix: bytes === null ? null : 1_700_000_000,
    generation: 4,
    reason_code: state === "unavailable" ? "folder_size.unavailable" : null,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("folder sizes", () => {
  it("requests a folder with the exact consumer object", async () => {
    const reply = value("C:\\a", "pending", null);
    invokeMock.mockResolvedValue(reply);
    const consumer = {
      consumer_id: "11111111-1111-4111-8111-111111111111",
      path: "C:\\a",
      priority: "visible" as const,
    };
    await expect(requestFolderSize(consumer)).resolves.toEqual(reply);
    expect(invokeMock).toHaveBeenCalledWith("folder_size_request", { consumer });
  });

  it("releases a consumer idempotently through the native command", async () => {
    invokeMock.mockResolvedValue(undefined);
    await releaseFolderSize("11111111-1111-4111-8111-111111111111");
    await releaseFolderSize("11111111-1111-4111-8111-111111111111");
    expect(invokeMock).toHaveBeenCalledWith("folder_size_release", {
      consumerId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("listens only on the folder-size event", async () => {
    listenMock.mockResolvedValue(() => undefined);
    await onFolderSize(() => undefined);
    expect(listenMock).toHaveBeenCalledWith("folder-size", expect.any(Function));
  });

  it("unknown and partial folders sort last in both directions", () => {
    const known = {
      path: "C:\\known",
      file_bytes: 0,
      is_folder: true,
      folder_size: value("C:\\known", "ready", 100),
    };
    const pending = {
      path: "C:\\pending",
      file_bytes: 0,
      is_folder: true,
      folder_size: value("C:\\pending", "pending", null),
    };
    const partial = {
      path: "C:\\partial",
      file_bytes: 0,
      is_folder: true,
      folder_size: value("C:\\partial", "partial", 10),
    };
    for (const direction of ["ascending", "descending"] as const) {
      expect(compareSizeValues(known, pending, direction)).toBeLessThan(0);
      expect(compareSizeValues(partial, known, direction)).toBeGreaterThan(0);
      // Both unknown: the existing name order decides, regardless of direction.
      expect(compareSizeValues(pending, partial, direction)).toBeGreaterThan(0);
    }
  });

  it("applies the direction only to the numeric part", () => {
    const small = {
      path: "C:\\a",
      file_bytes: 10,
      is_folder: false,
      folder_size: null,
    };
    const large = {
      path: "C:\\b",
      file_bytes: 20,
      is_folder: false,
      folder_size: null,
    };
    expect(compareSizeValues(small, large, "ascending")).toBeLessThan(0);
    expect(compareSizeValues(small, large, "descending")).toBeGreaterThan(0);
  });

  it("two folders never share a wrong result", () => {
    const state = {
      values: new Map<string, FolderSizeValue>(),
      selection: new Set<string>(),
      anchor: null,
      scrollTop: 0,
    };
    const merged = mergeFolderSizeBatch(state, [
      value("C:\\a", "ready", 10),
      value("C:\\b", "ready", 20),
    ]);
    expect(merged.values.size).toBe(2);
    expect(merged.values.get("00000001:0000000000000001:c:\\a")?.logical_bytes).toBe(10);
    expect(merged.values.get("00000001:0000000000000001:c:\\b")?.logical_bytes).toBe(20);
  });

  it("a 100 ms batch preserves selection, anchor and scroll position", () => {
    vi.useFakeTimers();
    const selection = new Set(["C:\\selected"]);
    let state: FolderSizeDisplayState<Set<string>, string | null> = {
      values: new Map(),
      selection,
      anchor: "C:\\selected",
      scrollTop: 240,
    };
    const apply = vi.fn((next: typeof state) => {
      state = next;
    });
    const batcher = createFolderSizeBatcher(() => state, apply, 100);
    batcher.push(value("C:\\a", "ready", 10));
    batcher.push(value("C:\\b", "ready", 20));
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledTimes(1);
    const next = apply.mock.calls[0][0];
    expect(next.selection).toBe(selection);
    expect(next.anchor).toBe("C:\\selected");
    expect(next.scrollTop).toBe(240);
    expect(next.values.size).toBe(2);
    batcher.dispose();
  });

  it("an inline rename freezes the asynchronous resort", () => {
    expect(resortAllowed("C:\\renaming.txt")).toBe(false);
    expect(resortAllowed(null)).toBe(true);
  });
});
