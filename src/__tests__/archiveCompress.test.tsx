import type { TFunction } from "i18next";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompressDialog from "../archive/CompressDialog";
import {
  defaultCreateName,
  nameProblem,
  withFormatExtension,
} from "../archive/compressNames";
import { createExplorerCommands, type ExplorerActions } from "../commands/explorerCommands";
import type { CommandContext } from "../commands/registry";
import i18n from "../i18n";
import type { ArchiveCreateReport, ArchiveCreateRequest } from "../services/archiveCreate";
import { UndoStack } from "../services/undo";
import type { TrackJob, TrackJobOptions } from "../views/explorer/JobsPanel";
import { useArchiveCreate } from "../views/explorer/useArchiveCreate";

vi.mock("../services/archive", () => ({
  archivePickFolder: vi.fn().mockResolvedValue(null),
}));
vi.mock("../services/archiveCreate", () => ({
  archiveCreate: vi.fn(),
}));

import { archiveCreate } from "../services/archiveCreate";

const t = i18n.t.bind(i18n) as TFunction;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => {
    root?.render(node);
  });
}

function actions(): ExplorerActions {
  return new Proxy({}, { get: () => () => undefined }) as ExplorerActions;
}

function context(overrides: Partial<CommandContext>): CommandContext {
  return {
    location: "folder",
    currentPath: "C:\\Data",
    selection: { count: 0, files: 0, folders: 0, bytes: 0, paths: [] },
    ...overrides,
  } as CommandContext;
}

const selection = (paths: string[]) =>
  ({
    count: paths.length,
    files: paths.length,
    folders: 0,
    bytes: 0,
    paths,
  }) as CommandContext["selection"];

describe("compress to", () => {
  it("compression needs a real nonempty disk selection", () => {
    const command = createExplorerCommands(actions()).find(
      (entry) => entry.id === "explorer.compressTo",
    )!;
    expect(command.visibleWhen!(context({ location: "home" }))).toBe(false);
    expect(command.enabledWhen!(context({ location: "home" }))).toBe(false);
    expect(command.enabledWhen!(context({ selection: selection([]) }))).toBe(false);
    expect(
      command.enabledWhen!(context({ selection: selection(["C:\\Data\\a.txt"]) })),
    ).toBe(true);
    expect(command.labelKey).toBe("commands.compressTo");
    expect(command.helpSlug).toBe("creating-archives");
    expect(command.shortcut).toBeUndefined();
  });

  it("name follows the chosen format without discarding custom text", () => {
    expect(defaultCreateName(["C:\\D\\notes.txt"], "zip", "Archive")).toBe("notes.zip");
    expect(defaultCreateName(["C:\\D\\photos"], "seven_z", "Archive")).toBe("photos.7z");
    expect(defaultCreateName(["C:\\D\\a.txt", "C:\\D\\b.txt"], "zip", "Archive")).toBe(
      "Archive.zip",
    );
    expect(withFormatExtension("notes.zip", "zip", "seven_z")).toBe("notes.7z");
    expect(withFormatExtension("my notes", "zip", "seven_z")).toBe("my notes");
    expect(nameProblem("my notes", "seven_z")).toBe("extension");
    expect(nameProblem("my notes.7z", "seven_z")).toBeNull();
    expect(nameProblem("a/b.zip", "zip")).toBe("invalid");
    expect(nameProblem("CON.zip", "zip")).toBe("invalid");
  });

  it("ZipCrypto is an explicit warned choice", async () => {
    await render(
      <CompressDialog
        sources={["C:\\Data\\a.txt"]}
        initialFolder="C:\\Data"
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const encryption = container?.querySelector<HTMLSelectElement>("#adp-create-encryption")!;
    expect(encryption.value).toBe("none");
    await act(async () => {
      encryption.value = "zip_crypto";
      encryption.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container?.textContent).toContain(t("archive.zipCryptoWarning"));
  });

  it("none clears secrets and 7z encryption enables names", async () => {
    await render(
      <CompressDialog
        sources={["C:\\Data\\a.txt"]}
        initialFolder="C:\\Data"
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const format = container?.querySelector<HTMLSelectElement>("#adp-create-format")!;
    const encryption = container?.querySelector<HTMLSelectElement>("#adp-create-encryption")!;
    await act(async () => {
      format.value = "seven_z";
      format.dispatchEvent(new Event("change", { bubbles: true }));
      encryption.value = "aes256";
      encryption.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const secret = container?.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
        .set!.call(secret, "synthetic passphrase");
      secret.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container?.querySelectorAll('input[type="password"]').length).toBe(2);
    expect(
      [...(container?.querySelectorAll("label") ?? [])].some((label) =>
        label.textContent?.includes(t("archive.encryptNames")),
      ),
    ).toBe(true);

    const encryptionNow = container?.querySelector<HTMLSelectElement>("#adp-create-encryption")!;
    await act(async () => {
      encryptionNow.value = "none";
      encryptionNow.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container?.querySelectorAll('input[type="password"]').length).toBe(0);
  });

  it("start errors keep the dialog and duplicate clicks do not launch twice", async () => {
    let reject!: (error: Error) => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    await render(
      <CompressDialog
        sources={["C:\\Data\\a.txt"]}
        initialFolder="C:\\Data"
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );
    const create = [...(container?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === t("archive.create"),
    ) as HTMLButtonElement;
    await act(async () => {
      create.click();
      create.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("archive.create_busy")));
    expect(container?.textContent).toContain(t("errors.archive.create_busy"));
    expect(container?.textContent).toContain(t("archive.createTitle"));
  });
});

describe("creating an archive", () => {
  const request: ArchiveCreateRequest = {
    sources: ["C:\\Data\\a.txt"],
    dest_dir: "C:\\Data",
    file_name: "a.zip",
    format: "zip",
    encryption: "none",
    password: null,
    encrypt_names: false,
  };
  const report = (overrides: Partial<ArchiveCreateReport> = {}): ArchiveCreateReport => ({
    created: [],
    files_written: 0,
    folders_written: 0,
    source_bytes: 0,
    archive_size: 0,
    skipped: [],
    skipped_more: 0,
    cancelled: false,
    error: null,
    ...overrides,
  });

  function setup(result: ArchiveCreateReport) {
    vi.mocked(archiveCreate).mockResolvedValue({
      id: "arccreate-1",
      cancel: async () => undefined,
      completion: Promise.resolve(result),
    });
    const deps = {
      t,
      trackJob: (async (options: TrackJobOptions<ArchiveCreateReport>) => {
        const job = await options.start(() => undefined);
        return await job.completion;
      }) as TrackJob,
      undoStack: new UndoStack(),
      touchUndo: vi.fn(),
      notify: vi.fn(),
      notifyAction: vi.fn(),
      notifyError: vi.fn(),
      showResult: vi.fn(),
      currentFolder: () => "C:\\Data",
    };
    let api: ReturnType<typeof useArchiveCreate> | null = null;
    function Probe() {
      api = useArchiveCreate(deps);
      return null;
    }
    return { deps, run: async () => {
      await render(<Probe />);
      await act(async () => {
        await api!.create(request);
      });
    } };
  }

  it("completed creation records exact Undo and selection", async () => {
    const { deps, run } = setup(
      report({ created: ["C:\\Data\\a.zip"], files_written: 2, archive_size: 10 }),
    );
    await run();
    const entries = deps.undoStack.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].labelKey).toBe("toast.archiveCreated");
    expect(entries[0].undo).toEqual({ type: "recycle", paths: ["C:\\Data\\a.zip"] });
    expect(entries[0].redo).toEqual({ type: "restore", originals: ["C:\\Data\\a.zip"] });
    expect(deps.showResult).toHaveBeenCalledWith("C:\\Data", "C:\\Data\\a.zip", false);
    expect(deps.notifyAction).toHaveBeenCalled();
  });

  it("cancelled and failed creation do not offer false Undo", async () => {
    const cancelled = setup(report({ cancelled: true }));
    await cancelled.run();
    expect(cancelled.deps.undoStack.entries).toHaveLength(0);
    expect(cancelled.deps.notify).toHaveBeenCalledWith(t("jobs.cancelled"));

    const failed = setup(report({ error: "archive.output_changed" }));
    await failed.run();
    expect(failed.deps.undoStack.entries).toHaveLength(0);
    expect(failed.deps.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "archive.output_changed" }),
      "archive",
    );

    vi.mocked(archiveCreate).mockRejectedValue("archive.create_busy");
    const rejected = setup(report());
    await expect(rejected.run()).rejects.toBe("archive.create_busy");
    expect(rejected.deps.notifyError).toHaveBeenCalled();
  });
});
