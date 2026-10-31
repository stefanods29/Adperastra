import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, FileText, Heading1 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { errorCode, errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import type { TextEncodingId } from "../../services/tableView";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { readTableState, useTableSession } from "./useTableSession";

const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 8;
const OVERSCAN_COLUMNS = 3;
/** The sticky row-number column. */
const NUMBER_WIDTH = 64;

/** Technical encoding names, the same in every language (as the text
 * viewer's `ENCODING_LABELS`). */
const ENCODING_NAMES: Record<TextEncodingId, string> = {
  utf8: "UTF-8",
  utf16_le: "UTF-16 LE",
  utf16_be: "UTF-16 BE",
  windows1252: "Windows-1252",
};

const DELIMITER_KEYS: Record<string, string> = {
  ",": "table.delimiterComma",
  ";": "table.delimiterSemicolon",
  "\t": "table.delimiterTab",
  "|": "table.delimiterPipe",
};

interface TableCtx {
  ready: boolean;
  hasHeader: boolean;
  canOpenAsText: boolean;
}

/** CSV and TSV files as a read-only table (Step 06f): virtualized rows and
 * columns, sort by any column, filter while typing, and Open as text. */
export default function TableView({
  info,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenInWindowsApp,
  find,
  onOpenAsText,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const initial = useMemo(() => readTableState(savedState), [savedState]);
  const session = useTableSession(info.path, initial);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const widthsRef = useRef<number[]>([]);
  const widthsView = useRef(0);
  const [slowSorting, setSlowSorting] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const findScroll = useRef(-1);
  const savedSettings = useRef(JSON.stringify(initial));

  const summary = session.phase.kind === "ready" ? session.phase.summary : null;
  const columns = summary?.columns ?? 0;

  // Column widths: the longest of the header and the first page, once per view.
  useEffect(() => {
    if (!summary) return;
    if (widthsView.current === session.viewNumber && widthsRef.current.length === summary.columns) {
      return;
    }
    const firstPage = session.page(0);
    if (!firstPage) return;
    const next: number[] = [];
    for (let column = 0; column < summary.columns; column += 1) {
      let longest = (summary.headers[column] ?? "").length;
      for (const row of firstPage) {
        longest = Math.max(longest, (row[column] ?? "").length);
      }
      next.push(Math.min(400, Math.max(80, longest * 8 + 24)));
    }
    widthsRef.current = next;
    widthsView.current = session.viewNumber;
    setWidths(next);
  }, [summary, session, session.viewNumber, session.page]);

  const columnWidth = useCallback((index: number) => widths[index] ?? 120, [widths]);

  const rowVirtualizer = useVirtualizer({
    count: session.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => columnWidth(index),
    overscan: OVERSCAN_COLUMNS,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstRow = virtualRows[0]?.index ?? 0;
  const lastRow = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1;

  // Pages for the rows on screen.
  useEffect(() => {
    if (lastRow >= firstRow) session.rowsBetween(firstRow, lastRow + 1);
  }, [firstRow, lastRow, session.rowsBetween, session.viewNumber, session.cacheVersion]);

  // The tab's saved state follows the header choice and the sort.
  useEffect(() => {
    const text = JSON.stringify(session.settings);
    if (text !== savedSettings.current) {
      savedSettings.current = text;
      onStateChange(session.settings);
    }
  }, [session.settings, onStateChange]);

  // The search box filters the table after typing stops.
  useEffect(() => {
    session.setFilter(find.text);
  }, [find.text, session.setFilter]);

  // Enter or F3 moves to the next matching row (all shown rows match).
  useEffect(() => {
    if (find.request === 0) return;
    const next = findScroll.current + 1;
    if (next < session.rowCount) {
      findScroll.current = next;
      rowVirtualizer.scrollToIndex(next);
    } else {
      findScroll.current = -1;
    }
    // The request number is the trigger; the row count is read when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.request]);

  // Words appear only when waiting becomes noticeable.
  useEffect(() => {
    if (session.phase.kind !== "loading") {
      setShowReading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReading(true), 1000);
    return () => window.clearTimeout(timer);
  }, [session.phase.kind]);

  useEffect(() => {
    if (!session.sorting) {
      setSlowSorting(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowSorting(true), 1000);
    return () => window.clearTimeout(timer);
  }, [session.sorting]);

  // Status bar.
  useEffect(() => {
    if (!summary) {
      onStatus({ items: [] });
      return;
    }
    const items: string[] = [];
    const total = Math.max(0, summary.rows - (session.settings.has_header ? 1 : 0));
    if (session.filter.trim() !== "") {
      items.push(t("table.filtered", { shown: session.rowCount, total }));
    } else {
      items.push(t("table.rowCount", { count: total }));
    }
    items.push(t("table.columnCount", { count: summary.columns }));
    items.push(t(DELIMITER_KEYS[summary.delimiter] ?? "table.delimiterComma"));
    items.push(ENCODING_NAMES[summary.encoding]);
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [summary, session.filter, session.rowCount, session.settings.has_header, info.size, i18n.language, onStatus, t]);

  const headerName = useCallback(
    (column: number) => {
      const header = summary?.headers[column] ?? "";
      if (summary && session.settings.has_header && header !== "") return header;
      return t("table.columnNumber", { number: column + 1 });
    },
    [summary, session.settings.has_header, t],
  );

  const ctx: TableCtx = {
    ready: summary !== null,
    hasHeader: session.settings.has_header,
    canOpenAsText: Boolean(onOpenAsText),
  };
  const commands = useMemo<Command<TableCtx>[]>(
    () => [
      {
        id: "table.toggleHeader",
        labelKey: "table.firstRowHeaders",
        icon: Heading1,
        risk: "read-only",
        helpSlug: "viewing-tables",
        checkKind: "toggle",
        checkedWhen: (current) => current.hasHeader,
        enabledWhen: (current) => current.ready,
        run: () => session.setHeader(!session.settings.has_header),
      },
      {
        id: "table.openAsText",
        labelKey: "viewer.openAsText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-tables",
        visibleWhen: (current) => current.canOpenAsText,
        enabledWhen: (current) => current.canOpenAsText,
        run: () => onOpenAsText?.(),
      },
    ],
    [session, onOpenAsText],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "table",
            labelKey: "handlers.table",
            controls: [{ type: "toggle", command: "table.toggleHeader", keyTip: "H" }],
          },
          {
            id: "open",
            labelKey: "commands.open",
            controls: [{ type: "button", command: "table.openAsText", keyTip: "O" }],
          },
        ],
      },
    ],
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const top = virtualRows[0]?.index ?? 0;
    const last = Math.max(0, session.rowCount - 1);
    let target: number | null = null;
    if (event.key === "ArrowDown") target = top + 1;
    else if (event.key === "ArrowUp") target = top - 1;
    else if (event.key === "PageDown") target = top + 20;
    else if (event.key === "PageUp") target = top - 20;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    if (target === null) return;
    event.preventDefault();
    rowVirtualizer.scrollToIndex(Math.min(Math.max(0, target), last));
  };

  const openAsTextButton = onOpenAsText ? (
    <Button onClick={onOpenAsText}>{t("viewer.openAsText")}</Button>
  ) : null;

  const columnsWidth = widths.reduce((sum, width) => sum + width, 0);
  const totalWidth = NUMBER_WIDTH + columnsWidth;
  const visibleColumns = columnVirtualizer.getVirtualItems();
  const firstColumnOffset = visibleColumns[0]?.start ?? 0;
  const visibleWidth = visibleColumns.reduce((sum, item) => sum + item.size, 0);
  const trailingWidth = Math.max(0, columnsWidth - firstColumnOffset - visibleWidth);

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="excel" active={active} />}>
      {session.phase.kind === "loading" ? (
        <div className="adp-viewer-message" role="status">
          <Skeleton variant="rows" count={8} />
          {showReading ? (
            <>
              <p>{t("table.reading")}</p>
              <Button onClick={session.cancelOpen}>{t("common.cancel")}</Button>
            </>
          ) : null}
        </div>
      ) : null}
      {session.phase.kind === "cancelled" ? (
        <div className="adp-viewer-message" role="status">
          <p>{t("table.reading")}</p>
        </div>
      ) : null}
      {session.phase.kind === "error" ? (
        <div className="adp-viewer-message" role="alert">
          <p>{errorText(t, session.phase.error, errorCode(session.phase.error).startsWith("data.") ? "data" : "table")}</p>
          <div className="adp-dialog-actions">
            {openAsTextButton}
            <Button onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
          </div>
        </div>
      ) : null}
      {summary ? (
        <>
          {summary.truncated ? (
            <div className="adp-table-note" role="note">
              {t("table.truncated", { count: summary.rows })}
            </div>
          ) : null}
          {slowSorting ? (
            <div className="adp-table-note" role="status">
              {t("table.sorting")}
            </div>
          ) : null}
          {summary.rows === 0 ? (
            <div className="adp-viewer-message" role="status">
              <p>{t("table.empty")}</p>
              {openAsTextButton}
            </div>
          ) : session.rowCount === 0 && session.filter.trim() !== "" && !session.sorting ? (
            <div className="adp-viewer-message" role="status">
              <p>{t("table.noMatches")}</p>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="adp-table"
              role="grid"
              aria-label={t("table.label", { name: info.name })}
              aria-rowcount={session.rowCount}
              aria-colcount={summary.columns}
              tabIndex={0}
              onKeyDown={onGridKey}
            >
              <div className="adp-table-head" role="row" style={{ width: totalWidth }}>
                <div className="adp-table-number" aria-hidden="true" />
                {firstColumnOffset > 0 ? <div style={{ width: firstColumnOffset, flex: "none" }} /> : null}
                {visibleColumns.map((item) => {
                  const sorted = session.settings.sort_column === item.index;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="adp-table-head-cell"
                      role="columnheader"
                      aria-sort={
                        sorted
                          ? session.settings.direction === "ascending"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      aria-label={t("table.sortColumn", { name: headerName(item.index) })}
                      style={{ width: item.size }}
                      onClick={() => session.cycleSort(item.index)}
                    >
                      <span className="adp-table-head-label">{headerName(item.index)}</span>
                      {sorted ? (
                        session.settings.direction === "ascending" ? (
                          <ArrowUp size={12} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={12} aria-hidden="true" />
                        )
                      ) : null}
                    </button>
                  );
                })}
                {trailingWidth > 0 ? (
                  <div style={{ width: trailingWidth, flex: "none" }} />
                ) : null}
              </div>
              <div
                className="adp-table-body"
                style={{ height: rowVirtualizer.getTotalSize(), width: totalWidth }}
              >
                {virtualRows.map((item) => {
                  const row = session.rowAt(item.index);
                  return (
                    <div
                      key={item.key}
                      className="adp-table-row"
                      role="row"
                      style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT, width: totalWidth }}
                    >
                      <div className="adp-table-number" role="rowheader">
                        {item.index + 1}
                      </div>
                      {firstColumnOffset > 0 ? <div style={{ width: firstColumnOffset, flex: "none" }} /> : null}
                      {visibleColumns.map((column) => (
                        <div
                          key={column.key}
                          className="adp-table-cell"
                          role="gridcell"
                          style={{ width: column.size }}
                        >
                          {row ? (row[column.index] ?? "") : ""}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}
    </ViewerFrame>
  );
}
