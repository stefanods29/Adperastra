import { getTransfer } from "../../services/contentTransfer";
import type { TransferEnvelope, TransferTarget, TransferAction } from "../../transfer/types";
import type { OfficeController } from "../OfficeController";
import { canDocumentMutate } from "./documentController";

/** Text route only until the rich-text/table/PDF contract gaps in the handoff are resolved. */
export function documentTransferTarget(controller: OfficeController): TransferTarget {
  const actions = (envelope: TransferEnvelope): readonly TransferAction[] => {
    const state = controller.getState();
    if (!canDocumentMutate(state, "document_text").enabled || state.selection?.kind !== "document" ||
        state.selection.span.revision !== state.revision || envelope.payload.kind !== "text" ||
        envelope.sensitive && !controller.document.info.sensitive) return [];
    return [{ id: "insert_text", label_key: "transfer.insertText", losses: [], mutates: true }];
  };
  return {
    target_id: `office-document:${controller.document.id}`,
    document_id: controller.document.id,
    accepted_kinds: ["text"],
    describe: actions,
    async accept(envelope, actionId) {
      const { revision, content_id, selection } = controller.getState();
      // Resolve the actual native-held payload, not fields copied from an opaque drag label.
      const authorized = await getTransfer(envelope.transfer_id);
      const live = controller.getState();
      if (revision !== live.revision || content_id !== live.content_id ||
          JSON.stringify(selection) !== JSON.stringify(live.selection)) throw new Error("office_edit.changed");
      if (actionId !== "insert_text" || actions(authorized).length === 0 ||
          selection?.kind !== "document" || authorized.payload.kind !== "text") throw new Error("office_edit.unsupported");
      const text = authorized.payload.text;
      const count = [...text].length;
      if (count === 0 || count > 1024 * 1024) throw new Error("office_edit.invalid");
      const result = await controller.transact({
        transaction_id: crypto.randomUUID(), expected_revision: revision,
        operations: [{ family: "document", operation: { kind: "insert_text", position: selection.span.focus, text } }],
        selection_after: null, label_key: "office.transaction",
      });
      return {
        transaction_id: result.transaction_id, target_document_id: result.state.document_id,
        revision: result.state.revision, inserted_count: result.changed ? count : 0, losses: [], complete: true,
      };
    },
  };
}
