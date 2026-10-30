import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderListing } from "../services/columnListing";
import type { ExplorerItem, SortSpec } from "../services/explorer";
import { listFolder } from "../services/columnListing";
import { useColumnListings, useDelayedFlag, type ColumnListing } from "../views/explorer/views/useColumnListings";

interface MockRequest {
  path: string;
  sort: SortSpec;
  resolve: (listing: FolderListing) => void;
  reject: (error: unknown) => void;
  cancel: ReturnType<typeof vi.fn>;
}

const mock = vi.hoisted(() => ({ requests: [] as MockRequest[] }));

vi.mock("../services/columnListing", () => ({
  listFolder: vi.fn((path: string, sort: SortSpec) => {
    let resolve!: (listing: FolderListing) => void;
    let reject!: (error: unknown) => void;
    const done = new Promise<FolderListing>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const cancel = vi.fn();
    mock.requests.push({ path, sort, resolve, reject, cancel });
    return { done, cancel };
  }),
}));

const sort: SortSpec = { key: "name", direction: "ascending" };

const item = (name: string): ExplorerItem => ({
  path: `C:\\A\\${name}`,
  name,
  kind: "file",
  size: 1,
  modified_unix: 1700000000,
  hidden: false,
  system: false,
  is_link: false,
  online_only: false,
  file_id: null,
  file_id_stable: false,
});

const a = item("a.txt");
const b = item("b.txt");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: ((path: string) => ColumnListing | null) | null = null;
let flagValue = false;

interface ListingProps {
  folders: string[];
  child: string | null;
  active: string;
  sort: SortSpec;
  refreshKey: number;
}

function Probe(props: ListingProps) {
  latest = useColumnListings(props.folders, props.child, props.active, props.sort, props.refreshKey);
  return null;
}

function FlagProbe({ active }: { active: boolean }) {
  flagValue = useDelayedFlag(active, 100);
  return null;
}

function ensureRoot() {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
}

async function render(props: ListingProps) {
  ensureRoot();
  await act(async () => {
    root!.render(<Probe {...props} />);
  });
}

async function renderFlag(active: boolean) {
  ensureRoot();
  await act(async () => {
    root!.render(<FlagProbe active={active} />);
  });
}

const get = (path: string) => latest!(path);

beforeEach(() => {
  mock.requests.length = 0;
  vi.clearAllMocks();
  latest = null;
  flagValue = false;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("useColumnListings", () => {
  it("loads a parent folder once and keeps it", async () => {
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].path).toBe("C:\\A");
    expect(mock.requests[0].sort).toEqual({ key: "name", direction: "ascending" });
    await act(async () => {
      mock.requests[0].resolve({ items: [a], partial: false });
    });
    const listing = get("c:\\a\\");
    expect(listing?.status).toBe("ready");
    expect(listing?.items).toHaveLength(1);
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    expect(listFolder).toHaveBeenCalledTimes(1);
    expect(mock.requests).toHaveLength(1);
  });

  it("waits before loading the selected folder", async () => {
    vi.useFakeTimers();
    await render({ folders: [], child: "C:\\A\\B", active: "C:\\A", sort, refreshKey: 0 });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(mock.requests).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].path).toBe("C:\\A\\B");
  });

  it("cancels a listing that is no longer wanted", async () => {
    vi.useFakeTimers();
    await render({ folders: [], child: "C:\\A\\B", active: "C:\\A", sort, refreshKey: 0 });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(mock.requests).toHaveLength(1);
    await render({ folders: [], child: "C:\\A\\C", active: "C:\\A", sort, refreshKey: 0 });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(mock.requests[0].cancel).toHaveBeenCalledTimes(1);
    expect(mock.requests).toHaveLength(2);
  });

  it("reloads on refresh and keeps the old rows meanwhile", async () => {
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    await act(async () => {
      mock.requests[0].resolve({ items: [a], partial: false });
    });
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 1 });
    expect(mock.requests).toHaveLength(2);
    expect(get("c:\\a\\")?.status).toBe("ready");
    expect(get("c:\\a\\")?.items).toHaveLength(1);
    await act(async () => {
      mock.requests[1].resolve({ items: [a, b], partial: false });
    });
    expect(get("c:\\a\\")?.items).toHaveLength(2);
  });

  it("a sort change reloads", async () => {
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    await act(async () => {
      mock.requests[0].resolve({ items: [a], partial: false });
    });
    await render({
      folders: ["C:\\A"],
      child: null,
      active: "C:\\A\\B",
      sort: { key: "size", direction: "ascending" },
      refreshKey: 0,
    });
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[1].sort.key).toBe("size");
  });

  it("a folder that cannot be listed is an error", async () => {
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    await act(async () => {
      mock.requests[0].reject(new Error("denied"));
    });
    const listing = get("c:\\a\\");
    expect(listing?.status).toBe("error");
    expect(listing?.items).toEqual([]);
  });

  it("a folder that was open reloads when it becomes a side column", async () => {
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    await act(async () => {
      mock.requests[0].resolve({ items: [a], partial: false });
    });
    await render({ folders: [], child: null, active: "C:\\A", sort, refreshKey: 0 });
    await render({ folders: ["C:\\A"], child: null, active: "C:\\A\\B", sort, refreshKey: 0 });
    expect(mock.requests.filter((request) => request.path === "C:\\A")).toHaveLength(2);
  });

  it("useDelayedFlag turns on after the delay and off at once", async () => {
    vi.useFakeTimers();
    await renderFlag(true);
    await act(async () => {
      vi.advanceTimersByTime(99);
    });
    expect(flagValue).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(flagValue).toBe(true);
    await renderFlag(false);
    expect(flagValue).toBe(false);
  });
});
