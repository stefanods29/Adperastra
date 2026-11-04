import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeDuplicateCleanup,
  prepareDuplicateCleanup,
  releaseStorageScan,
  resetRetainedScans,
  startStorageScan,
  storagePage,
  type StoragePage,
  type StorageScanRequest,
} from "../services/storage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

const request: StorageScanRequest = {
  root: "C:\\scan",
  allow_network: false,
  include_hidden: false,
  max_entries: 1_000_000,
};

function page(scanId: string, stale = false): StoragePage {
  return {
    summary: {
      scan_id: scanId,
      root: "C:\\scan",
      logical_bytes: 10,
      allocated_unique_bytes: 10,
      unknown_allocated_count: 0,
      files_count: 1,
      folders_count: 1,
      link_count: 0,
      skipped_count: 0,
      coverage: "complete",
      cancelled: false,
      stale,
      generation: 4,
      calculated_unix: 1_700_000_000,
      reason_codes: [],
    },
    nodes: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        parent_id: null,
        key: {
          volume_id: "00000001",
          file_id: "0000000000000001",
          path_key: "c:\\scan\\a.bin",
          stable: true,
        },
        path: "C:\\scan\\a.bin",
        name: "a.bin",
        kind: "file",
        logical_bytes: 10,
        allocated_bytes: 10,
        item_count: 0,
        online_only: false,
        coverage: "complete",
        children_count: 0,
      },
    ],
    next_cursor: null,
    complete: true,
    typed_breakdown: [],
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  resetRetainedScans();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("storage cache", () => {
  it("starts a scan with a literal camelCase request and returns its job", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "storage_scan_start") return "scan-1";
      if (command === "job_poll") {
        return { progress: {}, done: true, result: page("scan-1"), error: null };
      }
      return undefined;
    });
    const handle = await startStorageScan(request);
    expect(handle.scanId).toBe("scan-1");
    expect(invokeMock).toHaveBeenCalledWith("storage_scan_start", {
      requestId: handle.id,
      request,
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.completion).resolves.toEqual(page("scan-1"));
  });

  it("a stale page is passed through marked, never rewritten as current", async () => {
    invokeMock.mockResolvedValue(page("scan-1", true));
    const result = await storagePage("scan-1", null, null);
    expect(result.summary.stale).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("storage_page", {
      scanId: "scan-1",
      parentId: null,
      cursor: null,
    });
  });

  it("four retained scans are the limit; the fifth releases the oldest", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "storage_page") return page("ignored");
      return undefined;
    });
    for (let index = 0; index < 5; index += 1) {
      await storagePage(`scan-${index}`, null, null);
    }
    const releases = invokeMock.mock.calls.filter(
      ([command]) => command === "storage_release",
    );
    expect(releases).toHaveLength(1);
    expect(releases[0][1]).toEqual({ scanId: "scan-0" });
  });

  it("release removes the scan from the retained list", async () => {
    invokeMock.mockResolvedValue(undefined);
    await releaseStorageScan("scan-1");
    expect(invokeMock).toHaveBeenCalledWith("storage_release", { scanId: "scan-1" });
  });

  it("cleanup preparation sends exact selected and keeper keys", async () => {
    const selected = [
      {
        volume_id: "00000001",
        file_id: "0000000000000002",
        path_key: "c:\\scan\\b.bin",
        stable: true,
      },
    ];
    const keepers = [
      {
        volume_id: "00000001",
        file_id: "0000000000000001",
        path_key: "c:\\scan\\a.bin",
        stable: true,
      },
    ];
    invokeMock.mockResolvedValue({
      plan_id: "plan-1",
      scan_id: "scan-1",
      generation: 4,
      selected,
      keepers,
      expires_unix: 1_700_000_300,
    });
    await prepareDuplicateCleanup("scan-1", selected, keepers);
    expect(invokeMock).toHaveBeenCalledWith("duplicates_cleanup_prepare", {
      scanId: "scan-1",
      selected,
      keepers,
    });
  });

  it("a false cleanup capability rejects before any write", async () => {
    invokeMock.mockRejectedValue("storage.cleanup_unavailable");
    await expect(executeDuplicateCleanup("plan-1")).rejects.toBe(
      "storage.cleanup_unavailable",
    );
    expect(invokeMock).toHaveBeenCalledWith("duplicates_cleanup_start", {
      requestId: expect.any(String),
      planId: "plan-1",
    });
  });
});
