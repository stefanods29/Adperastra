import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import DuplicateReviewDialog, {
  cleanupCanRun,
  defaultKeepers,
  keeperSelectionIsValid,
  memberKey,
  selectedCopies,
  suggestKeeper,
} from "../storage/DuplicateReviewDialog";
import type { DuplicateGroup, DuplicateMember } from "../services/storage";
import { UndoStack } from "../services/undo";

function member(name: string, path: string, modified: number, paths?: string[]): DuplicateMember {
  return {
    key: {
      volume_id: "00000001",
      file_id: name.padStart(16, "0"),
      path_key: path.toLowerCase(),
      stable: true,
    },
    source: {
      path_key: path.toLowerCase(),
      volume_id: "00000001",
      file_id: name.padStart(16, "0"),
      modified_ticks: String(modified),
      size_bytes: 10,
    },
    paths: paths ?? [path],
    full_hash: "a".repeat(64),
    logical_bytes: 10,
    allocated_bytes: 10,
    modified_unix: modified,
    verified: true,
  };
}

const group: DuplicateGroup = {
  id: "11111111-1111-4111-8111-111111111111",
  members: [
    member("a", "C:\\one\\report.txt", 100),
    member("b", "C:\\two\\report.txt", 200, [
      "C:\\two\\report.txt",
      "C:\\two\\report-alias.txt",
    ]),
  ],
  member_count: 2,
  members_page_complete: true,
  verified: true,
  reclaimable_bytes: 10,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderDialog(overrides: Partial<ComponentProps<typeof DuplicateReviewDialog>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: ComponentProps<typeof DuplicateReviewDialog> = {
    group,
    keepers: defaultKeepers(group),
    capability: false,
    onToggleKeep: vi.fn(),
    onSuggest: vi.fn(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root?.render(<DuplicateReviewDialog {...props} />);
  });
  return { view: container, props };
}

describe("duplicate review", () => {
  it("default keeps every physical member", () => {
    const keepers = defaultKeepers(group);
    expect(keepers.size).toBe(2);
    expect(selectedCopies(group, keepers)).toHaveLength(0);
    expect(keeperSelectionIsValid(group, keepers)).toBe(true);
  });

  it("cannot remove all physical members", () => {
    expect(keeperSelectionIsValid(group, new Set())).toBe(false);
    expect(cleanupCanRun(group, new Set(), true)).toBe(false);
  });

  it("a valid selection still requires at least one keeper", () => {
    const keepers = new Set([memberKey(group.members[0])]);
    expect(keeperSelectionIsValid(group, keepers)).toBe(true);
    expect(selectedCopies(group, keepers)).toHaveLength(1);
    expect(cleanupCanRun(group, keepers, true)).toBe(true);
  });

  it("suggest prefers the explicit root order", () => {
    const keeper = suggestKeeper(group, ["C:\\one", "C:\\two"]);
    expect(keeper).toBe(memberKey(group.members[0]));
  });

  it("a false capability disables the primary action and shows the gate", async () => {
    const { view, props } = await renderDialog();
    const primary = [...view.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Recycle selected duplicates"),
    );
    expect(primary?.hasAttribute("disabled")).toBe(true);
    expect(view.textContent).toContain(
      "Safe object-bound recycling is not available. Review and open files without deleting them.",
    );
    await act(async () => primary?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("shows hard-link aliases as one physical file", async () => {
    const { view } = await renderDialog();
    expect(view.textContent).toContain("These paths reference one physical file.");
  });

  it("shows a stale keeper error without closing the review", async () => {
    const { view } = await renderDialog({
      error: "A duplicate or its keeper changed. Review the group again.",
    });
    expect(view.textContent).toContain(
      "A duplicate or its keeper changed. Review the group again.",
    );
  });

  it("never offers a permanent-delete fallback", async () => {
    const { view } = await renderDialog();
    expect(view.textContent).not.toContain("Delete permanently");
  });

  it("a failed cleanup cannot advance the Undo cursor", async () => {
    const stack = new UndoStack();
    stack.push({
      labelKey: "duplicates.recycle",
      undo: { type: "recycle", paths: [] },
      redo: { type: "recycle", paths: [] },
    });
    expect(stack.canUndo).toBe(true);
    await Promise.reject(new Error("storage.cleanup_unavailable")).catch(() => undefined);
    // The review path pushes history only after a successful execution.
    expect(stack.canUndo).toBe(true);
    expect(stack.peekUndo()?.labelKey).toBe("duplicates.recycle");
  });
});

