import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeComment, OfficeCommentPage } from "../../services/officeViewTypes";

export interface OfficeCommentsProps {
  page: OfficeCommentPage | null;
  loading?: boolean;
  errorText?: string | null;
}

interface CommentNode {
  comment: OfficeComment;
  children: CommentNode[];
}

function treeOf(items: readonly OfficeComment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  for (const comment of items) nodes.set(comment.id, { comment, children: [] });
  const roots: CommentNode[] = [];
  for (const comment of items) {
    const node = nodes.get(comment.id);
    if (!node) continue;
    const parent = comment.parent_id ? nodes.get(comment.parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function CommentNodeView({ node, depth }: { node: CommentNode; depth: number }) {
  const { t } = useTranslation();
  return (
    <li className="adp-office-comment" data-parent-id={node.comment.parent_id ?? undefined} data-depth={depth}>
      <div className="adp-office-comment-meta">
        <span className="adp-office-comment-author">{node.comment.author}</span>
        {node.comment.page ? <span className="adp-office-comment-page">{node.comment.page}</span> : null}
      </div>
      <p className="adp-office-comment-text">{node.comment.text}</p>
      {node.children.length > 0 ? (
        <ul className="adp-office-comment-replies" aria-label={t("office.replies")}>
          {node.children.map((child) => (
            <CommentNodeView key={child.comment.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Read-only comments. Text is rendered as text nodes only: a source string
 * containing script markup can never become DOM markup. Replies stay under
 * their exact parent_id, even when the source lists them after other items. */
export default function OfficeComments({ page, loading = false, errorText = null }: OfficeCommentsProps) {
  const { t } = useTranslation();
  const roots = useMemo(() => treeOf(page?.items ?? []), [page]);
  return (
    <section className="adp-office-comments" aria-label={t("office.comments")} tabIndex={0}>
      <h2 className="adp-office-panel-title">{t("office.comments")}</h2>
      {loading ? <p role="status">{t("office.loading")}</p> : null}
      {errorText ? <p className="adp-office-error" role="alert">{errorText}</p> : null}
      {!loading && !errorText && roots.length === 0 ? (
        <p className="adp-office-empty">{t("office.noComments")}</p>
      ) : null}
      <ul className="adp-office-comment-list">
        {roots.map((node) => (
          <CommentNodeView key={node.comment.id} node={node} depth={0} />
        ))}
      </ul>
    </section>
  );
}
