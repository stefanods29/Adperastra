import { SplitSquareVertical } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ExtractionTable, ExtractionValue } from "../services/aiExtractionTypes";

/** The reviewed grid (Step 17d T4): virtualized rows, keyboard access and
 * typed cell corrections. Split and merge operate on the preview first; the
 * engine keeps every row rectangular and no source file changes. */

export const GRID_ROW_HEIGHT = 32;
export const GRID_MAX_VISIBLE_ROWS = 100;

export interface ExtractionGridProps {
  table: ExtractionTable;
  selectedValueId?: string | null;
  onFocusValue?: (value: ExtractionValue) => void;
  onCommitCell?: (rowId: string, columnId: string, expected: string, next: string) => void;
  onSplitColumn?: (columnId: string, separator: string) => void;
  onMergeColumns?: (columnIds: string[], separator: string) => void;
}

export default function ExtractionGrid({
  table,
  selectedValueId,
  onFocusValue,
  onCommitCell,
  onSplitColumn,
  onMergeColumns,
}: ExtractionGridProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ rowId: string; columnId: string; draft: string } | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [separator, setSeparator] = useState(",");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rows = table.rows.slice(0, GRID_MAX_VISIBLE_ROWS);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_HEIGHT,
    overscan: 4,
  });

  const toggleColumn = (columnId: string) => {
    setSelectedColumns((current) =>
      current.includes(columnId) ? current.filter((id) => id !== columnId) : [...current, columnId],
    );
  };

  const beginEdit = (rowId: string, columnId: string, value: ExtractionValue) => {
    setEditing({ rowId, columnId, draft: value.value });
    onFocusValue?.(value);
  };

  return (
    <div className="adp-extraction-grid-wrap">
      <div className="adp-extraction-grid-tools" role="toolbar" aria-label={t("aiExtract.review")}>
        <label className="adp-extraction-grid-separator">
          {t("aiExtract.splitColumn")}
          <input
            className="adp-input"
            aria-label={t("aiExtract.splitColumn")}
            value={separator}
            maxLength={8}
            onChange={(event) => setSeparator(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="adp-btn adp-btn--subtle"
          disabled={selectedColumns.length !== 1 || !onSplitColumn || separator === ""}
          onClick={() => onSplitColumn?.(selectedColumns[0], separator)}
        >
          <SplitSquareVertical size={16} aria-hidden="true" />
          {t("aiExtract.splitColumn")}
        </button>
        <button
          type="button"
          className="adp-btn adp-btn--subtle"
          disabled={selectedColumns.length < 2 || !onMergeColumns}
          onClick={() => onMergeColumns?.(selectedColumns, separator)}
        >
          {t("aiExtract.mergeColumns")}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="adp-extraction-grid"
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={table.columns.length}
        aria-label={t("aiExtract.review")}
      >
        <div className="adp-extraction-grid-head" role="row" aria-rowindex={1}>
          {table.columns.map((column, index) => (
            <div
              key={column.id}
              role="columnheader"
              aria-colindex={index + 1}
              className={`adp-extraction-grid-head-cell${selectedColumns.includes(column.id) ? " adp-extraction-grid-cell--selected" : ""}`}
              tabIndex={0}
              onClick={() => toggleColumn(column.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleColumn(column.id);
                }
              }}
              title={column.name.value}
            >
              {column.name.value}
            </div>
          ))}
        </div>
        <div className="adp-extraction-grid-body">
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={item.index + 2}
                className="adp-extraction-grid-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.cells.map((cell, columnIndex) => {
                  const column = table.columns[columnIndex];
                  const isEditing = editing?.rowId === row.id && editing.columnId === column.id;
                  return (
                    <div
                      key={column.id}
                      role="gridcell"
                      aria-colindex={columnIndex + 1}
                      aria-selected={selectedValueId === cell.id}
                      className={`adp-extraction-grid-cell adp-extraction-grid-cell--${cell.status}`}
                      tabIndex={0}
                      onFocus={() => onFocusValue?.(cell)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !isEditing) {
                          event.preventDefault();
                          beginEdit(row.id, column.id, cell);
                        } else if (event.key === "Escape" && isEditing) {
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className="adp-extraction-grid-input"
                          aria-label={`${column.name.value} ${item.index + 1}`}
                          value={editing.draft}
                          onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
                          onBlur={() => {
                            if (editing.draft !== cell.value) {
                              onCommitCell?.(row.id, column.id, cell.value, editing.draft);
                            }
                            setEditing(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              if (editing.draft !== cell.value) {
                                onCommitCell?.(row.id, column.id, cell.value, editing.draft);
                              }
                              setEditing(null);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setEditing(null);
                            }
                          }}
                        />
                      ) : (
                        cell.value
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
