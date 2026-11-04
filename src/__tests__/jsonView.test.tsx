import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import JsonView from "../handlers/json/JsonView";
import type { FileTypeInfo } from "../services/files";
import {
  jsonChildren,
  jsonClose,
  jsonCopy,
  jsonFind,
  jsonOpen,
  type JsonInvalidError,
  type JsonNodeInfo,
  type JsonSummary,
} from "../services/jsonView";
import type { JobHandle } from "../services/jobs";

vi.mock("../services/jsonView", () => ({
  jsonOpen: vi.fn(),
  jsonChildren: vi.fn(),
  jsonFind: vi.fn(),
  jsonCopy: vi.fn(),
  jsonClose: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        start: index * opts.estimateSize(index),
        size: opts.estimateSize(index),
        key: index,
      })),
    measure: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

const info: FileTypeInfo = {
  path: "C:\\data\\data.json",
  name: "data.json",
  ext: "json",
  mime: "application/json",
  size: 120,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

function node(patch: Partial<JsonNodeInfo> & { id: number }): JsonNodeInfo {
  return {
    key: null,
    index: null,
    kind: "string",
    preview: "",
    preview_cut: false,
    child_count: 0,
    ...patch,
  };
}

const rootNode = node({ id: 0, kind: "object", child_count: 2 });
const nameNode = node({ id: 1, key: "name", kind: "string", preview: "Ana" });
const listNode = node({ id: 2, key: "list", kind: "array", child_count: 2 });
const firstItem = node({ id: 3, index: 0, kind: "number", preview: "1" });
const deepItem = node({ id: 5, index: 1, kind: "string", preview: "deep" });

const summary: JsonSummary = { session: "s1", nodes: 5, encoding: "utf8", root: rootNode };

function handle<T>(result: T): JobHandle<T> {
  return {
    id: "job",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(result),
  };
}

const manyChildren = Array.from({ length: 1_000 }, (_, index) =>
  node({ id: index + 1, index, kind: "number", preview: String(index) }),
);

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const writeText = vi.fn(async () => undefined);

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

async function render(find: { text: string; request: number } = { text: "", request: 0 }): Promise<void> {
  const onOpenAsText = vi.fn();
  await act(async () =>
    root?.render(
      <JsonView
        info={info}
        url="http://adpfile.localhost/token/data.json"
        active={true}
        savedState={null}
        onStateChange={() => undefined}
        onStatus={() => undefined}
        onOpenInWindowsApp={() => undefined}
        find={{ text: find.text, request: find.request, backwards: false }}
        protectedView={false}
        onOpenAsText={onOpenAsText}
      />,
    ),
  );
  await flush();
}

function rowWith(text: string): HTMLDivElement | null {
  return (
    [...container!.querySelectorAll<HTMLDivElement>(".adp-json-row")].find((row) =>
      row.textContent?.includes(text),
    ) ?? null
  );
}

function press(element: Element | null, key: string, ctrlKey = false): void {
  element?.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true }));
}

beforeEach(() => {
  vi.mocked(jsonOpen).mockResolvedValue(handle(summary));
  vi.mocked(jsonChildren).mockImplementation(async (_session, nodeId) => {
    if (nodeId === 0) return [nameNode, listNode];
    if (nodeId === 2) return [firstItem, deepItem];
    return [];
  });
  vi.mocked(jsonFind).mockResolvedValue({ id: 5, ancestors: [0, 2] });
  vi.mocked(jsonCopy).mockResolvedValue("Ana");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
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

describe("json view", () => {
  it("root opens with its children", async () => {
    await render();
    expect(container!.textContent).toContain("name");
    expect(container!.textContent).toContain("Ana");
    expect(container!.textContent).toContain("list");
  });

  it("Right opens and Left closes", async () => {
    await render();
    const list = rowWith("list");
    expect(list).not.toBeNull();
    await act(async () => list?.click());
    await act(async () => press(list, "ArrowRight"));
    await flush();
    expect(vi.mocked(jsonChildren)).toHaveBeenCalledWith("s1", 2, 0, 1000);
    expect(rowWith("list")?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => press(rowWith("list"), "ArrowLeft"));
    expect(rowWith("list")?.getAttribute("aria-expanded")).toBe("false");
  });

  // The 2,500-child page is slow when the whole 600-test suite shares the
  // machine; keep the assertions and give this one its real budget.
  it("Show more loads the next page", async () => {
    vi.mocked(jsonOpen).mockResolvedValue(
      handle({ ...summary, root: node({ id: 0, kind: "array", child_count: 2_500 }) }),
    );
    vi.mocked(jsonChildren).mockImplementation(async (_session, nodeId, start) => {
      if (nodeId === 0) return start === 0 ? manyChildren : [deepItem];
      return [];
    });
    await render();
    const more = rowWith("Show more");
    expect(more).not.toBeNull();
    await act(async () => more?.click());
    await flush();
    expect(vi.mocked(jsonChildren)).toHaveBeenLastCalledWith("s1", 0, 1_000, 1_000);
  }, 15_000);

  it("find expands to the match", async () => {
    await render();
    await render({ text: "deep", request: 1 });
    await flush();
    expect(rowWith("deep")).not.toBeNull();
    expect(vi.mocked(jsonFind)).toHaveBeenCalled();
  });

  it("invalid JSON shows the place and Open as text", async () => {
    const invalid = new Error("data.invalid") as JsonInvalidError;
    invalid.line = 1;
    invalid.column = 8;
    vi.mocked(jsonOpen).mockRejectedValue(invalid);
    await render();
    expect(container!.textContent).toContain("isn't valid JSON");
    expect(container!.textContent).toContain("Line 1, column 8");
    const button = [...container!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Open as text"),
    );
    expect(button).toBeDefined();
  });

  it("Ctrl+C copies the selected value", async () => {
    await render();
    const name = rowWith("Ana");
    await act(async () => name?.click());
    await flush();
    await act(async () => press(name, "c", true));
    await flush();
    expect(vi.mocked(jsonCopy)).toHaveBeenCalledWith("s1", 1);
    expect(writeText).toHaveBeenCalledWith("Ana");
  });

  it("closes the session when the tab closes", async () => {
    await render();
    await act(async () => root?.unmount());
    root = null;
    expect(vi.mocked(jsonClose)).toHaveBeenCalledWith("s1");
  });
});
