import { describe, expect, it } from "vitest";
import { previewDocumentReview } from "../office/document/DocumentReview";
import { documentCommentReply } from "../office/document/DocumentComments";

describe("document review", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("replyanchorunchanged", () => {
    expect(documentCommentReply(id, "Reply", "Local author")).toEqual({ kind: "comment_reply", comment_id: id, text: "Reply", author: "Local author" });
  });
  it("accept-allonlypreviewedIDs", () => {
    const ids = [id];
    const preview = previewDocumentReview(ids, "accept");
    ids.push("00000000-0000-4000-8000-000000000002");
    expect(preview).toEqual({ count: 1, operations: [{ kind: "review_change", change_id: id, decision: "accept" }] });
  });
});
