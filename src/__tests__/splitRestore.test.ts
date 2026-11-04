import { describe, expect, it } from "vitest";
import type { DocumentHandle } from "../documents/types";
import { closeSplit, type SplitCloseHost } from "../services/splitActions";
import {
  restoreSplitTab,
  SplitOpenBudget,
  type SplitRestoreHost,
} from "../services/splitRestore";
import {
  createSplitTab,
  serializeSplit,
  serializeSplitTab,
  setSplitActiveSide,
  type SavedSplitDescriptor,
  type SplitLeaf,
} from "../services/splitViews";
import { EXPLORER_TAB, type TabState, type TabsState } from "../services/tabs";
import type { TransferEnvelope, TransferTarget } from "../transfer/types";
import { dropIntoActiveLeaf } from "../transfer/splitDropRouting";

const name = (path: string) => path.split("\\").pop() ?? path;

function fileTab(id: string, path: string, extra: Partial<TabState> = {}): TabState {
  return {
    id,
    kind: "file",
    path,
    handler: "text",
    title: name(path),
    source: { kind: "disk", path },
    ...extra,
  };
}

function stateWith(tabs: TabState[]): TabsState {
  return { tabs: [EXPLORER_TAB, ...tabs], activeId: tabs[0]?.id ?? EXPLORER_TAB.id, history: [EXPLORER_TAB.id] };
}

function descriptor(): SavedSplitDescriptor {
  const saved = serializeSplit({
    first: {
      view_id: "view-a",
      kind: "file",
      source: { kind: "disk", path: "C:\\a.txt" },
      handler: "text",
      title: "a.txt",
    },
    second: {
      view_id: "view-b",
      kind: "file",
      source: { kind: "disk", path: "C:\\b.xyz" },
      handler: "missing-handler",
      title: "b.xyz",
    },
    direction: "vertical",
    ratio: 0.5,
    active_side: "first",
    sync_scroll: false,
  });
  if (!saved) throw new Error("fixture descriptor is invalid");
  return saved;
}

function handle(id: string): DocumentHandle {
  const source = { kind: "disk" as const, path: `C:\\${id}.txt` };
  return {
    id,
    source,
    info: {
      document_id: id,
      source,
      name: `${id}.txt`,
      ext: "txt",
      mime: "text/plain",
      size: 4,
      modified_unix: 0,
      read_only: false,
      from_internet: false,
      sensitive: false,
      disk_path: source.path,
    },
    getState: () => ({
      revision: 1,
      saved_revision: 1,
      content_id: id,
      saved_content_id: id,
      dirty: false,
      ready: true,
      editing_enabled: false,
      can_save_existing: false,
      can_save_copy: true,
    }),
    subscribe: () => () => undefined,
    readRange: async () => new Uint8Array(),
    captureSnapshot: async () => {
      throw new Error("snapshots are not part of these tests");
    },
    save: async () => false,
    saveCopy: async () => false,
    discard: async () => undefined,
    release: () => undefined,
  };
}

const envelope: TransferEnvelope = {
  transfer_id: "transfer-1",
  sensitive: false,
  payload: { kind: "text", text: "hello" },
  expires_unix: 0,
};

describe("split restore and routing", () => {
  it("global2openlimit: a split restore shares the pass's two-open budget", async () => {
    const budget = new SplitOpenBudget(2);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const normal = [budget.run(async () => 1), budget.run(async () => 2)];
    const host: SplitRestoreHost = { openLeaf: async (leaf: SplitLeaf) => leaf };
    const restoring = restoreSplitTab(descriptor(), host, { budget });
    await Promise.resolve();
    expect(budget.active).toBe(2);
    expect(budget.peak).toBe(2);

    release();
    const [result] = await Promise.all([restoring, ...normal]);
    expect(result).not.toBeNull();
    expect(budget.peak).toBe(2);
  });

  it("normalprotectedpipeline: every leaf is opened through the host, placeholders included", async () => {
    const seen: SplitLeaf[] = [];
    const host: SplitRestoreHost = {
      openLeaf: async (leaf) => {
        seen.push(leaf);
        return leaf.handler === "missing-handler" ? { ...leaf, missing: { reason: "handler_missing" } } : leaf;
      },
    };
    const saved = descriptor();
    const result = await restoreSplitTab(saved, host, { budget: new SplitOpenBudget(2) });

    expect(result).not.toBeNull();
    expect(result?.tab.kind).toBe("split");
    expect(result?.missing).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0].source).toEqual(saved.split.first.source);
    expect(seen[0].handler).toBe("text");
    expect(seen[1].handler).toBe("missing-handler");
    // Restore mints fresh view ids; the host acquires under the new id.
    expect(seen[0].view_id).not.toBe(saved.split.first.view_id);
    expect(seen[1].view_id).not.toBe(saved.split.second.view_id);
    const tab = result?.tab;
    expect(tab?.kind === "split" ? tab.split!.second.missing?.reason : "").toBe("handler_missing");
  });

  it("dropsgoactiveleaf: a drop reaches only the active side, and never an unregistered target", async () => {
    const base = createSplitTab(
      stateWith([fileTab("view-a", "C:\\a.txt"), fileTab("view-b", "C:\\b.txt")]),
      "view-a",
      "view-b",
      "vertical",
    );
    const outerId = base.activeId;
    const state = setSplitActiveSide(base, outerId, "second");
    const tab = state.tabs[1];

    const dropped: { viewId: string; paths: readonly string[] }[] = [];
    const target: TransferTarget = {
      target_id: "text-editor",
      accepted_kinds: ["text"],
      describe: () => [{ id: "insert_text", label_key: "transfer.insertText", losses: [], mutates: true }],
      accept: async () => ({
        transaction_id: "transaction-1",
        inserted_count: 1,
        losses: [],
        complete: true,
      }),
    };
    const host = {
      targetFor: () => target,
      dropFiles: async (viewId: string, paths: readonly string[]) => {
        dropped.push({ viewId, paths });
      },
    };

    const files = await dropIntoActiveLeaf(tab, { kind: "files", paths: ["C:\\x\\one.txt"] }, host);
    expect(files.accepted).toBe(true);
    expect(dropped).toEqual([{ viewId: "view-b", paths: ["C:\\x\\one.txt"] }]);

    const content = await dropIntoActiveLeaf(tab, { kind: "content", envelope }, host);
    expect(content).toEqual(
      expect.objectContaining({ accepted: true, route: expect.objectContaining({ view_id: "view-b" }) }),
    );
    if (!content.accepted) return;
    expect(content.actions.map((action) => action.id)).toEqual(["insert_text"]);

    // No registered target: no drop, never an assumed editable target.
    const refused = await dropIntoActiveLeaf(tab, { kind: "content", envelope }, { ...host, targetFor: () => null });
    expect(refused).toEqual(expect.objectContaining({ accepted: false, code: "transfer.unsupported" }));

    // A relative or empty path list never reaches the file pipeline.
    const invalid = await dropIntoActiveLeaf(tab, { kind: "files", paths: ["one.txt"] }, host);
    expect(invalid).toEqual(expect.objectContaining({ accepted: false, code: "transfer.invalid" }));
    expect(dropped).toHaveLength(1);
  });

  it("groupbelongsouter: the split tab, never a leaf, keeps the group", async () => {
    const host: SplitRestoreHost = { openLeaf: async (leaf) => leaf };
    const result = await restoreSplitTab(descriptor(), host, { budget: new SplitOpenBudget(2), group_id: "group-1" });
    expect(result?.tab.group_id).toBe("group-1");
    const saved = serializeSplitTab(result!.tab);
    expect(saved).not.toBeNull();
    expect(JSON.stringify(saved)).not.toContain("group_id");

    const grouped = createSplitTab(
      stateWith([fileTab("view-a", "C:\\a.txt", { group_id: "group-1" }), fileTab("view-b", "C:\\b.txt")]),
      "view-a",
      "view-b",
      "vertical",
    );
    const outer = grouped.tabs[1];
    expect(outer.group_id).toBe("group-1");
    expect(outer.kind === "split" ? outer.split!.first : null).not.toHaveProperty("group_id");
  });

  it("closingoneleafkeepssharedmodel: two views of one document prompt nothing and keep the model", async () => {
    const state = createSplitTab(
      stateWith([fileTab("view-a", "C:\\shared.txt"), fileTab("view-b", "C:\\shared.txt")]),
      "view-a",
      "view-b",
      "vertical",
    );
    const outerId = state.activeId;
    const shared = handle("doc-shared");
    const released: string[] = [];
    let prompts = 0;
    const host: SplitCloseHost = {
      documentsFor: () => [shared],
      prepareClose: async () => {
        prompts += 1;
        return true;
      },
      releaseView: (id) => released.push(id),
    };

    const closed = await closeSplit(state, outerId, "first", host);
    expect(prompts).toBe(0);
    expect(released).toEqual(["view-a"]);
    expect(closed?.state.tabs[1].content_view_id).toBe("view-b");
    // The surviving view still resolves the same shared document.
    expect(host.documentsFor(["view-b"])[0].id).toBe("doc-shared");
  });
});
