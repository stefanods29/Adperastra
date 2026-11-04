import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import SearchResultsView from "../search/SearchResultsView";
import type { FolderPresentation } from "../services/folderPresentation";
import type { ExplorerItem } from "../services/explorer";
import {
  saveSearch,
  search as startSearch,
  searchPage,
  type SearchPage,
  type SearchQuery,
  type SavedSearch,
} from "../services/search";
import { VIEW_MODE_IDS, type ViewModeId } from "../services/settings";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => Math.max(1, options.count * 28),
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        start: index * 28,
        key: index,
      })),
    scrollToIndex: () => undefined,
  }),
}));

vi.mock("../services/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/search")>();
  return {
    ...actual,
    search: vi.fn(),
    searchPage: vi.fn(),
    cancelSearch: vi.fn(async () => undefined),
    saveSearch: vi.fn(async (search: SavedSearch) => search),
  };
});

const searchMock = vi.mocked(startSearch);
const pageMock = vi.mocked(searchPage);
const saveMock = vi.mocked(saveSearch);

const item = (name: string): ExplorerItem => ({
  path: `C:\\Find\\${name}`,
  name,
  kind: "file",
  size: 10,
  modified_unix: 1_700_000_000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const page = (names: string[], next: string | null = null): SearchPage => ({
  results: names.map((name) => ({
    item: item(name),
    key: {
      volume_id: "00000001",
      file_id: "0000000000000001",
      path_key: `c:\\find\\${name}`.toLowerCase(),
      stable: true,
    },
    found_by: "name",
    snippet: null,
    content_truncated: false,
    metadata_available: true,
    created_unix: 1_700_000_000,
    date_taken_unix: null,
  })),
  next_cursor: next,
  generation: 1,
  total_estimate: names.length,
  total_bytes: 0,
  total_exact: true,
  complete: next === null,
  coverage: "complete",
  skipped_count: 0,
});

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  mode: "name",
  text: "",
  roots: [],
  filter: null,
  regex_scope: "name",
  match_case: false,
  sort: { key: "name", direction: "ascending" },
  ...overrides,
});

const presentation = (mode: ViewModeId): FolderPresentation =>
  ({
    view_mode: mode,
    sort: { key: "name", direction: "ascending" },
    group_by: "none",
    columns: [{ id: "name", width: 200 }],
  }) as unknown as FolderPresentation;

function handle(result: SearchPage, delay = 0) {
  return {
    id: "search-job",
    cancel: vi.fn(async () => undefined),
    completion: new Promise<SearchPage>((resolve) => {
      window.setTimeout(() => resolve(result), delay);
    }),
  };
}

const flush = async (milliseconds = 60) => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

beforeEach(() => {
  searchMock.mockImplementation(async () => handle(page(["a.txt"])));
  pageMock.mockImplementation(async () => handle(page([])));
  saveMock.mockImplementation(async (saved: SavedSearch) => saved);
});

function Harness({
  initial,
  mode,
  onOpenFile,
}: {
  initial: SearchQuery;
  mode: ViewModeId;
  onOpenFile: (path: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState(initial);
  return (
    <SearchResultsView
      query={current}
      viewFolderPresentation={presentation(mode)}
      active
      onOpenFile={onOpenFile}
      onQueryChange={setCurrent}
      onOpenHelp={() => undefined}
      indexRoots={[]}
    />
  );
}

async function render(
  initial: SearchQuery = query(),
  mode: ViewModeId = "details",
  onOpenFile: (path: string) => Promise<void> = async () => undefined,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness initial={initial} mode={mode} onOpenFile={onOpenFile} />);
  });
  await flush();
}

describe("SearchResultsView", () => {
  it("cycles the four modes from a focused search box, not the MRU tab list", async () => {
    await render();
    const input = container!.querySelector<HTMLInputElement>("input[type='search']")!;
    for (const expected of ["content", "filters", "regex", "name"]) {
      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true }),
        );
      });
      await flush();
      expect(
        container!.querySelector(".adp-search-mode__button")?.textContent,
      ).toContain(
        expected === "content"
          ? "Content"
          : expected === "filters"
            ? "Filters"
            : expected === "regex"
              ? "Regex"
              : "Name",
      );
    }
    const modes = searchMock.mock.calls.map(([sent]) => sent.mode);
    expect(modes.slice(-4)).toEqual(["content", "filters", "regex", "name"]);
  });

  it("keeps the AI entry disabled and makes no request for it", async () => {
    await render();
    const calls = searchMock.mock.calls.length;
    const button = container!.querySelector<HTMLButtonElement>(".adp-search-mode__button")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const option = [...container!.querySelectorAll<HTMLElement>("[role='option']")].find(
      (entry) => entry.getAttribute("aria-disabled") === "true",
    );
    expect(option?.textContent).toContain("Ask");
    await act(async () => {
      option!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(searchMock.mock.calls.length).toBe(calls);
    expect(container!.textContent).toContain("Set up AI search");
  });

  it("discards a stale page when a newer query has already answered", async () => {
    let call = 0;
    searchMock.mockImplementation(async () => {
      call += 1;
      return call === 1 ? handle(page(["a.txt"]), 90) : handle(page(["b.txt"]), 0);
    });
    await render();
    const input = container!.querySelector<HTMLInputElement>("input[type='search']")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "b");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush(140);
    expect(container!.textContent).toContain("b.txt");
    expect(container!.textContent).not.toContain("a.txt");
  });

  it("saves the query, never the results", async () => {
    await render(query({ text: "port" }));
    const saveButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Save search"),
    )!;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container!.querySelector<HTMLInputElement>(".adp-dialog input")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "Ports");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = container!.querySelector<HTMLButtonElement>(
      ".adp-dialog .adp-btn--primary",
    )!;
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const saved = saveMock.mock.calls[0][0];
    expect(saved.query.text).toBe("port");
    expect(saved.query.mode).toBe("name");
    expect(JSON.stringify(saved)).not.toContain("results");
  });

  it("opens a real disk path in all nine ordinary view modes", async () => {
    for (const mode of VIEW_MODE_IDS) {
      searchMock.mockImplementation(async () => handle(page(["file.txt"])));
      const open = vi.fn(async () => undefined);
      await render(query(), mode, open);
      const option = container!.querySelector<HTMLElement>("[role='option']");
      expect(option).not.toBeNull();
      await act(async () => {
        option!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
      });
      expect(open).toHaveBeenCalledWith("C:\\Find\\file.txt");
      if (root) await act(async () => root?.unmount());
      container?.remove();
      root = null;
      container = null;
    }
  });
});
