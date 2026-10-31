import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS } from "../services/jobs";
import { emptyTemplateList, templateCreate, templatesList } from "../services/templates";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);
const progress = {
  items_done: 0,
  items_total: 1,
  bytes_done: 1024,
  bytes_total: 4096,
  current: "Letter.docx",
};
const poll = (done: boolean, result: unknown = null, error: string | null = null) => ({ progress, done, result, error });

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe("template services", () => {
  it("propagates catalog errors and partial-listing details", async () => {
    invokeMock.mockRejectedValueOnce("templates.access_denied");
    await expect(templatesList("en")).rejects.toBe("templates.access_denied");
    const list = { ...emptyTemplateList(), user_error: "templates.access_denied", user_skipped: 3 };
    invokeMock.mockResolvedValueOnce(list);
    await expect(templatesList("en")).resolves.toEqual(list);
  });

  it("copies through a shared job and returns the created path with byte progress", async () => {
    const onProgress = vi.fn();
    invokeMock.mockImplementation(async (command: string) => command === "job_poll" ? poll(true, "C:\\Output\\Letter.docx") : undefined);
    const controller = new AbortController();
    await expect(templateCreate("C:\\Templates\\letter.docx", "C:\\Output", "Letter.docx", {
      signal: controller.signal,
      onProgress,
    })).resolves.toBe("C:\\Output\\Letter.docx");
    const started = invokeMock.mock.calls.find(([command]) => command === "template_create_start");
    expect(started).toEqual(["template_create_start", {
      requestId: expect.stringMatching(/^template-[a-z0-9]+-\d+$/),
      request: {
        template_path: "C:\\Templates\\letter.docx",
        dest_dir: "C:\\Output",
        name: "Letter.docx",
      },
    }]);
    expect(onProgress).toHaveBeenCalledWith(progress);
    expect(invokeMock.mock.calls.some(([command]) => command === "template_create")).toBe(false);
    controller.abort();
    expect(invokeMock.mock.calls.some(([command]) => command === "job_cancel")).toBe(false);
  });

  it("does not start a copy with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(templateCreate("C:\\Templates\\a.txt", "C:\\Output", "a.txt", { signal: controller.signal }))
      .rejects.toThrow("templates.cancelled");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("an abort asks the shared job to cancel and propagates its cancellation error", async () => {
    let cancelled = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "job_cancel") cancelled = true;
      if (command === "job_poll") return poll(cancelled, null, cancelled ? "templates.cancelled" : null);
      return undefined;
    });
    const controller = new AbortController();
    const outcome = templateCreate("C:\\Templates\\a.txt", "C:\\Output", "a.txt", { signal: controller.signal })
      .then(() => null, (error: Error) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    controller.abort();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect((await outcome)?.message).toBe("templates.cancelled");
    const started = invokeMock.mock.calls.find(([command]) => command === "template_create_start")!;
    const requestId = (started[1] as { requestId: string }).requestId;
    expect(invokeMock.mock.calls.filter(([command]) => command === "job_cancel")).toEqual([["job_cancel", { requestId }]]);
  });

  it("still cancels when the signal aborts before the start command returns", async () => {
    let finishStart!: () => void;
    let cancelled = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "template_create_start") await new Promise<void>((resolve) => { finishStart = resolve; });
      if (command === "job_cancel") cancelled = true;
      if (command === "job_poll") return poll(cancelled, null, cancelled ? "templates.cancelled" : null);
      return undefined;
    });
    const controller = new AbortController();
    const outcome = templateCreate("C:\\Templates\\a.txt", "C:\\Output", "a.txt", { signal: controller.signal })
      .then(() => null, (error: Error) => error);
    controller.abort();
    finishStart();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect((await outcome)?.message).toBe("templates.cancelled");
    expect(invokeMock.mock.calls.filter(([command]) => command === "job_cancel")).toHaveLength(1);
  });
});
