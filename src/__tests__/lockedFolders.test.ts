import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { readLockedEntry } from "../services/lockedFolders";

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

describe("locked entry ranges", () => {
  it("splits_eight_mib_into_two_protocol_requests_and_releases_both", async () => {
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "locked_entry_grant") {
        return {
          token: String(args.length).padStart(32, "0"),
          length: args.length,
          mime: "application/octet-stream",
          name: "entry.bin",
          size: 8 * 1024 * 1024,
          modified_unix: 1,
          from_internet: false,
          read_only: true,
        };
      }
      return undefined;
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = String(init?.headers && (init.headers as Record<string, string>).Range);
      const match = /bytes=0-(\d+)/.exec(range);
      const length = Number(match?.[1] ?? 0) + 1;
      return {
        ok: true,
        status: 206,
        headers: { get: (_name: string) => `bytes 0-${length - 1}/${length}` },
        arrayBuffer: async () => new Uint8Array(length).fill(7).buffer,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await readLockedEntry(
      "11111111-1111-4111-8111-111111111111",
      "123e4567-e89b-12d3-a456-426614174000",
      0,
      8 * 1024 * 1024,
    );
    expect(bytes.length).toBe(8 * 1024 * 1024);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const grants = invoke.mock.calls.filter((call) => call[0] === "locked_entry_grant");
    expect(grants.map((call) => call[1].offset)).toEqual([0, 4 * 1024 * 1024]);
    const releases = invoke.mock.calls.filter((call) => call[0] === "locked_entry_release");
    expect(releases).toHaveLength(2);
  });

  it("refuses_a_mismatched_content_range", async () => {
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "locked_entry_grant") {
        return {
          token: "a".repeat(32),
          length: args.length,
          mime: "text/plain",
          name: "a.txt",
          size: 5,
          modified_unix: 1,
          from_internet: false,
          read_only: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 206,
        headers: { get: (_name: string) => "bytes 0-4/6" },
        arrayBuffer: async () => new Uint8Array(5).buffer,
      }) as Response),
    );
    await expect(
      readLockedEntry(
        "11111111-1111-4111-8111-111111111111",
        "123e4567-e89b-12d3-a456-426614174000",
        0,
        5,
      ),
    ).rejects.toThrow("locked.changed");
  });
});
