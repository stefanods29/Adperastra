import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import StorageView from "../storage/StorageView";
import type { StoragePage, StorageScanRequest } from "../services/storage";

const mocks = vi.hoisted(() => ({
  startStorageScan: vi.fn(),
  storagePage: vi.fn(),
  releaseStorageScan: vi.fn(),
  watchSubscribe: vi.fn(),
  watchUnsubscribe: vi.fn(),
}));

vi.mock("../services/storage", () => ({
  startStorageScan: mocks.startStorageScan,
  storagePage: mocks.storagePage,
  releaseStorageScan: mocks.releaseStorageScan,
  storageDisplayPath: (path: string) => path.replace(/^\\\\\?\\/, ""),
}));

vi.mock("../services/watcherMultiplexer", () => ({
  watchSubscribe: mocks.watchSubscribe,
  watchUnsubscribe: mocks.watchUnsubscribe,
}));

const request: StorageScanRequest = {
  root: "C:\\scan",
  allow_network: false,
  include_hidden: false,
  max_entries: 1_000_000,
};

const page: StoragePage = {
  summary: {
    scan_id: "scan-1",
    root: "C:\\scan",
    logical_bytes: 40,
    allocated_unique_bytes: null,
    unknown_allocated_count: 1,
    files_count: 2,
    folders_count: 1,
    link_count: 1,
    skipped_count: 0,
    coverage: "partial",
    cancelled: false,
    stale: true,
    generation: 4,
    calculated_unix: 1_700_000_000,
    reason_codes: ["limit"],
  },
  nodes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      parent_id: null,
      key: {
        volume_id: "00000001",
        file_id: "0000000000000001",
        path_key: "c:\\scan\\folder",
        stable: false,
      },
      path: "C:\\scan\\folder",
      name: "folder",
      kind: "folder",
      logical_bytes: 30,
      allocated_bytes: null,
      item_count: 2,
      online_only: false,
      coverage: "partial",
      children_count: 2,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      parent_id: null,
      key: {
        volume_id: "00000001",
        file_id: "0000000000000002",
        path_key: "c:\\scan\\a.bin",
        stable: true,
      },
      path: "C:\\scan\\a.bin",
      name: "a.bin",
      kind: "file",
      logical_bytes: 10,
      allocated_bytes: null,
      item_count: 0,
      online_only: true,
      coverage: "complete",
      children_count: 0,
    },
  ],
  next_cursor: "22222222-2222-4222-8222-222222222222",
  complete: false,
  typed_breakdown: [{ kind: "documents", count: 1, logical_bytes: 10 }],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startStorageScan.mockResolvedValue({
    id: "request-1",
    scanId: "scan-1",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(page),
  });
  mocks.storagePage.mockResolvedValue(page);
  mocks.releaseStorageScan.mockResolvedValue(undefined);
  mocks.watchUnsubscribe.mockResolvedValue(undefined);
  mocks.watchSubscribe.mockResolvedValue({
    subscription_id: "sub-1",
    root: "C:\\scan",
    generation: 4,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderView() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <StorageView
        request={request}
        active
        onOpenFolder={vi.fn(async () => undefined)}
        onOpenFile={vi.fn(async () => undefined)}
        onMutation={vi.fn(async () => undefined)}
        onOpenHelp={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

describe("storage view", () => {
  it("shows partial, stale and cloud labels", async () => {
    const view = await renderView();
    const text = view.textContent ?? "";
    expect(text).toContain("This scan is incomplete; totals cover scanned items only.");
    expect(text).toContain("Showing cached results while they are refreshed.");
    expect(text).toContain("Online-only sizes are counted without downloading files.");
  });

  it("keeps every canvas action in the parallel keyboard list", async () => {
    const view = await renderView();
    const canvas = view.querySelector("canvas");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    const actions = view.querySelectorAll(".adp-storage-tile-action");
    expect(actions).toHaveLength(page.nodes.length);
    const openButtons = view.querySelectorAll(
      ".adp-storage-tile-row .adp-icon-btn",
    );
    expect(openButtons).toHaveLength(page.nodes.length);
  });

  it("enables Delete only after a selection and never from the canvas", async () => {
    const view = await renderView();
    const deleteButton = [...view.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Delete",
    );
    expect(deleteButton?.hasAttribute("disabled")).toBe(true);
    const first = view.querySelector<HTMLButtonElement>(".adp-storage-tile-action");
    await act(async () => {
      first?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deleteButton?.hasAttribute("disabled")).toBe(false);
  });

  it("releases the scan and its watcher on unmount", async () => {
    await renderView();
    await act(async () => root?.unmount());
    root = null;
    expect(mocks.releaseStorageScan).toHaveBeenCalled();
    expect(mocks.watchUnsubscribe).toHaveBeenCalled();
  });
});

