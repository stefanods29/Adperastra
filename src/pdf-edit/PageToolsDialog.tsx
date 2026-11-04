import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import type { PdfPageState } from "./types";
import type { PdfSplitRange } from "./pages";

/** Page tools dialog (Step 14a D7, T4): rotate, delete, reorder, insert,
 * merge and split. Destructive actions confirm the affected page count and
 * stay undoable until Save. This dialog only emits an operation; the model
 * transaction is applied by the controller. */

export interface PageToolsDialogProps {
  pages: readonly PdfPageState[];
  selected: readonly string[];
  pageLabels: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  onRotate: (ids: readonly string[], quarterTurns: number) => void;
  onReorder: (id: string, delta: -1 | 1) => void;
  /** Drag-and-drop reorder to a zero-based target position. */
  onReorderTo?: (id: string, targetIndex: number) => void;
  onDelete: (ids: readonly string[]) => void;
  onSplit: (ranges: readonly PdfSplitRange[]) => void;
  onInsert: () => void;
  onMerge: () => void;
  onClose: () => void;
}

export default function PageToolsDialog({
  pages,
  selected,
  pageLabels,
  onSelectionChange,
  onRotate,
  onReorder,
  onReorderTo,
  onDelete,
  onSplit,
  onInsert,
  onMerge,
  onClose,
}: PageToolsDialogProps) {
  const { t } = useTranslation();
  const [first, setFirst] = useState("1");
  const [last, setLast] = useState(String(pages.length || 1));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const selectedSet = new Set(selected);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  };

  const splitRange = (): PdfSplitRange | null => {
    const firstPage = Number(first);
    const lastPage = Number(last);
    if (!Number.isSafeInteger(firstPage) || !Number.isSafeInteger(lastPage)) return null;
    if (firstPage < 1 || lastPage < firstPage || lastPage > pages.length) return null;
    return { first: firstPage, last: lastPage };
  };

  return (
    <Dialog title={t("pdfTools.pages")} onClose={onClose} className="adp-pdf-pages-dialog">
      <div className="adp-pdf-edit-page-actions">
        <Button variant="subtle" onClick={() => onRotate(selected, -1)} disabled={selected.length === 0}>
          {t("pdf.rotateLeft")}
        </Button>
        <Button variant="subtle" onClick={() => onRotate(selected, 1)} disabled={selected.length === 0}>
          {t("pdf.rotateRight")}
        </Button>
        <Button variant="subtle" onClick={() => onReorder(selected[0], -1)} disabled={selected.length !== 1}>
          {t("pdf.previous")}
        </Button>
        <Button variant="subtle" onClick={() => onReorder(selected[0], 1)} disabled={selected.length !== 1}>
          {t("pdf.next")}
        </Button>
        <Button variant="subtle" onClick={() => setConfirmDelete(true)} disabled={selected.length === 0 || selected.length >= pages.length}>
          {t("pdfTools.delete")}
        </Button>
        <Button variant="subtle" onClick={onInsert}>
          {t("pdfTools.insert")}
        </Button>
        <Button variant="subtle" onClick={onMerge}>
          {t("pdfTools.merge")}
        </Button>
      </div>
      <ul className="adp-pdf-edit-page-list" aria-label={t("pdfTools.pages")}>
        {pages.map((page, index) => (
          <li
            key={page.id}
            className={dragging === page.id ? "adp-pdf-edit-page-row adp-pdf-edit-page-row--dragging" : "adp-pdf-edit-page-row"}
            draggable={Boolean(onReorderTo)}
            onDragStart={() => setDragging(page.id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              if (onReorderTo) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging && onReorderTo && dragging !== page.id) onReorderTo(dragging, index);
              setDragging(null);
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={selectedSet.has(page.id)}
                onChange={() => toggle(page.id)}
                aria-label={pageLabels[index] ?? String(index + 1)}
              />
              <span>{pageLabels[index] ?? String(index + 1)}</span>
            </label>
            <span className="adp-pdf-edit-note">
              {page.rotation}° · {Math.round(page.crop.width)} × {Math.round(page.crop.height)}
            </span>
          </li>
        ))}
      </ul>
      <div className="adp-pdf-edit-split">
        <label>
          {t("pdfTools.split")}
          <input
            className="adp-input adp-pdf-edit-number"
            type="number"
            min={1}
            max={pages.length}
            value={first}
            aria-label={t("pdfTools.split")}
            onChange={(event) => setFirst(event.currentTarget.value)}
          />
        </label>
        <span aria-hidden="true">–</span>
        <input
          className="adp-input adp-pdf-edit-number"
          type="number"
          min={1}
          max={pages.length}
          value={last}
          aria-label={t("pdfTools.split")}
          onChange={(event) => setLast(event.currentTarget.value)}
        />
        <Button
          variant="subtle"
          disabled={splitRange() === null}
          onClick={() => {
            const range = splitRange();
            if (range) onSplit([range]);
          }}
        >
          {t("pdfTools.split")}
        </Button>
      </div>
      {confirmDelete ? (
        <div className="adp-pdf-edit-confirm" role="alertdialog" aria-label={t("pdfTools.delete")}>
          <p>{t("pdfTools.deleteConfirm", { count: selected.length })}</p>
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              onClick={() => {
                onDelete(selected);
                setConfirmDelete(false);
              }}
            >
              {t("pdfTools.delete")}
            </Button>
            <Button variant="subtle" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="adp-dialog-actions">
        <Button variant="subtle" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </Dialog>
  );
}
