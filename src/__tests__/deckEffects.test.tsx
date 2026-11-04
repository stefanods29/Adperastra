import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildAnimation, assertLiveAnimationId, animationTransaction, removeAnimationTransaction } from "../office/deck/DeckAnimations";
import { requiresCommentDeleteConfirm } from "../office/deck/DeckComments";
import { buildTransition, transitionTransaction } from "../office/deck/DeckTransitions";
import type { OfficeController } from "../office/OfficeController";
import type { OfficeEditComment } from "../office/types";

function controller() {
  const state = {
    session_id: "00000000-0000-4000-8000-000000000001",
    document_id: "00000000-0000-4000-8000-0000000000aa",
    revision: 2, content_id: "c", ready: true, busy: false, mode: "editing",
  };
  const transact = vi.fn(async (transaction: { transaction_id: string; operations: unknown[] }) => ({
    transaction_id: transaction.transaction_id, state: { ...state, revision: 3, document_id: state.document_id },
    changed: true, affected_ids: [], warnings: [],
  }));
  return { controller: { getState: () => state, transact } as unknown as OfficeController, transact };
}

describe("deck transitions and animations", () => {
  it("fade at 500 ms is stored exactly", () => {
    expect(buildTransition("fade", 500, true, null)).toEqual({
      kind: "fade", duration_ms: 500, advance_on_click: true, advance_after_ms: null,
    });
    expect(buildTransition("fade", 99_999, true, 99_999_999).duration_ms).toBe(10_000);
  });

  it("a selected slide effect never changes another slide", async () => {
    const f = controller();
    await transitionTransaction(f.controller, buildTransition("push", 300, false, 1000), ["00000000-0000-4000-8000-000000000002"]);
    expect(f.transact.mock.calls[0][0].operations).toEqual([{
      family: "deck", operation: {
        kind: "set_transition", slide_ids: ["00000000-0000-4000-8000-000000000002"],
        transition: { kind: "push", duration_ms: 300, advance_on_click: false, advance_after_ms: 1000 },
      },
    }]);
  });

  it("an unsupported imported animation is preserved on a normal edit", async () => {
    const f = controller();
    const selection = {
      kind: "deck" as const, slide_ids: ["00000000-0000-4000-8000-000000000002"],
      shape_ids: ["00000000-0000-4000-8000-000000000003"], text_span: null,
    };
    await animationTransaction(f.controller, selection, "00000000-0000-4000-8000-0000000000a1",
      buildAnimation("fade", "on_click", 500, 0, "left"));
    const operations = f.transact.mock.calls[0][0].operations;
    expect(operations).toHaveLength(1);
    expect(JSON.stringify(operations)).not.toContain("remove_animation");
    expect(JSON.stringify(operations)).not.toContain("00000000-0000-4000-8000-0000000000a2");
  });

  it("a stale effect id is rejected", () => {
    const live = new Set(["00000000-0000-4000-8000-0000000000a1"]);
    expect(() => assertLiveAnimationId(live, "00000000-0000-4000-8000-0000000000a2")).toThrow("office_edit.changed");
    expect(() => assertLiveAnimationId(live, "00000000-0000-4000-8000-0000000000a1")).not.toThrow();
  });

  it("removing an animation targets exactly that animation", async () => {
    const f = controller();
    await removeAnimationTransaction(f.controller, {
      kind: "deck", slide_ids: ["00000000-0000-4000-8000-000000000002"],
      shape_ids: ["00000000-0000-4000-8000-000000000003"], text_span: null,
    }, "00000000-0000-4000-8000-0000000000a1");
    expect(f.transact.mock.calls[0][0].operations).toEqual([{
      family: "deck",
      operation: { kind: "remove_animation", slide_id: "00000000-0000-4000-8000-000000000002", animation_id: "00000000-0000-4000-8000-0000000000a1" },
    }]);
  });

  it("deleting a comment always asks for confirmation", () => {
    const comment = { id: "c", author: "A", text: "note", created_unix: 1, resolved: false } as OfficeEditComment;
    expect(requiresCommentDeleteConfirm(comment)).toBe(true);
  });

  it("comment and effect surfaces contain no active content execution", () => {
    const comments = readFileSync(fileURLToPath(repoUrl("../office/deck/DeckComments.tsx", import.meta.url)), "utf8");
    const transitions = readFileSync(fileURLToPath(repoUrl("../office/deck/DeckTransitions.tsx", import.meta.url)), "utf8");
    expect(comments).not.toContain("dangerouslySetInnerHTML");
    expect(transitions).not.toContain("dangerouslySetInnerHTML");
    expect(comments).not.toMatch(/eval\(|new Function/);
  });
});