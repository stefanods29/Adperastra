import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS } from "../services/jobs";
import { archiveExtract, archiveFolder, archiveOpen } from "../services/archive";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);
const progress = { items_done: 0, items_total: 1, bytes_done: 0, bytes_total: 0, current: "" };
const poll = (done: boolean, result: unknown = null, error: string | null = null) => ({ progress, done, result, error });
const summary = {
  session: "arcopen-1-1",
  format: "zip",
  files: 1,
  folders: 0,
  links: 0,
  encrypted_entries: 1,
  hidden_entries: 0,
  total_size: 3,
  packed_size: 3,
  partial: false,
  temporary: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe("archive services", () => {
  it("auth is optional and sent only to start commands", async () => {
    invokeMock.mockImplementation(async (command: string) => command === "job_poll" ? poll(true, summary) : undefined);
    await archiveOpen("C:\\a.zip");
    const plain = invokeMock.mock.calls.find(([command]) => command === "archive_open_start");
    expect(plain?.[1]).toMatchObject({ path: "C:\\a.zip", auth: null });

    invokeMock.mockClear();
    invokeMock.mockImplementation(async (command: string) => command === "job_poll" ? poll(true, summary) : undefined);
    await archiveOpen("C:\\a.zip", undefined, { password: "secret phrase", remember_session: true });
    const withAuth = invokeMock.mock.calls.find(([command]) => command === "archive_open_start");
    expect(withAuth?.[1]).toMatchObject({ auth: { password: "secret phrase", remember_session: true } });

    invokeMock.mockClear();
    invokeMock.mockResolvedValueOnce({ items: [], total: 0, truncated: false });
    await archiveFolder("arcopen-1-1", "", "name", "ascending");
    const folderCall = invokeMock.mock.calls.find(([command]) => command === "archive_folder");
    expect(folderCall?.[1]).not.toHaveProperty("auth");

    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "job_poll" ? poll(true, { created: [], skipped: [], cancelled: false, error: null, files_written: 0, folders_created: 0, skipped_more: 0, opened: null }) : undefined);
    await archiveExtract(
      { archive: "C:\\a.zip", paths: [], base: "", dest_dir: "C:\\Out", new_folder: null, expected_size: 3, expected_modified: 0 },
      undefined,
      { password: "secret phrase", remember_session: false },
    );
    const extractCall = invokeMock.mock.calls.find(([command]) => command === "archive_extract_start");
    expect(extractCall?.[1]).toMatchObject({ auth: { password: "secret phrase", remember_session: false } });
  });

  it("passwords are absent from results and errors", async () => {
    invokeMock.mockImplementation(async (command: string) => command === "job_poll" ? poll(true, summary) : undefined);
    const result = await archiveOpen("C:\\a.zip", undefined, { password: "secret phrase", remember_session: true });
    expect(Object.keys(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("secret phrase");

    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => command === "job_poll" ? poll(true, null, "archive.bad_password") : undefined);
    const error = await archiveOpen("C:\\a.zip", undefined, { password: "secret phrase", remember_session: false })
      .then(() => null, (reason: Error) => reason);
    expect(error?.message).toBe("archive.bad_password");
    expect(error?.message).not.toContain("secret phrase");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  });
});
