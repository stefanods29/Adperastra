import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { OfficeEditComment } from "../types";

/** Removing a comment is always an explicit second action; an imported
 * comment's author belongs to the file, not to the local profile. */
export function requiresCommentDeleteConfirm(comment: OfficeEditComment): boolean {
  return comment.text.length > 0 || comment.author.length > 0;
}

export interface DeckCommentsProps {
  comments: readonly OfficeEditComment[];
  selectedId: string | null;
  author: string;
  disabled: boolean;
  onSelect: (commentId: string | null) => void;
  onAdd: (text: string) => void;
  onReply: (commentId: string, text: string) => void;
  onResolve: (commentId: string, resolved: boolean) => void;
  onDelete: (commentId: string) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

/** Review comments panel (Step 22a T6). Comment text is rendered as React
 * text only; no engine or comment HTML enters the app DOM, so an imported
 * script-looking comment stays inert. Notes are never mixed into comments. */
export default function DeckComments({
  comments,
  selectedId,
  author,
  disabled,
  onSelect,
  onAdd,
  onReply,
  onResolve,
  onDelete,
  onClose,
  onOpenHelp,
}: DeckCommentsProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const selected = comments.find((comment) => comment.id === selectedId) ?? null;

  return (
    <Dialog title={t("office.comments")} onClose={onClose} className="adp-deck-comments-dialog">
      <div className="adp-deck-comments">
        <ul className="adp-deck-comment-list" aria-label={t("office.comments")}>
          {comments.map((comment) => (
            <li key={comment.id}>
              <button
                type="button"
                className={"adp-deck-comment" + (comment.id === selectedId ? " adp-deck-comment--active" : "")}
                aria-current={comment.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(comment.id)}
              >
                <span className="adp-deck-comment-author">{comment.author}</span>
                <span className="adp-deck-comment-text">{comment.text}</span>
                {comment.resolved ? <span className="adp-deck-comment-state">{t("officeDeck.commentInfo.resolved")}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="adp-deck-comment-detail">
          {selected ? (
            <>
              <p className="adp-deck-comment-author">{selected.author}</p>
              <p className="adp-deck-comment-text">{selected.text}</p>
              <button type="button" className="adp-btn" disabled={disabled}
                onClick={() => onResolve(selected.id, !selected.resolved)}>
                {selected.resolved ? t("officeDeck.commentInfo.reopen") : t("officeDeck.resolve")}
              </button>
              {confirmId === selected.id ? (
                <div className="adp-deck-confirm" role="alertdialog" aria-label={t("officeDeck.commentInfo.deleteConfirm")}>
                  <p>{t("officeDeck.commentInfo.deleteConfirm")}</p>
                  <Button variant="primary" onClick={() => { setConfirmId(null); onDelete(selected.id); }}>
                    {t("officeDeck.deleteComment")}
                  </Button>
                  <Button onClick={() => setConfirmId(null)}>{t("common.cancel")}</Button>
                </div>
              ) : (
                <button type="button" className="adp-btn" disabled={disabled}
                  onClick={() => { if (requiresCommentDeleteConfirm(selected)) setConfirmId(selected.id); else onDelete(selected.id); }}>
                  {t("officeDeck.deleteComment")}
                </button>
              )}
              <label className="adp-deck-field">
                <span>{t("officeDeck.reply")}</span>
                <textarea value={reply} rows={2} onChange={(event) => setReply(event.target.value)} />
              </label>
              <Button disabled={disabled || reply.trim() === ""}
                onClick={() => { onReply(selected.id, reply.trim()); setReply(""); }}>
                {t("officeDeck.reply")}
              </Button>
            </>
          ) : (
            <p className="adp-deck-hint">{t("officeDeck.commentInfo.select")}</p>
          )}
          <label className="adp-deck-field">
            <span>{t("officeDeck.commentInfo.new")}</span>
            <textarea value={draft} rows={3} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <p className="adp-deck-hint">{t("officeDeck.commentInfo.authorHint", { author })}</p>
          <Button variant="primary" disabled={disabled || draft.trim() === ""}
            onClick={() => { onAdd(draft.trim()); setDraft(""); }}>
            {t("officeDeck.comment")}
          </Button>
        </div>
      </div>
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("editing-presentations")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <Button onClick={onClose}>{t("common.close")}</Button>
      </footer>
    </Dialog>
  );
}
