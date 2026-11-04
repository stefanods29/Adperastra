import { describe, expect, it } from "vitest";
import type { FileIdentityKey } from "../services/fileIdentity";
import type { IdentityEffect, TagAssignment } from "../services/tags";
import { createTagCommands } from "../tags/tagCommands";
import { applyIdentityEvents } from "../tags/tagIdentityCache";
import { resolveTabKey } from "../services/tabKeyRouting";
import { initialTabs, type TabsState } from "../services/tabs";

function key(volume: string, file: string, pathKey: string, stable = true): FileIdentityKey {
  return { volume_id: volume, file_id: file, path_key: pathKey, stable };
}

function assignment(rowKey: FileIdentityKey, tagIds: string[], revision = 1): TagAssignment {
  return { key: rowKey, display_path: rowKey.path_key, tag_ids: tagIds, revision };
}

function effect(
  kind: IdentityEffect["kind"],
  from: FileIdentityKey,
  to: FileIdentityKey,
  complete = true,
): IdentityEffect {
  return {
    operation_id: "00000000-0000-4000-8000-000000000010",
    sequence: 1,
    kind,
    from_key: from,
    from_path: from.path_key,
    to_key: to,
    to_path: to.path_key,
    complete,
  };
}

const tagA = "0f8fad1e-0001-4a3b-9c4d-000000000001";
const tagB = "0f8fad1e-0002-4a3b-9c4d-000000000002";

describe("tag identity cache", () => {
  it("crossvolumemovechangesexactkey", () => {
    const source = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\a.txt");
    const target = key("22222222", "bbbbbbbbbbbbbbbb", "d:\\keep\\a.txt");
    const { assignments, rescan } = applyIdentityEvents(
      [assignment(source, [tagA])],
      [{ kind: "effect", effect: effect("move", source, target) }],
    );
    expect(rescan).toBe(false);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].key).toEqual(target);
    expect(assignments[0].display_path).toBe("d:\\keep\\a.txt");
    expect(assignments[0].tag_ids).toEqual([tagA]);
    expect(assignments.some((row) => row.key.volume_id === "11111111")).toBe(false);
  });

  it("copykeepssource", () => {
    const source = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\a.txt");
    const copy = key("11111111", "cccccccccccccccc", "c:\\work\\a (2).txt");
    const { assignments } = applyIdentityEvents(
      [assignment(source, [tagA, tagB])],
      [{ kind: "effect", effect: effect("copy", source, copy) }],
    );
    expect(assignments).toHaveLength(2);
    expect(assignments[0].key).toEqual(source);
    expect(assignments[1].key).toEqual(copy);
    expect(assignments[1].tag_ids).toEqual([tagA, tagB]);
  });

  it("unprovedreceiptignored", () => {
    const source = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\a.txt");
    const unstableTarget = key("11111111", "dddddddddddddddd", "c:\\work\\b.txt", false);
    const unchanged = applyIdentityEvents(
      [assignment(source, [tagA])],
      [{ kind: "effect", effect: effect("copy", source, unstableTarget) }],
    );
    expect(unchanged.assignments).toHaveLength(1);
    expect(unchanged.assignments[0].key).toEqual(source);

    const incomplete = effect("move", source, unstableTarget, false);
    const still = applyIdentityEvents(
      [assignment(source, [tagA])],
      [{ kind: "effect", effect: incomplete }],
    );
    expect(still.assignments[0].key).toEqual(source);

    const pathOnly = key("00000000", "0000000000000000", "c:\\work\\a.txt", false);
    const byPath = applyIdentityEvents(
      [assignment(pathOnly, [tagA])],
      [{ kind: "effect", effect: effect("move", pathOnly, unstableTarget) }],
    );
    expect(byPath.assignments[0].key).toEqual(pathOnly);
  });

  it("staleindexrevisionignored", () => {
    // The search index applies the authoritative revision gate natively
    // (tag_search_bridge::stale_index_revision_is_ignored); the visible cache
    // never invents a revision or lowers the one an assignment already has.
    const source = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\a.txt");
    const copy = key("11111111", "cccccccccccccccc", "c:\\work\\a (2).txt");
    const { assignments } = applyIdentityEvents(
      [assignment(source, [tagA], 5)],
      [{ kind: "effect", effect: effect("copy", source, copy) }],
    );
    expect(assignments.every((row) => row.revision >= 5)).toBe(true);
    expect(assignments[1].revision).toBe(5);
  });

  it("hardlinkstableidentitysame", () => {
    const from = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\link1.txt");
    const to = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\link2.txt");
    const { assignments } = applyIdentityEvents(
      [assignment(from, [tagA])],
      [{ kind: "effect", effect: effect("rename", from, to) }],
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0].key).toEqual(to);
    expect(assignments[0].display_path).toBe("c:\\work\\link2.txt");
  });

  it("never merges two tagged records when the destination already exists", () => {
    const source = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\a.txt");
    const target = key("22222222", "bbbbbbbbbbbbbbbb", "d:\\keep\\a.txt");
    const { assignments } = applyIdentityEvents(
      [assignment(source, [tagA]), assignment(target, [tagB])],
      [{ kind: "effect", effect: effect("move", source, target) }],
    );
    expect(assignments).toHaveLength(2);
    expect(assignments[0].tag_ids).toEqual([tagA]);
    expect(assignments[1].tag_ids).toEqual([tagB]);
  });

  it("overflow asks for a rescan without rewriting a row", () => {
    const source = key("11111111", "aaaaaaaaaaaaaaaa", "c:\\work\\a.txt");
    const { assignments, rescan } = applyIdentityEvents(
      [assignment(source, [tagA])],
      [{ kind: "overflow", last_sequence: 41 }],
    );
    expect(rescan).toBe(true);
    expect(assignments).toEqual([assignment(source, [tagA])]);
  });
});

describe("tag commands and tab shortcuts", () => {
  it("Ctrl1stilltab", () => {
    const commands = createTagCommands({
      addTags: () => undefined,
      removeTags: () => undefined,
      manageTags: () => undefined,
      saveSmartFolder: () => undefined,
      openIndexedView: () => undefined,
    });
    expect(commands.every((command) => command.shortcut === undefined)).toBe(true);

    const state: TabsState = {
      ...initialTabs(),
      tabs: [
        { id: "explorer", kind: "explorer" },
        { id: "file-1", kind: "file", path: "C:\\a.txt" },
      ],
    };
    const action = resolveTabKey(
      { key: "1", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false },
      state,
      { searchFocused: false, textEditing: false },
    );
    expect(action).toEqual({ type: "activate", id: "explorer" });
  });
});
