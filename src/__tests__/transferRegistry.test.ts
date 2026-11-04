import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransferRegistry, chooseTransferAction } from "../transfer/TransferRegistry";
import {
  createTextEditorTarget,
  useContentPaste,
  type ContentPasteResult,
} from "../transfer/useContentPaste";
import type {
  TransferAction,
  TransferActionId,
  TransferEnvelope,
  TransferLossKey,
  TransferPayload,
  TransferReceipt,
  TransferTarget,
} from "../transfer/types";

const DOCUMENT_ID = "0f2f6a8e-7b1c-4d3a-9e5f-1a2b3c4d5e6f";
const TRANSFER_ID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TRANSACTION_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const LABELS: Record<TransferActionId, string> = {
  insert_text: "transfer.insertText",
  insert_rich_text: "transfer.insertRich",
  insert_cells: "transfer.insertCells",
  insert_image: "transfer.insertImage",
  insert_pdf_pages: "transfer.insertPages",
  insert_page_images: "transfer.insertPageImages",
  add_layers: "transfer.layers",
  add_clips: "transfer.clips",
  attach_files: "transfer.attach",
  open_files: "transfer.open",
  copy_files: "transfer.copy",
  move_files: "transfer.move",
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const views: EditorView[] = [];
const pasteRoots: { root: Root; container: HTMLDivElement }[] = [];

function makeView(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [history()] }),
    parent: document.body,
  });
  views.push(view);
  return view;
}
function action(id: TransferActionId, losses: TransferLossKey[] = []): TransferAction {
  return { id, label_key: LABELS[id], losses, mutates: true };
}
function envelope(payload: TransferPayload): TransferEnvelope {
  return {
    transfer_id: TRANSFER_ID,
    source_document_id: DOCUMENT_ID,
    sensitive: false,
    payload,
    expires_unix: 2_000_000_000,
  };
}
function receipt(overrides: Partial<TransferReceipt> = {}): TransferReceipt {
  return {
    transaction_id: TRANSACTION_ID,
    target_document_id: DOCUMENT_ID,
    revision: 2,
    inserted_count: 3,
    losses: [],
    complete: true,
    ...overrides,
  };
}

function fakeTarget(
  targetId: string,
  actions: () => readonly TransferAction[],
  accept: TransferTarget["accept"],
): TransferTarget {
  return {
    target_id: targetId,
    accepted_kinds: ["text"],
    describe: () => actions(),
    accept,
  };
}

async function mountPaste(
  registry: TransferRegistry,
  targetId: string,
): Promise<() => ContentPasteResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  pasteRoots.push({ root, container });
  let result: ContentPasteResult | null = null;
  function Harness() {
    result = useContentPaste({
      registry,
      targetId,
      release: async () => undefined,
    });
    return null;
  }
  await act(async () => {
    root.render(createElement(Harness));
  });
  return () => {
    if (!result) throw new Error("paste_not_mounted");
    return result;
  };
}

afterEach(async () => {
  for (const view of views.splice(0)) view.destroy();
  for (const entry of pasteRoots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
});

describe("TransferRegistry", () => {
  it("readonly_target_advertises_no_actions", () => {
    const view = makeView("alpha");
    const target = createTextEditorTarget({
      targetId: "text:readonly",
      documentId: DOCUMENT_ID,
      view,
      readOnly: () => true,
    });
    const registry = new TransferRegistry();
    registry.register(target);

    expect(registry.describe("text:readonly", envelope({ kind: "text", text: "beta" }))).toEqual([]);
    expect(
      registry.describe(
        "text:readonly",
        envelope({
          kind: "rich_text",
          blocks: [{ kind: "paragraph", runs: [{ text: "beta", marks: [] }], depth: 0 }],
        }),
      ),
    ).toEqual([]);
  });

  it("ambiguous_actions_ask_before_any_mutation", async () => {
    const accept = vi.fn(async () => receipt());
    const registry = new TransferRegistry();
    const unregister = registry.register(
      fakeTarget("fake:choice", () => [action("insert_text"), action("insert_cells")], accept),
    );
    const chooser = vi.fn(async (_actions: readonly TransferAction[]) => "insert_cells");
    const transfer = envelope({ kind: "text", text: "beta" });

    const picked = await chooseTransferAction(registry, "fake:choice", transfer, chooser);

    expect(picked).toBe("insert_cells");
    expect(chooser).toHaveBeenCalledTimes(1);
    expect(chooser.mock.calls[0][0].map((entry) => entry.id)).toEqual([
      "insert_text",
      "insert_cells",
    ]);
    expect(accept).not.toHaveBeenCalled();
    unregister();
  });

  it("one_action_is_used_without_a_choice_menu", async () => {
    const registry = new TransferRegistry();
    const unregister = registry.register(
      fakeTarget("fake:single", () => [action("insert_text")], async () => receipt()),
    );
    const chooser = vi.fn(async () => "insert_text");

    const picked = await chooseTransferAction(
      registry,
      "fake:single",
      envelope({ kind: "text", text: "beta" }),
      chooser,
    );

    expect(picked).toBe("insert_text");
    expect(chooser).not.toHaveBeenCalled();
    unregister();
  });

  it("a_disappeared_action_is_refused_at_accept_time", async () => {
    let offered: readonly TransferAction[] = [action("insert_text")];
    const accept = vi.fn(async () => receipt());
    const registry = new TransferRegistry();
    const unregister = registry.register(fakeTarget("fake:stale", () => offered, accept));
    const transfer = envelope({ kind: "text", text: "beta" });

    expect(registry.describe("fake:stale", transfer)).toHaveLength(1);
    offered = [];
    await expect(registry.accept("fake:stale", transfer, "insert_text")).rejects.toThrow(
      "transfer.unsupported",
    );
    expect(accept).not.toHaveBeenCalled();
    unregister();
  });

  it("revision_change_fails_without_edit", async () => {
    const view = makeView("alpha");
    const target = createTextEditorTarget({
      targetId: "text:changed",
      documentId: DOCUMENT_ID,
      view,
      readOnly: () => false,
    });
    const registry = new TransferRegistry();
    registry.register(target);
    const transfer = envelope({ kind: "text", text: "BETA" });

    expect(registry.describe("text:changed", transfer).map((entry) => entry.id)).toEqual([
      "insert_text",
    ]);
    view.dispatch({ changes: { from: 0, insert: "changed " } });

    await expect(registry.accept("text:changed", transfer, "insert_text")).rejects.toThrow(
      "transfer.changed",
    );
    expect(view.state.doc.toString()).toBe("changed alpha");
  });

  it("supported_rich_paste_has_one_undo_and_one_revision", async () => {
    const view = makeView("alpha");
    const target = createTextEditorTarget({
      targetId: "text:rich",
      documentId: DOCUMENT_ID,
      view,
      readOnly: () => false,
    });
    const registry = new TransferRegistry();
    registry.register(target);
    const transfer = envelope({
      kind: "rich_text",
      blocks: [{ kind: "paragraph", runs: [{ text: "beta", marks: [{ kind: "bold" }] }], depth: 0 }],
    });

    const actions = registry.describe("text:rich", transfer);
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("insert_rich_text");
    expect(actions[0].losses).toEqual(["transfer.lossFormatting"]);

    const result = await registry.accept("text:rich", transfer, "insert_rich_text");

    expect(view.state.doc.toString()).toBe("betaalpha");
    expect(result.complete).toBe(true);
    expect(result.target_document_id).toBe(DOCUMENT_ID);
    expect(result.revision).toBe(2);
    expect(result.inserted_count).toBe(4);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("alpha");
  });

  it("disposer_cancels_pending_accept", async () => {
    let resolveAccept!: (value: TransferReceipt) => void;
    const accept = vi.fn(
      () =>
        new Promise<TransferReceipt>((resolve) => {
          resolveAccept = resolve;
        }),
    );
    const registry = new TransferRegistry();
    const unregister = registry.register(
      fakeTarget("fake:pending", () => [action("insert_text")], accept),
    );
    const transfer = envelope({ kind: "text", text: "beta" });

    const pending = registry.accept("fake:pending", transfer, "insert_text");
    expect(accept).toHaveBeenCalledTimes(1);
    unregister();

    await expect(pending).rejects.toThrow("transfer.failed");
    expect(registry.get("fake:pending")).toBeNull();
    expect(registry.describe("fake:pending", transfer)).toEqual([]);
    await expect(registry.accept("fake:pending", transfer, "insert_text")).rejects.toThrow(
      "transfer.unsupported",
    );
    resolveAccept(receipt());
    await Promise.resolve();
  });

  it("duplicate_target_ids_are_refused", () => {
    const registry = new TransferRegistry();
    const target = fakeTarget("fake:dup", () => [action("insert_text")], async () => receipt());
    registry.register(target);
    expect(() => registry.register(target)).toThrow("transfer.invalid");
  });

  it("incomplete_receipts_are_refused", async () => {
    const registry = new TransferRegistry();
    registry.register(
      fakeTarget("fake:incomplete", () => [action("insert_text")], async () =>
        receipt({ complete: false }),
      ),
    );

    await expect(
      registry.accept(
        "fake:incomplete",
        envelope({ kind: "text", text: "beta" }),
        "insert_text",
      ),
    ).rejects.toThrow("transfer.failed");
  });

  // T6 safety oracles: normal copy in a text input, a closed target and the
  // explicit warning before a sensitive insertion.
  it("copy_in_text_input_unchanged", async () => {
    const accept = vi.fn(async () => receipt());
    const registry = new TransferRegistry();
    registry.register(fakeTarget("fake:copy", () => [action("insert_text")], accept));
    const input = document.createElement("input");
    input.value = "alpha";
    document.body.appendChild(input);
    await mountPaste(registry, "fake:copy");

    const event = new Event("copy", { bubbles: true, cancelable: true });
    const delivered = input.dispatchEvent(event);

    expect(delivered).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(input.value).toBe("alpha");
    expect(accept).not.toHaveBeenCalled();
    input.remove();
  });

  it("pending_closed_target_not_called", async () => {
    const accept = vi.fn(async () => receipt());
    const registry = new TransferRegistry();
    const unregister = registry.register(
      fakeTarget("fake:closed", () => [action("insert_text")], accept),
    );
    unregister();

    await expect(
      registry.accept(
        "fake:closed",
        envelope({ kind: "text", text: "beta" }),
        "insert_text",
      ),
    ).rejects.toThrow("transfer.unsupported");
    expect(accept).not.toHaveBeenCalled();
  });

  it("sensitive_choice_requires_confirmation", async () => {
    const accept = vi.fn(async () => receipt());
    const registry = new TransferRegistry();
    registry.register(
      fakeTarget(
        "fake:sensitive-choice",
        () => [action("insert_text"), action("insert_cells")],
        accept,
      ),
    );
    const current = await mountPaste(registry, "fake:sensitive-choice");
    const sensitive = { ...envelope({ kind: "text", text: "beta" }), sensitive: true };
    await act(async () => {
      expect(await current().paste(sensitive)).toBeNull();
    });
    expect(current().choice).not.toBeNull();
    expect(accept).not.toHaveBeenCalled();
    await act(async () => {
      expect(await current().choose("insert_cells")).toBeNull();
    });
    expect(current().choice).toBeNull();
    expect(current().sensitive).not.toBeNull();
    expect(accept).not.toHaveBeenCalled();
    await act(async () => {
      await current().confirmSensitive();
    });
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("user_sensitive_warning_required", async () => {
    const accept = vi.fn(async () => receipt());
    const registry = new TransferRegistry();
    registry.register(
      fakeTarget("fake:sensitive", () => [action("insert_text")], accept),
    );
    const current = await mountPaste(registry, "fake:sensitive");
    const sensitive = { ...envelope({ kind: "text", text: "beta" }), sensitive: true };
    await act(async () => {
      expect(await current().paste(sensitive)).toBeNull();
    });
    expect(accept).not.toHaveBeenCalled();
    expect(current().sensitive).not.toBeNull();
    await act(async () => {
      await current().confirmSensitive();
    });
    expect(accept).toHaveBeenCalledTimes(1);
  });
});
