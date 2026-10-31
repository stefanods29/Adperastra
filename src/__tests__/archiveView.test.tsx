import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import ArchiveView from "../handlers/archive/ArchiveView";
import type { HandlerViewProps } from "../handlers/types";
import type { ArchiveFolderPage, ArchiveItem, ArchiveSummary } from "../services/archive";
import type { FileTypeInfo } from "../services/files";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: index * opts.estimateSize(index),
        key: index,
      })),
    scrollToIndex: () => undefined,
  }),
}));

vi.mock("../services/archive", () => ({
  archiveOpen: vi.fn(),
  archiveFolder: vi.fn(),
  archiveSearch: vi.fn(),
  archiveClose: vi.fn(),
  archiveOpenEntry: vi.fn(),
  archivePickFolder: vi.fn(),
  archiveExtract: vi.fn(),
}));

import {
  archiveClose,
  archiveFolder,
  archiveOpen,
  archiveOpenEntry,
  archivePickFolder,
  archiveSearch,
} from "../services/archive";

const info: FileTypeInfo = {
  path: "C:\\D\\sample.zip",
  name: "sample.zip",
  ext: "zip",
  mime: "application/zip",
  size: 1000,
  modified_unix: 50,
  online_only: false,
  read_only: false,
  from_internet: false,
};

const summary: ArchiveSummary = {
  session: "s1",
  format: "zip",
  files: 2,
  folders: 1,
  links: 0,
  encrypted_entries: 0,
  hidden_entries: 0,
  total_size: 12,
  packed_size: 8,
  partial: false,
  temporary: false,
};

const docsItem: ArchiveItem = {
  path: "docs",
  name: "docs",
  kind: "folder",
  size: 0,
  packed_size: 0,
  modified_unix: 0,
  encrypted: false,
};

const readmeItem: ArchiveItem = {
  path: "README.txt",
  name: "README.txt",
  kind: "file",
  size: 1000,
  packed_size: 600,
  modified_unix: 50,
  encrypted: false,
};

const planItem: ArchiveItem = {
  path: "docs/plan.md",
  name: "plan.md",
  kind: "file",
  size: 7,
  packed_size: 4,
  modified_unix: 40,
  encrypted: false,
};

const page = (items: ArchiveItem[]): ArchiveFolderPage => ({
  items,
  total: items.length,
  truncated: false,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.mocked(archiveOpen).mockResolvedValue({
    id: "arcopen-1",
    cancel: async () => undefined,
    completion: Promise.resolve(summary),
  });
  vi.mocked(archiveFolder).mockImplementation(async (_session, folder) =>
    folder === "docs" ? page([planItem]) : page([docsItem, readmeItem]),
  );
  vi.mocked(archiveSearch).mockResolvedValue(page([planItem, readmeItem]));
  vi.mocked(archiveClose).mockResolvedValue(undefined);
  vi.mocked(archiveOpenEntry).mockResolvedValue({
    id: "arcentry-1",
    cancel: async () => undefined,
    completion: Promise.resolve({ path: "C:\\Data\\archive-open\\r1\\README.txt" }),
  });
  vi.mocked(archivePickFolder).mockResolvedValue("C:\\Out");
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

async function flush() {
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(
  overrides: Partial<HandlerViewProps> = {},
  openSummary: ArchiveSummary | null = summary,
) {
  // `null` leaves the open behaviour set by the test (for example a failure).
  if (openSummary) {
    vi.mocked(archiveOpen).mockResolvedValue({
      id: "arcopen-1",
      cancel: async () => undefined,
      completion: Promise.resolve(openSummary),
    });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: HandlerViewProps = {
    info,
    url: "",
    active: true,
    savedState: null,
    onStateChange: () => undefined,
    onStatus: () => undefined,
    onOpenInWindowsApp: vi.fn(),
    find: { text: "", request: 0, backwards: false },
    protectedView: false,
    onOpenFile: vi.fn(async () => undefined),
    onExtractArchive: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root?.render(<ArchiveView {...props} />);
  });
  await flush();
  return props;
}

const rows = () => [...container!.querySelectorAll<HTMLElement>("[role='option']")];
const rowText = () => rows().map((row) => row.textContent ?? "");

/** A ribbon button, found by its translated label. */
function ribbonButton(key: string): HTMLButtonElement {
  const label = i18n.t(key);
  for (const button of container!.querySelectorAll<HTMLButtonElement>(".adp-ribbon-btn")) {
    if (button.getAttribute("aria-label") === label) return button;
  }
  throw new Error(`no ribbon button for ${key}`);
}

describe("the archive tab", () => {
  it("lists the root of the archive", async () => {
    await render();
    expect(rowText().join(" ")).toContain("docs");
    expect(rowText().join(" ")).toContain("README.txt");
    expect(container!.querySelector(".adp-breadcrumb")?.textContent).toBe("sample.zip");
    expect(vi.mocked(archiveFolder)).toHaveBeenCalledWith("s1", "", "name", "ascending");
  });

  it("opens a folder and goes back up", async () => {
    await render();
    await act(async () => {
      rows()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(vi.mocked(archiveFolder)).toHaveBeenCalledWith("s1", "docs", "name", "ascending");
    expect(rowText().join(" ")).toContain("plan.md");
    expect(container!.querySelector(".adp-breadcrumb")?.textContent).toBe("sample.zipdocs");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    await flush();
    expect(vi.mocked(archiveFolder)).toHaveBeenCalledWith("s1", "", "name", "ascending");
  });

  it("searches the whole archive", async () => {
    await render({ find: { text: "plan", request: 0, backwards: false } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await flush();
    expect(vi.mocked(archiveSearch)).toHaveBeenCalledWith("s1", "plan");
    expect(rowText().join(" ")).toContain("plan.md");
    expect(container!.textContent).toContain("Matches in the whole archive");
  });

  it("opens a file in a new tab", async () => {
    const props = await render();
    const readme = rows().find((row) => (row.textContent ?? "").includes("README.txt"))!;
    await act(async () => {
      readme.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(vi.mocked(archiveOpenEntry)).toHaveBeenCalledWith(
      {
        archive: "C:\\D\\sample.zip",
        inner_path: "README.txt",
        expected_size: 1000,
        expected_modified: 50,
      },
      expect.any(Function),
    );
    expect(props.onOpenFile).toHaveBeenCalledWith("C:\\Data\\archive-open\\r1\\README.txt");
  });

  it("extract all hands the request to the Explorer", async () => {
    const props = await render();
    const button = ribbonButton("archive.extractAll");
    await act(async () => {
      button.click();
    });
    await flush();
    expect(props.onExtractArchive).toHaveBeenCalledWith({
      archive: "C:\\D\\sample.zip",
      paths: [],
      base: "",
      dest_dir: "C:\\D",
      new_folder: "sample",
      expected_size: 1000,
      expected_modified: 50,
    });
  });

  it("extract selected asks for a folder", async () => {
    const props = await render();
    const readme = rows().find((row) => (row.textContent ?? "").includes("README.txt"))!;
    await act(async () => {
      readme.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    const button = ribbonButton("archive.extractSelected");
    await act(async () => {
      button.click();
    });
    await flush();
    expect(props.onExtractArchive).toHaveBeenCalledWith({
      archive: "C:\\D\\sample.zip",
      paths: ["README.txt"],
      base: "",
      dest_dir: "C:\\Out",
      new_folder: null,
      expected_size: 1000,
      expected_modified: 50,
    });
  });

  it("a cancelled folder choice does nothing", async () => {
    vi.mocked(archivePickFolder).mockResolvedValue(null);
    // Extract all only asks for a folder for the app's own temporary copy.
    const props = await render({}, { ...summary, temporary: true });
    const button = ribbonButton("archive.extractAll");
    await act(async () => {
      button.click();
    });
    await flush();
    expect(vi.mocked(archivePickFolder)).toHaveBeenCalled();
    expect(props.onExtractArchive).not.toHaveBeenCalled();
  });

  it("shows why an archive can't be opened", async () => {
    const onOpenInWindowsApp = vi.fn();
    vi.mocked(archiveOpen).mockRejectedValue(new Error("archive.corrupt"));
    await render({ onOpenInWindowsApp }, null);
    expect(container!.textContent).toContain("This archive is damaged and can't be read.");
    const button = container!.querySelector<HTMLButtonElement>(".adp-viewer-message .adp-btn--primary")!;
    await act(async () => {
      button.click();
    });
    expect(onOpenInWindowsApp).toHaveBeenCalledOnce();
  });

  it("explains hidden and protected items", async () => {
    await render({}, { ...summary, hidden_entries: 2, encrypted_entries: 1 });
    expect(container!.textContent).toContain("2 items are hidden");
    expect(container!.textContent).toContain("1 item is protected");
  });

  it("closes the session when the tab closes", async () => {
    await render();
    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(vi.mocked(archiveClose)).toHaveBeenCalledWith("s1");
  });
});
