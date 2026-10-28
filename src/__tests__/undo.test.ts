import { describe, expect, it } from "vitest";
import { UndoStack, type FileAction } from "../services/undo";

const rename = (from: string, to: string): FileAction => ({ type: "rename", from, to });

function pushRename(stack: UndoStack, labelKey = "toast.renamed") {
  stack.push({
    labelKey,
    undo: rename("C:\\b.txt", "C:\\a.txt"),
    redo: rename("C:\\a.txt", "C:\\b.txt"),
  });
}

describe("undo stack", () => {
  it("undoes newest first, then redoes in the original order", () => {
    const stack = new UndoStack();
    pushRename(stack, "toast.first");
    pushRename(stack, "toast.second");
    expect(stack.peekUndo()?.labelKey).toBe("toast.second");
    stack.confirmUndo();
    expect(stack.peekUndo()?.labelKey).toBe("toast.first");
    expect(stack.peekRedo()?.labelKey).toBe("toast.second");
    stack.confirmUndo();
    expect(stack.peekUndo()).toBeNull();
    expect(stack.peekRedo()?.labelKey).toBe("toast.first");
    stack.confirmRedo();
    expect(stack.peekUndo()?.labelKey).toBe("toast.first");
  });

  it("a new action clears the redo history", () => {
    const stack = new UndoStack();
    pushRename(stack);
    stack.confirmUndo();
    expect(stack.canRedo).toBe(true);
    pushRename(stack, "toast.new");
    expect(stack.canRedo).toBe(false);
    expect(stack.peekRedo()).toBeNull();
  });

  it("an unconfirmed undo stays on top (a failed undo changes nothing)", () => {
    const stack = new UndoStack();
    pushRename(stack);
    expect(stack.peekUndo()?.labelKey).toBe("toast.renamed");
    expect(stack.peekUndo()?.labelKey).toBe("toast.renamed");
    expect(stack.canUndo).toBe(true);
  });

  it("groups several pushes into one entry that undoes as one step", () => {
    const stack = new UndoStack();
    stack.beginGroup("toast.bulk");
    pushRename(stack);
    pushRename(stack);
    stack.endGroup();
    expect(stack.entries).toHaveLength(1);
    const entry = stack.peekUndo();
    expect(entry?.labelKey).toBe("toast.bulk");
    expect(entry?.undo.type).toBe("sequence");
    if (entry?.undo.type === "sequence") {
      // Undos run newest-first inside the group.
      expect(entry.undo.actions).toHaveLength(2);
    }
  });

  it("keeps at most 100 entries and lists recent actions newest first", () => {
    const stack = new UndoStack();
    for (let i = 0; i < 105; i += 1) pushRename(stack, `toast.n${i}`);
    expect(stack.entries).toHaveLength(100);
    const recent = stack.recent(3);
    expect(recent.map((item) => item.entry.labelKey)).toEqual(["toast.n104", "toast.n103", "toast.n102"]);
    expect(recent.every((item) => item.canUndo)).toBe(true);
    expect(stack.entries[0].labelKey).toBe("toast.n5");
  });
});
