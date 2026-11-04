import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShelfCommands,
  runShelfAction,
  startShelfDragOut,
  type ShelfActionHost,
} from "../shelf/shelfActions";
import { startExternalDrag } from "../services/fileops";
import { collectTransferPages, projectTransferMoves } from "../shelf/shelfRefresh";
import type { ShelfItem } from "../services/shelf";
import type { TransferReport } from "../services/transferJobs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));
vi.mock("../services/fileops", () => ({ startExternalDrag: vi.fn(async () => "copy") }));

const invokeMock = vi.mocked(invoke);

function item(id: string, path: string, state: ShelfItem["state"] = "available"): ShelfItem {
  return {
    id,
    source: { kind: "disk", path },
    display_name: path.split("\\").pop() ?? path,
    added_unix: 1,
    state,
    last_checked_unix: 1,
    runtime_sensitive: false,
  };
}

function host(): ShelfActionHost {
  return {
    startTransfer: vi.fn(async () => undefined),
    openBatch: vi.fn(async () => undefined),
    openArchive: vi.fn(async () => undefined),
    share: vi.fn(async () => undefined),
    openGroup: vi.fn(async () => undefined),
    openPrivacy: vi.fn(async () => undefined),
  };
}

function report(items: TransferReport["items"], cursor?: string): TransferReport {
  return {
    report_id: "00000000-0000-4000-8000-000000000010",
    items,
    next_cursor: cursor,
    done: items.filter((entry) => entry.status === "done").length,
    skipped: 0,
    failed: 0,
    cancelled: false,
    job_finished: true,
    complete: !cursor,
  } as TransferReport;
}

beforeEach(() => invokeMock.mockReset());

describe("shelf actions", () => {
  it("every action opens its normal review flow", async () => {
    const selected = [item("00000000-0000-4000-8000-000000000001", "C:\\Shelf\\a.txt")];
    for (const id of ["copy", "move"] as const) {
      const review = host();
      await runShelfAction(id, selected, review);
      expect(review.startTransfer).toHaveBeenCalledTimes(1);
      expect(review.startTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: id,
          sources: ["C:\\Shelf\\a.txt"],
          dest_dir: "C:\\Shelf",
        }),
      );
      expect(review.openArchive).not.toHaveBeenCalled();
    }
    for (const [id, method] of [
      ["compress", "openArchive"],
      ["share", "share"],
      ["convert", "openBatch"],
      ["privacy", "openPrivacy"],
    ] as const) {
      const review = host();
      await runShelfAction(id, selected, review);
      expect(review[method]).toHaveBeenCalledTimes(1);
    }
  });

  it("a missing item is reported and stays in the list", async () => {
    const selected = [item("00000000-0000-4000-8000-000000000002", "C:\\Shelf\\gone.txt", "missing")];
    const before = JSON.stringify(selected);
    const review = host();
    await expect(runShelfAction("copy", selected, review)).rejects.toThrow("shelf.invalid");
    expect(review.startTransfer).not.toHaveBeenCalled();
    expect(JSON.stringify(selected)).toBe(before);
  });

  it("a sensitive virtual item needs a safe-copy route for external actions", async () => {
    const sensitive: ShelfItem = {
      id: "00000000-0000-4000-8000-000000000003",
      source: {
        kind: "virtual",
        provider: "locked",
        container_path: "C:\\Sealed",
        entry_id: "00000000-0000-4000-8000-000000000031",
      },
      display_name: "entry",
      added_unix: 1,
      state: "available",
      runtime_sensitive: true,
    };
    const review = host();
    await expect(runShelfAction("copy", [sensitive], review)).rejects.toThrow("shelf.invalid");
    expect(review.startTransfer).not.toHaveBeenCalled();
    await runShelfAction("open_group", [sensitive], review);
    expect(review.openGroup).toHaveBeenCalledWith([
      {
        kind: "file",
        source: sensitive.source,
      },
    ]);
  });

  it("sensitive external drag is denied without a safe-copy route", async () => {
    const sensitive: ShelfItem = {
      id: "00000000-0000-4000-8000-000000000004",
      source: {
        kind: "virtual",
        provider: "locked",
        container_path: "C:\\Sealed",
        entry_id: "00000000-0000-4000-8000-000000000041",
      },
      display_name: "entry",
      added_unix: 1,
      state: "available",
      runtime_sensitive: true,
    };
    await expect(startShelfDragOut([sensitive])).rejects.toThrow("shelf.sensitive");
    const disk = item("00000000-0000-4000-8000-000000000005", "C:\\Shelf\\a.txt");
    await startShelfDragOut([disk]);
    expect(vi.mocked(startExternalDrag)).toHaveBeenCalledWith(["C:\\Shelf\\a.txt"]);
  });

  it("completed moves update only actual source-removed paths", () => {
    const pages = [
      report([
        {
          item_id: "a",
          from: "C:\\Shelf\\a.txt",
          to: "C:\\Moved\\a.txt",
          status: "done",
          source_removed: true,
          bytes_written: 1,
          verified: true,
          destination_created: true,
        },
        {
          item_id: "b",
          from: "C:\\Shelf\\b.txt",
          to: "C:\\Moved\\b.txt",
          status: "done",
          source_removed: false,
          bytes_written: 1,
          verified: true,
          destination_created: true,
        },
        {
          item_id: "c",
          from: "C:\\Shelf\\c.txt",
          status: "skipped",
          source_removed: false,
          bytes_written: 0,
          verified: false,
          destination_created: false,
        },
      ]),
      report([
        {
          item_id: "d",
          from: "C:\\Shelf\\d.txt",
          to: "C:\\Moved\\d.txt",
          status: "failed",
          source_removed: false,
          bytes_written: 0,
          verified: false,
          destination_created: false,
        },
        {
          item_id: "e",
          from: "C:\\Shelf\\e.txt",
          to: "C:\\Moved\\e.txt",
          status: "cancelled",
          source_removed: false,
          bytes_written: 0,
          verified: false,
          destination_created: false,
        },
      ]),
    ];
    expect(projectTransferMoves("move", pages)).toEqual([
      { from: "C:\\Shelf\\a.txt", to: "C:\\Moved\\a.txt" },
    ]);
    expect(projectTransferMoves("copy", pages)).toEqual([]);
  });

  it("reads every bounded report page", async () => {
    const first = report([], "cursor-1");
    const second = report([
      {
        item_id: "a",
        from: "C:\\Shelf\\a.txt",
        to: "C:\\Moved\\a.txt",
        status: "done",
        source_removed: true,
        bytes_written: 1,
        verified: true,
        destination_created: true,
      },
    ]);
    const page = vi.fn(async () => second);
    const pages = await collectTransferPages(first, page);
    expect(page).toHaveBeenCalledWith("cursor-1");
    expect(projectTransferMoves("move", pages)).toHaveLength(1);
  });

  it("refresh asks only the shelf job and never hydrates a file", async () => {
    const catalog = { schema_version: 1, revision: 2, items: [] };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "job_poll") {
        return {
          progress: { items_done: 0, items_total: 0, bytes_done: 0, bytes_total: 0, current: "" },
          done: true,
          result: catalog,
          error: null,
        };
      }
      return undefined;
    });
    const { refreshShelf } = await import("../services/shelf");
    const job = await refreshShelf([]);
    await job.completion;
    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toContain("shelf_refresh_start");
    expect(commands).not.toContain("fs_stat");
    expect(commands).not.toContain("file_identity");
    expect(commands).not.toContain("thumbnail_lookup");
  });

  it("the shelf menu is a fixed list of ids", () => {
    expect(createShelfCommands().map((command) => command.id)).toEqual([
      "shelf.copy",
      "shelf.move",
      "shelf.compress",
      "shelf.share",
      "shelf.convert",
      "shelf.privacy",
      "shelf.openGroup",
      "shelf.remove",
      "shelf.clear",
    ]);
  });
});
