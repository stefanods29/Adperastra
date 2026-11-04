import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORER_TAB, type TabsState } from "../services/tabs";
import { createTabGroup } from "../services/tabGroups";
import {
  SavedGroupHistory,
  buildSavedGroup,
  listSavedGroups,
  removeSavedGroup,
  validateSavedTabGroup,
  writeSavedGroup,
  type SavedGroupCatalog,
  type SavedTabGroup,
} from "../services/savedGroups";
import {
  exportSavedGroups,
  importSavedGroups,
  pickSavedGroupsImport,
} from "../services/savedGroupTransfer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

const ID_A = "00000000-0000-4000-8000-000000000001";
const ID_B = "00000000-0000-4000-8000-000000000002";

function savedGroup(id: string, name = "Work"): SavedTabGroup {
  return {
    id,
    name,
    color: "purple",
    tabs: [{ kind: "file", title: "a.txt", path: "C:\\Demo\\a.txt", handler: "text", pinned: false }],
    active_index: 0,
    created_unix: 10,
    modified_unix: 20,
    version: 1,
  };
}

function catalog(groups: SavedTabGroup[], revision: number): SavedGroupCatalog {
  return { schema_version: 1, groups, revision };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("saved group catalog service (step 09b T3)", () => {
  it("mirrors the native revision arguments exactly", async () => {
    const result = catalog([savedGroup(ID_A)], 4);
    invokeMock.mockResolvedValue(result);
    await expect(listSavedGroups()).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("saved_groups_list");

    const group = savedGroup(ID_A);
    await writeSavedGroup({ expected_revision: 3, group });
    expect(invokeMock).toHaveBeenCalledWith("saved_group_write", {
      request: { expected_revision: 3, group },
    });

    await removeSavedGroup(ID_B, 4);
    expect(invokeMock).toHaveBeenCalledWith("saved_group_remove", {
      id: ID_B,
      expectedRevision: 4,
    });

    await exportSavedGroups([ID_A], "C:\\Demo\\out.adpgroups");
    expect(invokeMock).toHaveBeenCalledWith("saved_groups_export", {
      ids: [ID_A],
      destPath: "C:\\Demo\\out.adpgroups",
    });

    await importSavedGroups("C:\\Demo\\in.adpgroups", 4);
    expect(invokeMock).toHaveBeenCalledWith("saved_groups_import", {
      path: "C:\\Demo\\in.adpgroups",
      expectedRevision: 4,
    });

    await pickSavedGroupsImport("Import groups…", "Adperastra groups (*.adpgroups)");
    expect(invokeMock).toHaveBeenCalledWith("saved_groups_pick_import", {
      title: "Import groups…",
      filterName: "Adperastra groups (*.adpgroups)",
    });
  });

  it("refuses a pinned or named virtual descriptor before invoking", () => {
    const pinned = savedGroup(ID_A);
    pinned.tabs[0].pinned = true as never;
    expect(() => validateSavedTabGroup(pinned)).toThrow("groups.invalid");
    const virtualNamed = savedGroup(ID_A);
    virtualNamed.tabs[0].source = {
      kind: "virtual",
      container_path: "C:\\locked.adplock",
      entry_id: ID_B,
    } as never;
    expect(() => validateSavedTabGroup(virtualNamed)).toThrow("groups.invalid");
  });

  it("buildSavedGroup strips runtime ids and tokens", () => {
    const base: TabsState = {
      tabs: [
        EXPLORER_TAB,
        {
          id: "file-1",
          kind: "file",
          title: "a.txt",
          path: "C:\\Demo\\a.txt",
          handler: "text",
        },
      ],
      activeId: "file-1",
      history: ["explorer", "file-1"],
      groups: [],
    };
    const grouped = createTabGroup(base, ["file-1"], "Work", "blue");
    const saved = buildSavedGroup(grouped, grouped.groups?.[0].id ?? "", 99);
    expect(saved.tabs).toHaveLength(1);
    expect(saved.active_index).toBe(0);
    const descriptor = saved.tabs[0] as unknown as Record<string, unknown>;
    expect(descriptor).not.toHaveProperty("id");
    expect(descriptor).not.toHaveProperty("group_id");
    expect(descriptor).not.toHaveProperty("document_id");
    expect(JSON.stringify(saved)).not.toContain("file-1");
    expect(saved.color).toBe("blue");
  });

  it("applies a recorded catalog through revision-checked writes", async () => {
    let current = catalog([savedGroup(ID_A)], 1);
    const port = {
      list: async () => current,
      write: async (request: { expected_revision: number; group: SavedTabGroup }) => {
        expect(request.expected_revision).toBe(current.revision);
        const existing = current.groups.findIndex((g) => g.id === request.group.id);
        const groups = [...current.groups];
        if (existing >= 0) groups[existing] = request.group;
        else groups.push(request.group);
        current = catalog(groups, current.revision + 1);
        return current;
      },
      remove: async (id: string, expectedRevision: number) => {
        expect(expectedRevision).toBe(current.revision);
        current = catalog(
          current.groups.filter((g) => g.id !== id),
          current.revision + 1,
        );
        return current;
      },
    };
    const history = new SavedGroupHistory(port);
    const beforeCatalog = catalog([savedGroup(ID_A)], 1);
    const afterCatalog = catalog([savedGroup(ID_A), savedGroup(ID_B, "More")], 2);
    const id = history.record(beforeCatalog, afterCatalog);
    await history.apply(id, false);
    expect(current.groups.map((g) => g.id)).toEqual([ID_A, ID_B]);
    await history.apply(id, true);
    expect(current.groups.map((g) => g.id)).toEqual([ID_A]);
    await expect(history.apply("00000000-0000-4000-8000-000000000099", true)).rejects.toThrow(
      "groups.changed",
    );
    history.releaseUnreferenced([id]);
    await expect(history.apply(id, false)).rejects.toThrow("groups.changed");
  });
});
