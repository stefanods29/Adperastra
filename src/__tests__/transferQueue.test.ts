import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFLICT_CHOICES,
  REPLACE_AVAILABLE,
  controlTransfer,
  decideTransfer,
  getTransferState,
  initialAction,
  isActionAllowed,
  normalizeRequest,
  startTransfer,
  transferReportPage,
  type TransferDecisionRequest,
} from "../services/transferJobs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

const report = {
  report_id: "r1",
  transfer_id: null,
  items: [],
  next_cursor: null,
  done: 1,
  skipped: 0,
  failed: 0,
  cancelled: false,
  job_finished: true,
  complete: true,
  replace_available: false,
};

const poll = (done: boolean, result: unknown = null, error: string | null = null) => ({
  progress: { items_done: 0, items_total: 1, bytes_done: 0, bytes_total: 0, current: "" },
  done,
  result,
  error,
});

const decisionRequest = (
  overrides: Partial<TransferDecisionRequest> = {},
): TransferDecisionRequest => ({
  decision_id: "11111111-1111-4111-8111-111111111111",
  item_id: "22222222-2222-4222-8222-222222222222",
  kind: "conflict",
  source_path: "C:\\A\\report.txt",
  target_path: "C:\\B\\report.txt",
  source: null,
  target: null,
  source_kind: "file",
  target_kind: "file",
  error_code: null,
  attempt: 0,
  allowed: ["skip", "keepBoth", "cancel"],
  replace_available: false,
  ...overrides,
});

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the transfer request", () => {
  it("never offers Replace", () => {
    expect(REPLACE_AVAILABLE).toBe(false);
    expect(CONFLICT_CHOICES).toEqual(["skip", "keepBoth", "merge"]);
    expect(() => normalizeRequest({
      kind: "copy",
      sources: ["C:\\A\\a.txt"],
      dest_dir: "C:\\B",
      conflict: "replace" as never,
    })).toThrow("ops.replace_unavailable");
    expect(() => normalizeRequest({
      kind: "copy",
      sources: ["C:\\A\\a.txt"],
      dest_dir: "C:\\B",
      conflict: "replaceIfNewer" as never,
    })).toThrow("ops.replace_unavailable");
  });

  it("keeps reviewed sources one to one with the sources", () => {
    const stamp = {
      path_key: "C:\\A\\a.txt",
      volume_id: "1a2b3c4d",
      file_id: "00000000000000ff",
      modified_ticks: "133500000000000000",
      size_bytes: 4,
    };
    expect(() =>
      normalizeRequest({
        kind: "copy",
        sources: ["C:\\A\\a.txt", "C:\\A\\b.txt"],
        expected_sources: [stamp],
        dest_dir: "C:\\B",
      }),
    ).toThrow("ops.invalid_request");
    const ok = normalizeRequest({
      kind: "copy",
      sources: ["C:\\A\\a.txt"],
      expected_sources: [stamp],
      dest_dir: "C:\\B",
    });
    expect(ok.expected_sources).toHaveLength(1);
    expect(ok.conflict).toBe("skip");
    expect(ok.verify).toBeNull();
    expect(ok.priority).toBe("normal");
  });

  it("sends the literal camelCase arguments and snake_case fields", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "job_poll" ? poll(true, report) : undefined,
    );
    const handle = await startTransfer({
      kind: "move",
      sources: ["C:\\A\\a.txt"],
      dest_dir: "C:\\B",
      conflict: "keepBoth",
      verify: true,
      priority: "foreground",
    });
    const start = invokeMock.mock.calls.find(([command]) => command === "transfer_start");
    expect(start?.[1]).toEqual({
      requestId: handle.id,
      request: {
        kind: "move",
        sources: ["C:\\A\\a.txt"],
        expected_sources: null,
        dest_dir: "C:\\B",
        conflict: "keepBoth",
        verify: true,
        allow_system: false,
        priority: "foreground",
      },
    });
    await vi.advanceTimersByTimeAsync(200);
    await expect(handle.completion).resolves.toEqual(report);
  });

  it("passes a refusal straight through", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "transfer_start") throw "ops.queue_full";
      return undefined;
    });
    await expect(
      startTransfer({ kind: "copy", sources: ["C:\\A\\a.txt"], dest_dir: "C:\\B" }),
    ).rejects.toBe("ops.queue_full");
  });
});

describe("transfer commands", () => {
  it("uses the exact command names and argument keys", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "transfer_report_page") return report;
      return {
        job_id: "job-1",
        state: "running",
        progress: { items_done: 0, items_total: 1, bytes_done: 0, bytes_total: 0, current: "" },
        bytes_per_second: null,
        eta_seconds: null,
        current_item_id: null,
        decision: null,
        generation: 3,
      };
    });
    await getTransferState("job-1");
    expect(invokeMock).toHaveBeenCalledWith("transfer_state", { jobId: "job-1" });
    await controlTransfer("job-1", { action: "pause", expected_generation: 3 });
    expect(invokeMock).toHaveBeenCalledWith("transfer_control", {
      jobId: "job-1",
      control: { action: "pause", expected_generation: 3 },
    });
    await decideTransfer("job-1", {
      decision_id: "11111111-1111-4111-8111-111111111111",
      generation: 3,
      action: "keepBoth",
      apply_to_all: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("transfer_decide", {
      jobId: "job-1",
      decision: {
        decision_id: "11111111-1111-4111-8111-111111111111",
        generation: 3,
        action: "keepBoth",
        apply_to_all: false,
      },
    });
    const page = await transferReportPage("33333333-3333-4333-8333-333333333333");
    expect(invokeMock).toHaveBeenCalledWith("transfer_report_page", {
      cursor: "33333333-3333-4333-8333-333333333333",
    });
    expect(page.next_cursor).toBeNull();
  });
});

describe("conflict actions", () => {
  it("focuses the first safe action, never Cancel", () => {
    expect(initialAction(decisionRequest())).toBe("skip");
    expect(initialAction(decisionRequest({ allowed: ["retry", "skip", "cancel"] }))).toBe("retry");
    expect(initialAction(decisionRequest({ allowed: ["cancel"] }))).toBeNull();
    expect(isActionAllowed(decisionRequest(), "merge")).toBe(false);
    expect(isActionAllowed(decisionRequest(), "keepBoth")).toBe(true);
  });
});
