import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "../../services/errors";
import {
  PDF_MAX_OUTLINE_DEPTH,
  PDF_MAX_OUTLINE_NODES,
  pdfOutline,
  type PdfOutlineNode,
  type PdfOutlinePage,
} from "../../services/pdf";

/** The outline sidebar (Step 07d T5, D7).
 *
 * The native side pages the outline: each answer is a bounded slice of the
 * preorder traversal, so a hostile or broken document can never make the UI
 * build a million rows. When the limits are reached the list says so, and a
 * node without a page is shown but not clickable (no PDF action ever runs). */

/** One rendered outline row. */
export interface PdfOutlineRow {
  id: string;
  title: string;
  page: number | null;
  depth: number;
}

export interface BoundedOutline {
  rows: PdfOutlineRow[];
  /** The document has more nodes or deeper levels than the viewer shows. */
  truncated: boolean;
}

/** Flatten an outline tree inside the node and depth limits. */
export function flattenOutline(
  nodes: readonly PdfOutlineNode[],
  maxNodes = PDF_MAX_OUTLINE_NODES,
  maxDepth = PDF_MAX_OUTLINE_DEPTH,
): BoundedOutline {
  const rows: PdfOutlineRow[] = [];
  let truncated = false;
  const walk = (list: readonly PdfOutlineNode[], depth: number) => {
    for (const node of list) {
      if (rows.length >= maxNodes) {
        truncated = true;
        return;
      }
      if (depth > maxDepth) {
        truncated = true;
        return;
      }
      rows.push({
        id: node.id,
        title: node.title.slice(0, 512),
        page: typeof node.page === "number" && node.page > 0 ? node.page : null,
        depth,
      });
      if (node.children.length > 0) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return { rows, truncated };
}

/** How many outline answers one session reads before it stops (bounded). */
export const PDF_OUTLINE_PAGES = 40;

export interface PdfOutlineProps {
  sessionId: string;
  sourceKey: string;
  active: boolean;
  onGoToPage: (page: number) => void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; rows: PdfOutlineRow[]; truncated: boolean }
  | { kind: "empty" }
  | { kind: "error"; code: string };

export default function PdfOutline({ sessionId, sourceKey, active, onGoToPage }: PdfOutlineProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    const collected: PdfOutlineNode[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (let page = 0; page < PDF_OUTLINE_PAGES; page += 1) {
      const answer: PdfOutlinePage = await pdfOutline(sessionId, cursor);
      collected.push(...answer.nodes);
      if (collected.length >= PDF_MAX_OUTLINE_NODES) {
        truncated = true;
        break;
      }
      if (answer.complete) break;
      if (!answer.next_cursor) {
        // Bounded partial: the document has more than the viewer shows.
        truncated = true;
        break;
      }
      cursor = answer.next_cursor;
    }
    const bounded = flattenOutline(collected);
    if (bounded.rows.length === 0) setPhase({ kind: "empty" });
    else setPhase({ kind: "ready", rows: bounded.rows, truncated: truncated || bounded.truncated });
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    load().catch((error: unknown) => {
      if (cancelled) return;
      setPhase({ kind: "error", code: errorCode(error) || "pdf.corrupt" });
    });
    return () => {
      cancelled = true;
    };
  }, [active, load, sourceKey]);

  if (phase.kind === "loading") {
    return (
      <div className="adp-pdf-outline adp-pdf-outline--message" role="status">
        {t("pdf.loading")}
      </div>
    );
  }
  if (phase.kind === "empty") {
    return (
      <div className="adp-pdf-outline adp-pdf-outline--message" role="status">
        {t("pdf.noOutline")}
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="adp-pdf-outline adp-pdf-outline--message" role="alert">
        {t(`errors.pdf.${phase.code.startsWith("pdf.") ? phase.code.slice(4) : "corrupt"}`, {
          defaultValue: t("errors.pdf.unavailable"),
        })}
      </div>
    );
  }
  return (
    <div className="adp-pdf-outline">
      <ul className="adp-pdf-outline-list" role="tree" aria-label={t("pdf.outline")}>
        {phase.rows.map((row) => (
          <li
            key={row.id}
            role="treeitem"
            aria-level={row.depth + 1}
            className="adp-pdf-outline-item"
            style={{ paddingLeft: 8 + row.depth * 14 }}
          >
            {row.page === null ? (
              <span className="adp-pdf-outline-label">{row.title}</span>
            ) : (
              <button
                type="button"
                className="adp-pdf-outline-button"
                onClick={() => onGoToPage(row.page ?? 1)}
              >
                {row.title}
              </button>
            )}
          </li>
        ))}
      </ul>
      {phase.truncated ? (
        <p className="adp-pdf-outline-note" role="status">
          {t("errors.pdf.too_large")}
        </p>
      ) : null}
    </div>
  );
}
