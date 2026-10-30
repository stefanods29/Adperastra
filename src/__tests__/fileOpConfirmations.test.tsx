import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ExplorerHome from "../views/ExplorerHome";
import type { ExplorerItem } from "../services/explorer";
import type { ConflictInfo, ConflictPolicy, OpReport } from "../services/fileops";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fixture = vi.hoisted(() => {
  const systems = new Set<string>();
  const folders = new Set<string>();
  const output = new Map<string, string>();
  return {
    items: [] as ExplorerItem[],
    systems,
    folders,
    sources: ["C:\\Source\\a.txt", "C:\\Source\\b.txt"],
    cut: false,
    conflicts: [] as ConflictInfo[],
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
    const targetOf = (source: string) => `C:\\Dest\\${source.split("\\").pop()!}`;
    const systemSource = kind !== "copy" && sources.some((source) => fixture.systems.has(source));
    const systemTarget = options.conflict === "merge" &&
      sources.some((source) => fixture.systems.has(targetOf(source)));
    if ((systemSource || systemTarget) && !options.allowSystem) {
      return { id: "checking", cancel: async () => undefined, completion: Promise.reject(new Error("ops.system_confirmation_required")) };
    }
    fixture.requests.push({ kind, sources, conflict: options.conflict });
    const report: OpReport = { completed: [], skipped: [], replaced: [], created: [], cancelled: false };
    for (const source of sources) {
      const name = source.split("\\").pop()!;
      let target = targetOf(source);
      if (fixture.output.has(target)) {
        if (options.conflict === "skip") {
          report.skipped.push({ path: source, reason: "exists" });
          continue;
        }
        if (options.conflict === "keepBoth") target = target.replace(/(\.[^.]*)?$/, " - Copy$1");
        if (options.conflict === "merge") {
          if (!fixture.folders.has(target)) {
            report.skipped.push({ path: source, reason: "exists" });
            continue;
          }
          const added = `${target}\\new.txt`;
          fixture.output.set(added, "new file in folder");
          report.completed.push({ from: source, to: target });
          report.created.push({ from: source, to: added });
          continue;
        }
      }
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
  fixture.folders.clear();
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
  it("applies Merge then Keep both separately when the for-all box is cleared", async () => {
    fixture.sources = ["C:\\Source\\folder", "C:\\Source\\b.txt"];
    fixture.conflicts = [
      { path: "C:\\Dest\\folder", is_dir: true },
      { path: "C:\\Dest\\b.txt", is_dir: false },
    ];
    fixture.folders.add("C:\\Dest\\folder");
    fixture.output.set("C:\\Dest\\folder", "folder");
    fixture.output.set("C:\\Dest\\folder\\keep.txt", "old keep");
    fixture.output.set("C:\\Dest\\b.txt", "old b");
    await renderFolder();
    await key("v", { ctrlKey: true });
    expect(dialog()?.textContent).toContain("folder");
    expect(dialog()?.textContent).toContain("Merge");
    await click(dialog()!.querySelector("input")!);
    await answer("Merge");
    expect(dialog()?.textContent).toContain("b.txt");
    expect(dialog()?.textContent).not.toContain("Merge");
    await answer("Keep both");
    expect(fixture.output.get("C:\\Dest\\folder\\keep.txt")).toBe("old keep");
    expect(fixture.output.get("C:\\Dest\\folder\\new.txt")).toBe("new file in folder");
    expect(fixture.output.get("C:\\Dest\\b.txt")).toBe("old b");
    expect(fixture.output.get("C:\\Dest\\b - Copy.txt")).toBe("new b.txt");
    expect(fixture.requests.map((request) => request.conflict)).toEqual(["merge", "keepBoth"]);
  });

  it("does not offer Replace or Merge for a file conflict", async () => {
    fixture.conflicts = [{ path: "C:\\Dest\\a.txt", is_dir: false }];
    fixture.output.set("C:\\Dest\\a.txt", "old");
    await renderFolder();
    await key("v", { ctrlKey: true });
    const labels = [...dialog()!.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).not.toContain("Replace");
    expect(labels).not.toContain("Merge");
    expect(labels).toContain("Keep both");
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

  it("warns before merging into a system folder and preserves it on cancellation", async () => {
    fixture.sources = ["C:\\Source\\system"];
    fixture.conflicts = [{ path: "C:\\Dest\\system", is_dir: true }];
    fixture.folders.add("C:\\Dest\\system");
    fixture.systems.add(fixture.conflicts[0].path);
    fixture.output.set(fixture.conflicts[0].path, "old system folder");
    await renderFolder();
    await key("v", { ctrlKey: true });
    await answer("Merge");
    expect(dialog()?.textContent).toContain("system item");
    expect(fixture.requests).toHaveLength(0);
    await answer("Cancel");
    expect(fixture.output.get(fixture.conflicts[0].path)).toBe("old system folder");
    expect(fixture.requests).toHaveLength(0);
  });
});
