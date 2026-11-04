import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ExplorerHome, { type ExplorerPaletteBridge } from "../views/ExplorerHome";
import TransferHost, { closeTransfer } from "../transfers/TransferHost";
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
    jobs: [] as any[],
    jobCounter: 0,
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

vi.mock("../services/transferJobs", async (original) => {
  const actual = await original<typeof import("../services/transferJobs")>();
  const baseName = (path: string) => path.split("\\").pop()!;
  const targetOf = (source: string) => `C:\\Dest\\${baseName(source)}`;
  const progressOf = (job: any) => ({
    items_done: job.items.filter((entry: any) => entry.status !== "pending").length,
    items_total: job.items.length,
    bytes_done: 0,
    bytes_total: 0,
    current: "",
  });
  const stateOf = (job: any, state: string, decision: any = null) => ({
    job_id: job.id,
    state,
    progress: progressOf(job),
    bytes_per_second: null,
    eta_seconds: null,
    current_item_id: null,
    decision,
    generation: job.generation,
  });
  const decisionFor = (job: any) => {
    const item = job.items[job.index];
    if (!item) return null;
    return {
      decision_id: `decision-${job.id}-${job.index}`,
      item_id: `item-${job.index}`,
      kind: "conflict",
      source_path: item.source,
      target_path: item.target,
      source: null,
      target: null,
      source_kind: "file",
      target_kind: item.isDir ? "folder" : "file",
      error_code: null,
      attempt: 0,
      allowed: item.isDir ? ["skip", "keepBoth", "merge"] : ["skip", "keepBoth"],
      replace_available: false,
    };
  };
  const reportOf = (job: any) => ({
    report_id: `report-${job.id}`,
    transfer_id: null,
    items: job.items.map((item: any, index: number) => ({
      item_id: `item-${index}`,
      from: item.source,
      to: item.to ?? null,
      status: item.status === "pending" ? "skipped" : item.status,
      reason: item.reason ?? null,
      bytes_written: 0,
      verified: item.status === "done",
      source_removed: false,
      destination_created: item.status === "done",
    })),
    next_cursor: null,
    done: job.items.filter((entry: any) => entry.status === "done").length,
    skipped: job.items.filter((entry: any) => entry.status === "skipped").length,
    failed: 0,
    cancelled: false,
    job_finished: true,
    complete: true,
    replace_available: false,
  });
  const finish = (job: any) => {
    if (job.finished) return job.state;
    job.finished = true;
    job.state = stateOf(job, "done");
    job.resolve(reportOf(job));
    return job.state;
  };
  const advance = (job: any) => {
    job.index += 1;
    job.generation += 1;
    const item = job.items[job.index];
    if (item && item.status === "pending") {
      job.state = stateOf(job, "waiting", decisionFor(job));
    } else {
      const next = job.items.findIndex((entry: any, index: number) => index >= job.index && entry.status === "pending");
      if (next >= 0) {
        job.index = next;
        job.state = stateOf(job, "waiting", decisionFor(job));
      } else {
        finish(job);
      }
    }
    return job.state;
  };
  return {
    ...actual,
    startTransfer: async (request: any) => {
      const id = `job-${(fixture.jobCounter += 1)}`;
      const job: any = {
        id,
        request,
        items: [] as any[],
        index: 0,
        generation: 1,
        state: null,
        finished: false,
        resolve: () => undefined,
        completion: null,
      };
      job.completion = new Promise((resolve) => {
        job.resolve = resolve;
      });
      for (const source of request.sources) {
        const target = targetOf(source);
        if (
          request.kind !== "copy" &&
          fixture.systems.has(source) &&
          !request.allow_system
        ) {
          job.items.push({ source, target, status: "skipped", reason: "system_confirmation_required" });
          continue;
        }
        if (fixture.output.has(target)) {
          job.items.push({
            source,
            target,
            status: "pending",
            isDir: fixture.folders.has(target),
          });
          continue;
        }
        fixture.output.set(target, `new ${baseName(source)}`);
        job.items.push({ source, target, status: "done", to: target });
      }
      // The explicit system retry is the job the confirmation tests count.
      if (request.allow_system) {
        fixture.requests.push({ kind: request.kind, sources: request.sources, conflict: undefined });
      }
      fixture.jobs.push(job);
      const first = job.items.findIndex((item: any) => item.status === "pending");
      if (first >= 0) {
        job.index = first;
        job.state = stateOf(job, "waiting", decisionFor(job));
      } else {
        finish(job);
      }
      return { id, cancel: async () => undefined, completion: job.completion };
    },
    getTransferState: async (jobId: string) =>
      fixture.jobs.find((job) => job.id === jobId)?.state ?? null,
    controlTransfer: async (jobId: string) =>
      fixture.jobs.find((job) => job.id === jobId)?.state ?? null,
    decideTransfer: async (jobId: string, decision: any) => {
      const job = fixture.jobs.find((entry) => entry.id === jobId);
      if (!job) return null;
      const item = job.items[job.index];
      if (!item) return job.state;
      if (decision.action === "merge") {
        if (!item.isDir || (fixture.systems.has(item.target) && !job.request.allow_system)) {
          item.status = "skipped";
          item.reason = fixture.systems.has(item.target)
            ? "system_confirmation_required"
            : "exists";
        } else {
          fixture.output.set(`${item.target}\\new.txt`, "new file in folder");
          item.status = "done";
          item.to = item.target;
          fixture.requests.push({
            kind: job.request.kind,
            sources: [item.source],
            conflict: "merge",
          });
        }
      } else if (decision.action === "keepBoth") {
        const copy = item.target.replace(/(\.[^.]*)?$/, " - Copy$1");
        fixture.output.set(copy, `new ${baseName(item.source)}`);
        item.status = "done";
        item.to = copy;
        fixture.requests.push({
          kind: job.request.kind,
          sources: [item.source],
          conflict: "keepBoth",
        });
      } else {
        item.status = "skipped";
        item.reason = "exists";
      }
      return advance(job);
    },
    transferReportPage: async () =>
      reportOf(fixture.jobs[fixture.jobs.length - 1]),
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const item = (name: string): ExplorerItem => ({
  path: `C:\\Dest\\${name}`, name, kind: "file", size: 1, modified_unix: 0,
  hidden: false, system: false, is_link: false, online_only: false, file_id: null, file_id_stable: false,
});
const click = async (element: Element) => act(async () => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
});
let bridge: ExplorerPaletteBridge | null = null;
async function runCommand(id: string) {
  await act(async () => {
    bridge!.dispatchCommand(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const dialog = () =>
  container!.querySelector<HTMLElement>("[role='dialog']") ??
  document.querySelector<HTMLElement>(".adp-conflict-window");
async function answer(label: string) {
  const button = [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === label);
  expect(button, `dialog action ${label}`).toBeDefined();
  await click(button!);
}
async function renderFolder() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  bridge = null;
  await act(async () => root!.render(
    <>
      <ExplorerHome
        onOpenHelp={() => undefined}
        onPaletteBridge={(_owner, next) => { bridge = next; }}
        paletteOwnerId="explorer"
      />
      {/* The app hosts the transfer window once, outside whichever tab is
          active; the Explorer itself opens jobs through it. */}
      <TransferHost onOpenHelp={() => undefined} />
    </>,
  ));
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
  fixture.jobs = [];
  fixture.jobCounter = 0;
  closeTransfer();
});
afterEach(async () => {
  closeTransfer();
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
    await runCommand("explorer.paste");
    expect(dialog()?.textContent).toContain("folder");
    expect(dialog()?.textContent).toContain("Merge");
    // The apply-to-all box starts cleared, so each conflict is answered.
    await answer("Merge folders");
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
    await runCommand("explorer.paste");
    const labels = [...dialog()!.querySelectorAll("button")].map((button) => button.textContent);
    // Replace is always shown disabled with its reason (Step 09f); Merge is
    // never offered for a file conflict.
    const replace = [...dialog()!.querySelectorAll("button")].filter(
      (button) => button.textContent === "Replace",
    );
    expect(replace.length).toBeGreaterThan(0);
    expect(replace.every((button) => button.disabled)).toBe(true);
    expect(labels).not.toContain("Merge");
    expect(labels).toContain("Keep both");
  });

  it("cancels recycling a system item without starting a job", async () => {
    fixture.systems.add("C:\\Dest\\system.ini");
    await renderFolder();
    await click(container!.querySelector("[role='option']")!);
    await runCommand("explorer.delete");
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
    await runCommand("explorer.delete");
    expect(fixture.requests).toHaveLength(0);
    await answer("Continue");
    expect(fixture.requests.map((request) => request.kind)).toEqual(["recycle"]);
  });

  it("checks a clipboard move's fresh system attributes and cancels on Escape", async () => {
    fixture.sources = ["C:\\Source\\system.ini"];
    fixture.cut = true;
    fixture.systems.add(fixture.sources[0]);
    await renderFolder();
    await runCommand("explorer.paste");
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
    await runCommand("explorer.paste");
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
    await runCommand("explorer.paste");
    await answer("Merge folders");
    expect(dialog()?.textContent).toContain("system item");
    expect(fixture.requests).toHaveLength(0);
    await answer("Cancel");
    expect(fixture.output.get(fixture.conflicts[0].path)).toBe("old system folder");
    expect(fixture.requests).toHaveLength(0);
  });
});
