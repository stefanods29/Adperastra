import { describe, expect, it, vi } from "vitest";
import { EXPLORER_TAB, type TabState, type TabsState } from "../services/tabs";
import type { TabGroup } from "../services/tabGroups";
import type { SavedTabDescriptor, SavedTabGroup } from "../services/savedGroups";
import { restoreSavedGroup, type GroupRestoreHost } from "../tabs/restoreSavedGroup";

const ID_A = "00000000-0000-4000-8000-000000000001";

function descriptor(path: string): SavedTabDescriptor {
  return { kind: "file", title: path.split("\\").pop(), path, handler: "text", pinned: false };
}

function saved(paths: string[], activeIndex = 0): SavedTabGroup {
  return {
    id: ID_A,
    name: "Work",
    color: "teal",
    tabs: paths.map(descriptor),
    active_index: activeIndex,
    created_unix: 10,
    modified_unix: 20,
    version: 1,
  };
}

class FakeHost implements GroupRestoreHost {
  state: TabsState;
  opened: { descriptor: SavedTabDescriptor; background: boolean }[] = [];
  committed: { group: TabGroup; activeId: string } | null = null;
  rolledBack = 0;
  reservedWith: number | null = null;
  maxConcurrent = 0;
  private concurrent = 0;
  private counter = 0;
  /** path -> error code the open pipeline reports for it. */
  failures = new Map<string, string>();
  /** path -> 09a missing-placeholder reason for the created tab. */
  placeholders = new Map<string, "not_found" | "handler_missing" | "locked">();

  constructor(tabCount = 1) {
    const tabs: TabState[] = [EXPLORER_TAB];
    for (let index = 1; index < tabCount; index += 1) {
      tabs.push({ id: `existing-${index}`, kind: "file", path: `C:\\old-${index}.txt`, handler: "text" });
    }
    this.state = { tabs, activeId: "explorer", history: ["explorer"], groups: [] };
  }

  getState(): TabsState {
    return this.state;
  }

  async reserve(count: number): Promise<string> {
    this.reservedWith = count;
    return "reservation-1";
  }

  async open(descriptorOpen: SavedTabDescriptor, background: boolean): Promise<string> {
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    this.opened.push({ descriptor: descriptorOpen, background });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    this.concurrent -= 1;
    const failure = descriptorOpen.path ? this.failures.get(descriptorOpen.path) : undefined;
    if (failure) throw new Error(failure);
    this.counter += 1;
    const id = `restored-${this.counter}`;
    const fromPath = descriptorOpen.path ? this.placeholders.get(descriptorOpen.path) : undefined;
    const reason =
      fromPath ??
      ((descriptorOpen.source as { kind?: string } | undefined)?.kind === "virtual"
        ? "handler_missing"
        : undefined);
    const tab: TabState = {
      id,
      kind: "file",
      title: descriptorOpen.title,
      path: descriptorOpen.path,
      handler: descriptorOpen.handler,
      ...(reason ? { missing: { reason } } : {}),
    };
    this.state = { ...this.state, tabs: [...this.state.tabs, tab] };
    return id;
  }

  async commit(group: TabGroup, activeId: string): Promise<void> {
    this.committed = { group, activeId };
  }

  async rollback(): Promise<void> {
    this.rolledBack += 1;
  }
}

describe("restore saved group (step 09b T4)", () => {
  it("visible_first_two_open_limit", async () => {
    const host = new FakeHost();
    const group = saved(["C:\\a.txt", "C:\\b.txt", "C:\\c.txt", "C:\\d.txt", "C:\\e.txt"], 2);
    const report = await restoreSavedGroup(group, host);
    expect(host.opened[0].descriptor.path).toBe("C:\\c.txt");
    expect(host.opened[0].background).toBe(false);
    expect(host.opened.slice(1).every((entry) => entry.background)).toBe(true);
    expect(host.maxConcurrent).toBeLessThanOrEqual(2);
    expect(report.tab_ids).toHaveLength(5);
    expect(host.committed?.activeId).toBe(report.tab_ids[2]);
    expect(host.committed?.group.tab_ids).toEqual(report.tab_ids);
    expect(host.committed?.group.id).not.toBe(ID_A);
  });

  it("missing_member_does_not_abort_others", async () => {
    const host = new FakeHost();
    host.failures.set("C:\\gone.txt", "files.not_found");
    const report = await restoreSavedGroup(saved(["C:\\a.txt", "C:\\gone.txt", "C:\\b.txt"]), host);
    expect(report.missing_count).toBe(1);
    expect(report.tab_ids).toHaveLength(2);
    expect(host.committed).not.toBeNull();
    expect(host.rolledBack).toBe(0);
  });

  it("capacity_failure_opens_nothing", async () => {
    const host = new FakeHost(199);
    await expect(
      restoreSavedGroup(saved(["C:\\a.txt", "C:\\b.txt"]), host),
    ).rejects.toThrow("groups.limit");
    expect(host.opened).toHaveLength(0);
    expect(host.reservedWith).toBeNull();
    expect(host.committed).toBeNull();
  });

  it("unknown_provider_placeholder", async () => {
    const host = new FakeHost();
    host.placeholders.set("C:\\locked-note.txt", "handler_missing");
    const group = saved(["C:\\a.txt", "C:\\locked-note.txt"]);
    group.tabs[1].source = {
      kind: "virtual",
      provider: "locked",
      container_path: "C:\\locked.adplock",
      entry_id: "00000000-0000-4000-8000-000000000009",
    } as never;
    delete group.tabs[1].title;
    delete group.tabs[1].path;
    const report = await restoreSavedGroup(group, host);
    expect(report.unsupported_count).toBe(1);
    expect(report.tab_ids).toHaveLength(2);
    expect(host.committed?.group.tab_ids).toEqual(report.tab_ids);
  });

  it("a hard failure rolls back only the new reservation", async () => {
    const host = new FakeHost();
    host.failures.set("C:\\b.txt", "groups.io");
    await expect(
      restoreSavedGroup(saved(["C:\\a.txt", "C:\\b.txt"]), host),
    ).rejects.toThrow("groups.io");
    expect(host.rolledBack).toBe(1);
    expect(host.committed).toBeNull();
  });
});
