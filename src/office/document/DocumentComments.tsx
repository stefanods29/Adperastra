import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { DocumentOperation, OfficeEditComment } from "../types";

export function documentCommentReply(commentId: string, text: string, author: string): DocumentOperation {
  if ([...text].length > 16384 || [...author].length > 128 || !text.trim() || !author.trim()) throw new Error("office_edit.invalid");
  // Reply does not supply a new anchor; the engine retains the parent's anchor.
  return { kind: "comment_reply", comment_id: commentId, text, author };
}

export function DocumentComments({ comments, author, disabled, onApply }: {
  comments: readonly OfficeEditComment[]; author: string; disabled: boolean;
  onApply: (operation: DocumentOperation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async (operation: DocumentOperation, id?: string) => {
    setBusy(true); setError(false);
    try { await onApply(operation); if (id) setText((previous) => ({ ...previous, [id]: "" })); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <aside aria-label={t("office.comments")} className="adp-office-document-comments">
    {comments.map((comment) => <article key={comment.id} className="adp-office-document-comment">
      <strong>{comment.author}</strong><p>{comment.text}</p>
      {comment.replies.map((reply) => <div key={reply.id}><strong>{reply.author}</strong><p>{reply.text}</p></div>)}
      <textarea aria-label={t("officeDoc.reply")} value={text[comment.id] ?? ""} maxLength={16384}
        disabled={disabled || busy} onChange={(event) => setText((previous) => ({ ...previous, [comment.id]: event.target.value }))} />
      <Button disabled={disabled || busy || !(text[comment.id] ?? "").trim()}
        onClick={() => void apply(documentCommentReply(comment.id, text[comment.id], author), comment.id)}>{t("officeDoc.reply")}</Button>
      <Button disabled={disabled || busy || comment.resolved}
        onClick={() => void apply({ kind: "comment_resolve", comment_id: comment.id, resolved: true })}>{t("officeDoc.resolve")}</Button>
      <Button disabled={disabled || busy} onClick={() => {
        if (!globalThis.confirm?.(t("officeDoc.deleteCommentConfirm"))) return;
        void apply({ kind: "comment_delete", comment_id: comment.id });
      }}>{t("officeDoc.deleteComment")}</Button>
    </article>)}
    {error ? <p role="alert">{t("errors.office_edit.failed")}</p> : null}
  </aside>;
}
