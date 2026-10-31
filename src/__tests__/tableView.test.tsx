import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import TableView from "../handlers/table/TableView";
import type { FileTypeInfo } from "../services/files";
import type { JobHandle } from "../services/jobs";
import {
  tableClose,
  tableOpen,
  tableRows,
  tableView,
  type TableSummary,
  type TableViewInfo,
} from "../services/tableView";

vi.mock("../services/tableView", () => ({
  tableOpen: vi.fn(),
  tableView: vi.fn(),
  tableRows: vi.fn(),
  tableClose: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: {
    count: number;
    estimateSize: (index: number) => number;
  }) => ({
    getTotalSize: () =>
      Array.from({ length: opts.count }, (_, index) => opts.estimateSize(index)).reduce(
        (sum, size) => sum + size,
        0,
      ),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: 0,
        size: opts.estimateSize(index),
        key: index,
      })),
    measure: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

const info: FileTypeInfo = {
  path: "C:\\data\\people.csv",
  name: "people.csv",
  ext: "csv",
  mime: "text/csv",
  size: 120,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

function summary(patch: Partial<TableSummary> = {}): TableSummary {
  return {
    session: "s1",
    columns: 2,
    rows: 3,
    truncated: false,
    delimiter: ",",
    encoding: "utf8",
    has_header: true,
    headers: ["name", "age"],
    ...patch,
  };
}

function handle<T>(result: T): JobHandle<T> {
  return {
    id: "job",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(result),
  };
}

function viewInfo(view: number, rows: number): TableViewInfo {
  return { view, rows };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

async function render(
  options: {
    findText?: string;
    request?: number;
    openAsText?: () => void;
  } = {},
): Promise<void> {
  const findText = options.findText ?? "";
  await act(async () =>
    root?.render(
      <TableView
        info={info}
        url="http://adpfile.localhost/token/people.csv"
        active={true}
        savedState={null}
        onStateChange={() => undefined}
        onStatus={() => undefined}
        onOpenInWindowsApp={() => undefined}
        find={{ text: findText, request: options.request ?? 0, backwards: false }}
        protectedView={false}
        onOpenAsText={options.openAsText}
      />,
    ),
  );
  await flush();
}

beforeEach(() => {
  vi.mocked(tableOpen).mockResolvedValue(handle(summary()));
  vi.mocked(tableView).mockResolvedValue(handle(viewInfo(1, 2)));
  vi.mocked(tableRows).mockResolvedValue([
    ["Ana", "31"],
    ["Luis", "9"],
  ]);
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
  vi.useRealTimers();
});

describe("table view", () => {
  it("shows headers and rows", async () => {
    await render();
    const heads = [...container!.querySelectorAll(".adp-table-head-cell")].map(
      (cell) => cell.textContent,
    );
    expect(heads).toEqual(["name", "age"]);
    const cells = [...container!.querySelectorAll(".adp-table-cell")].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual(["Ana", "31", "Luis", "9"]);
  });

  it("clicking a header sorts, then reverses, then clears", async () => {
    await render();
    const header = container!.querySelector<HTMLButtonElement>(".adp-table-head-cell");
    vi.mocked(tableView).mockResolvedValue(handle(viewInfo(2, 2)));
    await act(async () => header?.click());
    await flush();
    vi.mocked(tableView).mockResolvedValue(handle(viewInfo(3, 2)));
    await act(async () => header?.click());
    await flush();
    vi.mocked(tableView).mockResolvedValue(handle(viewInfo(4, 2)));
    await act(async () => header?.click());
    await flush();
    const requests = vi.mocked(tableView).mock.calls.map((call) => call[1]);
    expect(requests[1]).toMatchObject({ sort_column: 0, direction: "ascending" });
    expect(requests[2]).toMatchObject({ sort_column: 0, direction: "descending" });
    expect(requests[3]).toMatchObject({ sort_column: null });
  });

  it("typing filters after a pause and cancels the older view", async () => {
    vi.useFakeTimers();
    await render();
    const cancel = vi.fn(async () => undefined);
    vi.mocked(tableView).mockResolvedValue({
      id: "later",
      cancel,
      completion: new Promise<TableViewInfo>(() => undefined),
    });
    await render({ findText: "ana" });
    await act(async () => vi.advanceTimersByTime(250));
    await act(async () => undefined);
    await render({ findText: "anat" });
    await act(async () => vi.advanceTimersByTime(250));
    await act(async () => undefined);
    const requests = vi.mocked(tableView).mock.calls.map((call) => call[1]);
    expect(requests[1].filter).toBe("ana");
    expect(requests[2].filter).toBe("anat");
    expect(cancel).toHaveBeenCalled();
  });

  it("turning headers off asks for a new view", async () => {
    await render();
    const toggle = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("First row is headers"),
    );
    expect(toggle).toBeDefined();
    vi.mocked(tableView).mockResolvedValue(handle(viewInfo(2, 3)));
    await act(async () => toggle?.click());
    await flush();
    const requests = vi.mocked(tableView).mock.calls.map((call) => call[1]);
    expect(requests.at(-1)).toMatchObject({ has_header: false });
  });

  it("an old view's rows are ignored", async () => {
    let resolveOld: (rows: string[][]) => void = () => undefined;
    vi.mocked(tableRows).mockImplementationOnce(
      () =>
        new Promise<string[][]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render();
    const header = container!.querySelector<HTMLButtonElement>(".adp-table-head-cell");
    vi.mocked(tableView).mockResolvedValue(handle(viewInfo(2, 2)));
    vi.mocked(tableRows).mockResolvedValue([["New", "2"]]);
    await act(async () => header?.click());
    await flush();
    await act(async () => resolveOld([["Old", "1"]]));
    await flush();
    expect(container!.textContent).not.toContain("Old");
    expect(container!.textContent).toContain("New");
  });

  it("an empty file offers Open as text", async () => {
    const openAsText = vi.fn();
    vi.mocked(tableOpen).mockResolvedValue(handle(summary({ rows: 0, headers: [] })));
    vi.mocked(tableView).mockResolvedValue(handle(viewInfo(1, 0)));
    vi.mocked(tableRows).mockResolvedValue([]);
    await render({ openAsText });
    expect(container!.textContent).toContain("This file has no rows.");
    const button = [...container!.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Open as text",
    );
    await act(async () => button?.click());
    expect(openAsText).toHaveBeenCalled();
  });

  it("a truncated file says so", async () => {
    vi.mocked(tableOpen).mockResolvedValue(handle(summary({ truncated: true })));
    await render();
    expect(container!.textContent).toContain("too big to show whole");
  });

  it("closes the session when the tab closes", async () => {
    await render();
    await act(async () => root?.unmount());
    root = null;
    expect(vi.mocked(tableClose)).toHaveBeenCalledWith("s1");
  });

  it("Open as text calls the prop", async () => {
    const openAsText = vi.fn();
    await render({ openAsText });
    const button = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Open as text"),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(openAsText).toHaveBeenCalled();
  });
});
