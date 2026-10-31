import { describe, expect, it, vi } from "vitest";

vi.mock("../services/jobs", () => ({ runJob: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { runJob } from "../services/jobs";
import { jsonClose, jsonOpen } from "../services/jsonView";
import { tableClose, tableOpen } from "../services/tableView";

function mockJob(result: unknown): void {
  vi.mocked(runJob).mockResolvedValueOnce({
    id: "job",
    cancel: async () => undefined,
    completion: Promise.resolve(result),
  } as never);
}

function mockFailedJob(error: Error): void {
  vi.mocked(runJob).mockResolvedValueOnce({
    id: "job",
    cancel: async () => undefined,
    completion: Promise.reject(error),
  } as never);
}

describe("data services", () => {
  it("table services use job prefixes", async () => {
    mockJob({
      session: "s1",
      columns: 2,
      rows: 3,
      truncated: false,
      delimiter: ",",
      encoding: "utf8",
      has_header: true,
      headers: ["a", "b"],
    });
    await tableOpen("C:\\a.csv");
    expect(vi.mocked(runJob).mock.calls[0][0]).toBe("tblopen");
  });

  it("invalid JSON splits line and column", async () => {
    mockFailedJob(new Error("data.invalid:3:9"));
    const handle = await jsonOpen("C:\\a.json");
    await expect(handle.completion).rejects.toMatchObject({
      message: "data.invalid",
      line: 3,
      column: 9,
    });
    expect(vi.mocked(runJob).mock.calls[0][0]).toBe("jsonopen");
  });

  it("close ignores errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("table.no_session"));
    await expect(tableClose("s")).resolves.toBeUndefined();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("json.no_session"));
    await expect(jsonClose("s")).resolves.toBeUndefined();
  });
});
