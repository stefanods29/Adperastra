import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, newRequestId, runJob } from "../services/jobs";
import type { OpProgress } from "../services/fileops";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

const progress = (itemsDone: number): OpProgress => ({
  items_done: itemsDone,
  items_total: 4,
  bytes_done: 0,
  bytes_total: 0,
  current: "",
});

const poll = (done: boolean, result: unknown = null, error: string | null = null) => ({
  progress: progress(done ? 4 : 1),
  done,
  result,
  error,
});

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shared jobs", () => {
  it("request ids are valid and unique", () => {
    const first = newRequestId("arc");
    const second = newRequestId("arc");
    for (const id of [first, second]) {
      expect(id.startsWith("arc-")).toBe(true);
      expect(id.length).toBeLessThan(64);
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(first).not.toBe(second);
  });

  it("bad prefixes are refused", () => {
    for (const prefix of ["Arc", "", "abcdefghijklm"]) {
      expect(() => newRequestId(prefix)).toThrow("jobs.bad_prefix");
    }
  });

  it("a job resolves with its result", async () => {
    const onProgress = vi.fn();
    let polls = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command !== "job_poll") return undefined;
      polls += 1;
      return polls === 1 ? poll(false) : poll(true, { ok: true });
    });
    const handle = await runJob<{ ok: boolean }>(
      "arc",
      async (requestId) => {
        await invoke("archive_open_start", { requestId, path: "C:\\a.zip" });
      },
      onProgress,
    );
    const completion = handle.completion;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    await expect(completion).resolves.toEqual({ ok: true });
    expect(onProgress).toHaveBeenCalledTimes(2);
    const pollsSeen = invokeMock.mock.calls.filter(([command]) => command === "job_poll");
    expect(pollsSeen).toHaveLength(2);
    expect(pollsSeen[0][1]).toEqual({ requestId: handle.id });
    expect(pollsSeen[1][1]).toEqual({ requestId: handle.id });
  });

  it("a job error rejects", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "job_poll" ? poll(true, null, "archive.corrupt") : undefined,
    );
    const handle = await runJob("arc", async () => undefined);
    const outcome = handle.completion.then(
      () => null,
      (error: Error) => error,
    );
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const error = await outcome;
    expect(error?.message).toBe("archive.corrupt");
  });

  it("cancel asks Rust to stop", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "job_poll" ? poll(true, {}) : undefined,
    );
    const handle = await runJob("arc", async () => undefined);
    await handle.cancel();
    expect(invokeMock).toHaveBeenCalledWith("job_cancel", { requestId: handle.id });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await expect(handle.completion).resolves.toEqual({});
  });
});
