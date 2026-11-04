import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectFileLocks,
  requestProcessClose,
  type FileLockReport,
} from "../services/fileLocks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

const progress = { items_done: 0, items_total: 0, bytes_done: 0, bytes_total: 0, current: "" };
const report: FileLockReport = {
  paths: ["C:\\Docs\\report.txt"],
  processes: [],
  complete: true,
  folder_nonrecursive: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "job_poll") {
      return { progress, done: true, result: report, error: null };
    }
    return undefined;
  });
});

describe("file lock service", () => {
  it("refuses invalid paths before any invoke", async () => {
    await expect(inspectFileLocks([])).rejects.toThrow("locks.failed");
    await expect(inspectFileLocks(["relative.txt"])).rejects.toThrow("locks.failed");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("starts a bounded inspection job with camelCase arguments", async () => {
    const job = await inspectFileLocks(["C:\\Docs\\report.txt"]);
    await job.completion;
    expect(invokeMock).toHaveBeenCalledWith("locks_inspect_start", {
      requestId: expect.any(String),
      paths: ["C:\\Docs\\report.txt"],
    });
  });

  it("refuses an unconfirmed or malformed close before any invoke", async () => {
    await expect(
      requestProcessClose({
        pid: 0,
        start_ticks: "133000000000000000",
        confirmed: true,
      }),
    ).rejects.toThrow("locks.failed");
    await expect(
      requestProcessClose({
        pid: 321,
        start_ticks: "not-ticks",
        confirmed: true,
      }),
    ).rejects.toThrow("locks.failed");
    await expect(
      requestProcessClose({
        pid: 321,
        start_ticks: "133000000000000000",
        confirmed: false,
      }),
    ).rejects.toThrow("locks.denied");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sends the exact fresh identity to the close job", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "job_poll") {
        return {
          progress,
          done: true,
          result: { status: "requested" },
          error: null,
        };
      }
      return undefined;
    });
    const job = await requestProcessClose({
      pid: 321,
      start_ticks: "133000000000000000",
      confirmed: true,
    });
    await job.completion;
    expect(invokeMock).toHaveBeenCalledWith("locks_close_start", {
      requestId: expect.any(String),
      request: {
        pid: 321,
        start_ticks: "133000000000000000",
        confirmed: true,
      },
    });
  });
});
