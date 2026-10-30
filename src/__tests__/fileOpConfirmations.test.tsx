import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ExplorerHome from "../views/ExplorerHome";
import type { ExplorerItem } from "../services/explorer";
import type { ConflictPolicy, OpReport } from "../services/fileops";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fixture = vi.hoisted(() => {
  const systems = new Set<string>();
  const output = new Map<string, string>();
  return {
  items: [] as ExplorerItem[],
  systems,
  sources: ["C:\\Source\\a.txt", "C:\\Source\\b.txt"],
  cut: false,
  conflicts: [] as string[],
  output,
  requests: [] as { kind: string; sources: string[]; conflict?: ConflictPolicy }[],
};
});

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    scrollToIndex: () => undefined,
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));
vi.mock("../services/settings", async (original) => ({
  ...(await original<typeof import("../services/settings")>()),
  isTauriRuntime: () => true,
}));
vi.mock("../services/explorer", async (original) => {
  const actual = await original<typeof import("../services/explorer")>();
  const state = { schema_version: 2, pinned_folders: [], recent_folders: [], favorites: [] };
  return {
    ...actual,
    listKnownFolders: async () => [{ id: "documents", name: "Test folder", path: "C:\\Dest" }],
    explorerStateGet: async () => state,
    recordRecentFolder: async () => state,
    listDrives: async () => [],
    listRecentItems: async () => [],
    listFavoriteItems: async () => [],
    fsStat: async (path: string) => ({ path, system: fixture.systems.has(path) }),
    startListDir: async (path: string, _sort: unknown, onBatch: (items: ExplorerItem[]) => void) => {
      onBatch(fixture.items);
      return { requestId: "listing", cancel: async () => undefined, completion: Promise.resolve({ path, total: fixture.items.length, skipped: [] }) };
    },
    watchStart: async () => () => undefined,
    watchStop: async () => undefined,
  };
});
vi.mock("../services/fileops", async (original) => ({
  ...(await original<typeof import("../services/fileops")>()),
  clipboardRead: async () => ({ files: fixture.sources, cut: fixture.cut, has_text: false, has_image: false }),
  clipboardClear: async () => undefined,
  checkConflicts: async () => fixture.conflicts,
  startFileJob: async (kind: string, sources: string[], options: { conflict?: ConflictPolicy; allowSystem?: boolean } = {}) => {
    const systemSource = kind !== "copy" && sources.some((source) => fixture.systems.has(source));
    const systemTarget = options.conflict === "replace" && fixture.conflicts.some((target) => fixture.systems.has(target));
    if ((systemSource || systemTarget) && !options.allowSystem) {
      return { id: "checking", cancel: async () => undefined, completion: Promise.reject(new Error("ops.system_confirmation_required")) };
    }
    fixture.requests.push({ kind, sources, conflict: options.conflict });
    const report: OpReport = { completed: [], skipped: [], replaced: [], created: [], cancelled: false };
    for (const source of sources) {
      const name = source.split("\\").pop()!;
      let target = `C:\\Dest\\${name}`;
      if (fixture.output.has(target) && options.conflict === "skip") {
        report.skipped.push({ path: source, reason: "exists" });
        continue;
      }
      if (fixture.output.has(target) && options.conflict === "keepBoth") target = target.replace(".txt", " (2).txt");
      fixture.output.set(target, `new ${name}`);
      report.completed.push({ from: source, to: target });
      report.created.push({ from: source, to: target });
    }
    return { id: "job", cancel: async () => undefined, completion: Promise.resolve(report) };
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const item = (name: string): ExplorerItem => ({
  path: `C:\\Dest\\${name}`, name, kind: "file", size: 1, modified_unix: 0,
  hidden: false, system: false, is_link: false, online_only: false, file_id: null, file_id_stable: false,
});
const click = async (element: Element) => act(async () => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
});
const key = async (key: string, extra: KeyboardEventInit = {}) => act(async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
});
const dialog = () => container!.querySelector<HTMLElement>("[role='dialog']");
async function answer(label: string) {
  const button = [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === label);
  expect(button, `dialog action ${label}`).toBeDefined();
  await click(button!);
}
async function renderFolder() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ExplorerHome onOpenHelp={() => undefined} />));
  const folder = [...container.querySelectorAll("button")].find((button) => button.textContent === "Test folder")!;
  await click(folder);
}

beforeEach(() => {
  fixture.items = [item("system.ini")];
  fixture.systems.clear();
  fixture.sources = ["C:\\Source\\a.txt", "C:\\Source\\b.txt"];
  fixture.cut = false;
  fixture.conflicts = [];
  fixture.output.clear();
  fixture.requests = [];
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Explorer file-operation confirmations", () => {
  it("applies Replace then Keep both separately when the for-all box is cleared", async () => {
    fixture.conflicts = ["C:\\Dest\\a.txt", "C:\\Dest\\b.txt"];
    fixture.output.set("C:\\Dest\\a.txt", "old a");
    fixture.output.set("C:\\Dest\\b.txt", "old b");
    await renderFolder();
    await key("v", { ctrlKey: true });
    expect(dialog()?.textContent).toContain("a.txt");
    await click(dialog()!.querySelector("input")!);
    await answer("Replace");
    expect(dialog()?.textContent).toContain("b.txt");
    await answer("Keep both");
    expect(fixture.output.get("C:\\Dest\\a.txt")).toBe("new a.txt");
    expect(fixture.output.get("C:\\Dest\\b.txt")).toBe("old b");
    expect(fixture.output.get("C:\\Dest\\b (2).txt")).toBe("new b.txt");
  });

  it("cancels recycling a system item without starting a job", async () => {
    fixture.systems.add("C:\\Dest\\system.ini");
    await renderFolder();
    await click(container!.querySelector("[role='option']")!);
    await key("Delete");
    expect(dialog()?.textContent).toContain("system item");
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(fixture.requests).toHaveLength(0);
    await answer("Cancel");
    expect(fixture.requests).toHaveLength(0);
  });

  it("recycles a system item only after explicit confirmation", async () => {
    fixture.systems.add("C:\\Dest\\system.ini");
    await renderFolder();
    await click(container!.querySelector("[role='option']")!);
    await key("Delete");
    expect(fixture.requests).toHaveLength(0);
    await answer("Continue");
    expect(fixture.requests.map((request) => request.kind)).toEqual(["recycle"]);
  });

  it("checks a clipboard move's fresh system attributes and cancels on Escape", async () => {
    fixture.sources = ["C:\\Source\\system.ini"];
    fixture.cut = true;
    fixture.systems.add(fixture.sources[0]);
    await renderFolder();
    await key("v", { ctrlKey: true });
    expect(dialog()?.textContent).toContain("system item");
    expect(fixture.requests).toHaveLength(0);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(fixture.requests).toHaveLength(0);
  });

  it("moves a clipboard system item only after confirmation", async () => {
    fixture.sources = ["C:\\Source\\system.ini"];
    fixture.cut = true;
    fixture.systems.add(fixture.sources[0]);
    await renderFolder();
    await key("v", { ctrlKey: true });
    expect(fixture.requests).toHaveLength(0);
    await answer("Continue");
    expect(fixture.requests.map((request) => request.kind)).toEqual(["move"]);
  });

  it("warns before replacing a system target and preserves it on cancellation", async () => {
    fixture.sources = ["C:\\Source\\system.ini"];
    fixture.conflicts = ["C:\\Dest\\system.ini"];
    fixture.systems.add(fixture.conflicts[0]);
    fixture.output.set(fixture.conflicts[0], "old system file");
    await renderFolder();
    await key("v", { ctrlKey: true });
    await answer("Replace");
    expect(dialog()?.textContent).toContain("system item");
    expect(fixture.requests).toHaveLength(0);
    await answer("Cancel");
    expect(fixture.output.get(fixture.conflicts[0])).toBe("old system file");
    expect(fixture.requests).toHaveLength(0);
  });
});
