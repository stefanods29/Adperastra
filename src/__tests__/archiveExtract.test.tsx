import type { TFunction } from "i18next";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { ArchiveExtractReport, ArchiveExtractRequest } from "../services/archive";
import type { ExplorerItem } from "../services/explorer";
import { UndoStack } from "../services/undo";
import type { TrackJob, TrackJobOptions } from "../views/explorer/JobsPanel";
import {
  useArchiveExtract,
  type ArchiveExtract,
  type ArchiveExtractDeps,
} from "../views/explorer/useArchiveExtract";

vi.mock("../services/archive", () => ({
  archiveExtract: vi.fn(),
  archivePickFolder: vi.fn(),
}));

import { archiveExtract, archivePickFolder } from "../services/archive";

const t = i18n.t.bind(i18n) as TFunction;

const item = (path: string): ExplorerItem => ({
  path,
  name: path.split("\\").pop() ?? path,
  kind: "file",
  size: 100,
  modified_unix: 10,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const report = (overrides: Partial<ArchiveExtractReport> = {}): ArchiveExtractReport => ({
  created: [],
  files_written: 0,
  folders_created: 0,
  skipped: [],
  skipped_more: 0,
  cancelled: false,
  opened: null,
  error: null,
  ...overrides,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let api: ArchiveExtract | null = null;
let trackJobMock: ReturnType<typeof vi.fn>;
let deps: ArchiveExtractDeps;

function Probe({ deps: value }: { deps: ArchiveExtractDeps }) {
  api = useArchiveExtract(value);
  return null;
}

beforeEach(async () => {
  vi.mocked(archiveExtract).mockReset();
  vi.mocked(archivePickFolder).mockReset().mockResolvedValue("E:\\X");
  trackJobMock = vi.fn(async (options: unknown) => {
    const job = await (options as TrackJobOptions<ArchiveExtractReport>).start(() => undefined);
    return await job.completion;
  });
  const items = new Map([
    ["C:\\D\\a.zip", item("C:\\D\\a.zip")],
    ["C:\\D\\b.zip", item("C:\\D\\b.zip")],
  ]);
  deps = {
    t,
    trackJob: trackJobMock as unknown as TrackJob,
    undoStack: new UndoStack(),
    touchUndo: vi.fn(),
    notify: vi.fn(),
    notifyAction: vi.fn(),
    notifyError: vi.fn(),
    currentFolder: () => "C:\\D",
    showResult: vi.fn(),
    itemFor: (path) => items.get(path),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe deps={deps} />);
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  api = null;
});

function extractResult(result: ArchiveExtractReport) {
  vi.mocked(archiveExtract).mockResolvedValue({
    id: "arcextract-1",
    cancel: async () => undefined,
    completion: Promise.resolve(result),
  });
}

const requests = () => vi.mocked(archiveExtract).mock.calls.map(([request]) => request as ArchiveExtractRequest);

describe("extracting archives", () => {
  it("extract all makes a folder next to the archive", async () => {
    extractResult(report({ created: ["C:\\D\\a"], files_written: 2 }));
    await act(async () => {
      await api!.extractItems(["C:\\D\\a.zip"], "newFolder");
    });
    const [request] = requests();
    expect(request.dest_dir).toBe("C:\\D");
    expect(request.new_folder).toBe("a");
    const options = trackJobMock.mock.calls[0][0] as TrackJobOptions<ArchiveExtractReport>;
    expect(options.verbKey).toBe("extracting");
    expect(options.count).toBe(1);
    expect(options.reasonArea).toBe("archive");
    const entries = deps.undoStack.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].labelKey).toBe("toast.extracted");
    expect(entries[0].labelArgs?.name).toBe("a.zip");
    expect(entries[0].undo).toEqual({ type: "recycle", paths: ["C:\\D\\a"] });
    expect(entries[0].redo).toEqual({ type: "restore", originals: ["C:\\D\\a"] });
    expect(deps.notifyAction).toHaveBeenCalled();
    expect(deps.showResult).toHaveBeenCalledWith("C:\\D", "C:\\D\\a", false);
  });

  it("Extract to asks for a folder once", async () => {
    extractResult(report({ created: ["E:\\X\\a"] }));
    await act(async () => {
      await api!.extractItems(["C:\\D\\a.zip", "C:\\D\\b.zip"], "to");
    });
    expect(vi.mocked(archivePickFolder)).toHaveBeenCalledOnce();
    const calls = requests();
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.dest_dir).toBe("E:\\X");
    const entries = deps.undoStack.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].labelKey).toBe("toast.extractedMany");
    expect(entries[0].labelArgs?.count).toBe(2);
    expect(deps.showResult).toHaveBeenCalled();
    for (const call of vi.mocked(deps.showResult).mock.calls) {
      expect(call[2]).toBe(true);
    }
  });

  it("a cancelled folder choice extracts nothing", async () => {
    vi.mocked(archivePickFolder).mockResolvedValue(null);
    await act(async () => {
      await api!.extractItems(["C:\\D\\a.zip"], "to");
    });
    expect(archiveExtract).not.toHaveBeenCalled();
    expect(deps.undoStack.entries).toHaveLength(0);
  });

  it("nothing created, no undo", async () => {
    extractResult(report({ skipped: [{ path: "a.txt", reason: "name_taken" }] }));
    await act(async () => {
      await api!.extractItems(["C:\\D\\a.zip"], "newFolder");
    });
    expect(deps.undoStack.entries).toHaveLength(0);
    expect(deps.notify).toHaveBeenCalledWith(
      t("jobs.skippedItems", { count: 1 }),
    );
  });

  it("a failure after creating items keeps Undo", async () => {
    extractResult(report({ created: ["C:\\D\\a"], error: "archive.helper_failed" }));
    await act(async () => {
      await api!.extractItems(["C:\\D\\a.zip"], "newFolder");
    });
    expect(deps.undoStack.entries).toHaveLength(1);
    expect(deps.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "archive.helper_failed" }),
      "archive",
    );
  });
});
