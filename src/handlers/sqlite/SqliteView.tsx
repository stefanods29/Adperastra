import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Database, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { useRowSizes } from "../../appearance/density";
import { errorText } from "../../services/errors";
import {
  sqliteTables,
  type SqliteCell,
  type SqliteRow,
  type SqliteTableInfo,
} from "../../services/extraViews";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { useExtraView } from "../extraView/useExtraView";

type SortDirection = "asc" | "desc";

interface SqliteCtx {
  ready: boolean;
  table: string | null;
  sortable: boolean;
}

export function cellText(cell: SqliteCell): string {
  switch (cell.kind) {
    case "null":
      return "NULL";
    case "text":
      return cell.value;
    case "integer":
    case "real":
      return cell.value;
    case "blob":
      return `BLOB (${cell.blob_size}) ${cell.preview_hex}`;
  }
}

function rowMatches(row: SqliteRow, needle: string): boolean {
  if (needle === "") return false;
  const wanted = needle.toLocaleLowerCase();
  return row.some((cell) => cellText(cell).toLocaleLowerCase().includes(wanted));
}

export default function SqliteView({
  info,
  active,
  onStatus,
  onOpenInWindowsApp,
  find,
  previewOnly,
}: HandlerViewProps) {
  const { t } = useTranslation();
  const size = useRowSizes();
  const view = useExtraView(info.path, "sqlite", active);
  const [tables, setTables] = useState<SqliteTableInfo[]>([]);
  const [table, setTable] = useState<SqliteTableInfo | null>(null);
  const [rows, setRows] = useState<SqliteRow[]>([]);
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<number | null>(null);
  const [showReading, setShowReading] = useState(false);
  const [matches, setMatches] = useState(0);
  const [schemaError, setSchemaError] = useState<unknown>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFind = useRef({ request: 0, text: "" });
  const lastFetchedCursor = useRef<string | null>(null);
  const currentTable = table?.name ?? null;
  const pageCursor = view.page?.next_cursor ?? null;

  useEffect(() => {
    setTables([]);
    setTable(null);
    setRows([]);
    setSelected(null);
    lastFetchedCursor.current = null;
    if (!view.session || view.phase !== "ready") return;
    let cancelled = false;
    void sqliteTables(view.session.session_id)
      .then((list) => {
        if (cancelled) return;
        setTables(list);
        const first = list[0] ?? null;
        setTable(first);
        if (first) {
          void view.request({ table: first.name });
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) setSchemaError(failure);
      });
    return () => {
      cancelled = true;
    };
    // Only a new session loads the schema again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.session?.session_id, view.phase]);

  useEffect(() => {
    const payload = view.page?.payload;
    if (!payload || payload.kind !== "sqlite") return;
    setTable(payload.table);
    const incoming = payload.rows;
    setRows((current) => [...current, ...incoming]);
  }, [view.page]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => size.row,
    overscan: 20,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : 0;

  useEffect(() => {
    if (!pageCursor || view.loadingPage || view.page?.complete) return;
    if (lastRow + 20 < rows.length) return;
    if (lastFetchedCursor.current === pageCursor) return;
    lastFetchedCursor.current = pageCursor;
    void view.request({
      cursor: pageCursor,
      table: currentTable,
      sort_column: sortColumn,
      sort_direction: sortDirection,
    });
  }, [lastRow, rows.length, pageCursor, currentTable, sortColumn, sortDirection, view]);

  useEffect(() => {
    if (view.phase !== "loading") {
      setShowReading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReading(true), 1000);
    return () => window.clearTimeout(timer);
  }, [view.phase]);

  useEffect(() => {
    if (find.request === lastFind.current.request && find.text === lastFind.current.text) return;
    lastFind.current = { request: find.request, text: find.text };
    if (find.text === "") {
      setMatches(0);
      return;
    }
    let count = 0;
    for (let index = 0; index < rows.length && count < 10_000; index += 1) {
      if (rowMatches(rows[index], find.text)) {
        count += 1;
        virtualizer.scrollToIndex(index);
      }
    }
    setMatches(count);
  }, [find.request, find.text, rows, virtualizer]);

  const selectTable = useCallback(
    (next: SqliteTableInfo) => {
      setTable(next);
      setRows([]);
      setSortColumn(null);
      setSortDirection("asc");
      setSelected(null);
      lastFetchedCursor.current = null;
      void view.request({ table: next.name });
    },
    [view],
  );

  const toggleSort = useCallback(
    (column: number) => {
      if (!currentTable) return;
      const nextDirection: SortDirection =
        sortColumn === column && sortDirection === "asc" ? "desc" : "asc";
      const nextColumn = sortColumn === column && sortDirection === "desc" ? null : column;
      setSortColumn(nextColumn);
      setSortDirection(nextDirection);
      setRows([]);
      lastFetchedCursor.current = null;
      void view.request({
        table: currentTable,
        sort_column: nextColumn,
        sort_direction: nextColumn === null ? null : nextDirection,
      });
    },
    [currentTable, sortColumn, sortDirection, view],
  );

  useEffect(() => {
    const items: string[] = [];
    if (table) {
      items.push(table.name);
      items.push(t("sqlite.columnCount", { count: table.columns.length }));
      items.push(t("sqlite.rowCount", { count: rows.length }));
    }
    if (find.text !== "") items.push(t("viewer.matches", { count: matches }));
    onStatus({ items });
  }, [table, rows.length, find.text, matches, onStatus, t]);

  const ctx: SqliteCtx = {
    ready: table !== null,
    table: currentTable,
    sortable: table !== null && table.columns.length > 0,
  };
  const commands = useMemo<Command<SqliteCtx>[]>(
    () => [
      {
        id: "sqlite.reload",
        labelKey: "sqlite.reload",
        icon: RefreshCw,
        risk: "read-only",
        helpSlug: "viewing-sqlite",
        enabledWhen: () => true,
        run: () => view.reload(),
      },
      {
        id: "sqlite.openInWindowsApp",
        labelKey: "fileTab.openInWindowsApp",
        icon: Database,
        risk: "read-only",
        helpSlug: "opening-files",
        enabledWhen: () => true,
        run: () => onOpenInWindowsApp(),
      },
    ],
    // `view.reload` is stable enough for the command's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOpenInWindowsApp],
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
            id: "database",
            labelKey: "extra_view.tables",
            controls: [{ type: "button", command: "sqlite.reload", keyTip: "R" }],
          },
        ],
      },
    ],
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const current = selected ?? 0;
    let target: number | null = null;
    if (event.key === "ArrowDown") target = current + 1;
    else if (event.key === "ArrowUp") target = current - 1;
    else if (event.key === "PageDown") target = current + 20;
    else if (event.key === "PageUp") target = current - 20;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = rows.length - 1;
    if (target === null) return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(target, rows.length - 1));
    setSelected(bounded);
    virtualizer.scrollToIndex(bounded);
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-sqlite">
        {view.phase === "loading" ? (
          <div className="adp-viewer-message" role="status">
            <Skeleton variant="rows" count={8} />
            {showReading ? (
              <>
                <p>{t("components.loading")}</p>
                <Button onClick={view.cancelOpen}>{t("common.cancel")}</Button>
              </>
            ) : null}
          </div>
        ) : null}
        {view.phase === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{errorText(t, view.error, "extra_view")}</p>
            {String((view.error as Error | undefined)?.message ?? view.error) === "extra_view.read_only" ? (
              <p className="adp-viewer-note">{t("extra_view.wal")}</p>
            ) : null}
            <div className="adp-dialog-actions">
              <Button onClick={view.reload}>{t("common.retry")}</Button>
              <Button variant="primary" onClick={onOpenInWindowsApp}>
                {t("fileTab.openInWindowsApp")}
              </Button>
            </div>
          </div>
        ) : null}
        {schemaError ? (
          <p className="adp-notebook-error" role="alert">{errorText(t, schemaError, "extra_view")}</p>
        ) : null}
        {tables.length > 0 ? (
          <div className="adp-sqlite-layout">
            <aside className="adp-sqlite-tables" aria-label={t("extra_view.tables")}>
              <h2>{t("extra_view.tables")}</h2>
              <ul>
                {tables.map((candidate) => (
                  <li key={candidate.name}>
                    <button
                      type="button"
                      className={candidate.name === currentTable ? "adp-sqlite-table--current" : ""}
                      onClick={() => selectTable(candidate)}
                    >
                      {candidate.name}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="adp-viewer-note">{t("sqlite.readOnly")}</p>
            </aside>
            <div className="adp-sqlite-table">
              {table ? (
                <>
                  <div
                    ref={scrollRef}
                    className="adp-sqlite-grid"
                    role="grid"
                    aria-label={t("sqlite.label", { name: table.name })}
                    aria-rowcount={rows.length}
                    aria-colcount={table.columns.length}
                    tabIndex={0}
                    onKeyDown={onGridKey}
                  >
                    <div className="adp-sqlite-head" role="row">
                      <span className="adp-sqlite-number" aria-hidden="true" />
                      {table.columns.map((column, index) => (
                        <button
                          key={`${column.name}-${index}`}
                          type="button"
                          role="columnheader"
                          aria-sort={
                            sortColumn === index
                              ? sortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          onClick={() => toggleSort(index)}
                        >
                          <span>{column.name}</span>
                          {column.declared_type ? <small>{column.declared_type}</small> : null}
                          {sortColumn === index ? (
                            sortDirection === "asc" ? (
                              <ArrowUp size={12} aria-hidden="true" />
                            ) : (
                              <ArrowDown size={12} aria-hidden="true" />
                            )
                          ) : null}
                        </button>
                      ))}
                    </div>
                    <div className="adp-sqlite-body" style={{ height: virtualizer.getTotalSize() }}>
                      {virtualRows.map((item) => {
                        const row = rows[item.index];
                        return (
                          <div
                            key={item.key}
                            className={`adp-sqlite-row${item.index === selected ? " adp-sqlite-row--selected" : ""}`}
                            role="row"
                            aria-selected={item.index === selected}
                            style={{ transform: `translateY(${item.start}px)`, height: size.row }}
                            onClick={() => setSelected(item.index)}
                          >
                            <span className="adp-sqlite-number" role="rowheader">{item.index + 1}</span>
                            {row?.map((cell, index) => (
                              <span
                                key={index}
                                className={`adp-sqlite-cell adp-sqlite-cell--${cell.kind}`}
                                role="gridcell"
                                title={cell.kind === "text" && cell.truncated ? t("extra_view.partial") : undefined}
                              >
                                {cell.kind === "null"
                                  ? t("sqlite.null")
                                  : cell.kind === "blob"
                                    ? `${t("sqlite.blob")} (${cell.blob_size}) ${cell.preview_hex}`
                                    : cellText(cell)}
                              </span>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {rows.length === 0 && view.page ? (
                    <p className="adp-viewer-note">{t("sqlite.empty")}</p>
                  ) : null}
                  {!view.page?.complete && pageCursor ? (
                    <Button onClick={() => view.request({
                      cursor: pageCursor,
                      table: currentTable,
                      sort_column: sortColumn,
                      sort_direction: sortDirection,
                    })}>
                      {t("commands.more")}
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="adp-viewer-note">{t("sqlite.noTables")}</p>
              )}
            </div>
          </div>
        ) : null}
        {previewOnly ? <p className="adp-viewer-note" role="note">{t("preview.readOnly")}</p> : null}
      </div>
    </ViewerFrame>
  );
}

/** The viewer never offers a query box or a write action. */
export const SQLITE_ALLOWED_ACTIONS = ["reload", "select-table", "sort", "open-in-windows"] as const;
