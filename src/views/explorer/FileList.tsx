import { useVirtualizer } from "@tanstack/react-virtual";
import { Cloud, Link2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ExplorerItem, SortDirection, SortKey } from "../../services/explorer";
import { formatDate, formatSize } from "../../services/format";
import { fileExtension, fileTile } from "./fileTile";

export interface FileListProps {
  items: ExplorerItem[];
  selectedPath: string | null;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onSelect: (item: ExplorerItem) => void;
  onOpen: (item: ExplorerItem) => void;
  /** Called once after the first rows of a new listing are painted. */
  onFirstPaint?: () => void;
}

const ROW_HEIGHT = 28;

export default function FileList(props: FileListProps) {
  const { t, i18n } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const paintedRef = useRef(false);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const virtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  useEffect(() => {
    paintedRef.current = false;
  }, [props.items]);

  useEffect(() => {
    if (paintedRef.current || props.items.length === 0) return;
    paintedRef.current = true;
    const handle = requestAnimationFrame(() => props.onFirstPaint?.());
    return () => cancelAnimationFrame(handle);
  }, [props.items, props]);

  useEffect(() => {
    const pending = pendingFocusIndexRef.current;
    if (pending === null) return;
    pendingFocusIndexRef.current = null;
    const handle = requestAnimationFrame(() => {
      parentRef.current
        ?.querySelector<HTMLElement>(`[data-index="${pending}"]`)
        ?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [props.selectedPath, props.items]);

  const typeLabel = (item: ExplorerItem): string => {
    if (item.kind === "folder") return t("explorer.folderType");
    const ext = fileExtension(item.name);
    return ext ? t("explorer.fileType", { ext: ext.toUpperCase() }) : t("explorer.genericFile");
  };

  const header = (key: SortKey, labelKey: string, className: string) => (
    <button
      type="button"
      role="columnheader"
      className={`adp-filelist-header-cell ${className}`}
      aria-label={t("explorer.sortBy", { name: t(labelKey) })}
      aria-sort={props.sortKey === key ? (props.sortDirection === "ascending" ? "ascending" : "descending") : undefined}
      onClick={() => props.onSort(key)}
    >
      <span>{t(labelKey)}</span>
      {props.sortKey === key ? <span aria-hidden="true">{props.sortDirection === "ascending" ? "↑" : "↓"}</span> : null}
    </button>
  );

  return (
    <div className="adp-filelist">
      <div className="adp-filelist-header" role="row">
        {header("name", "explorer.columnName", "adp-col-name")}
        {header("modified", "explorer.columnModified", "adp-col-date")}
        {header("kind", "explorer.columnType", "adp-col-type")}
        {header("size", "explorer.columnSize", "adp-col-size")}
      </div>
      <div ref={parentRef} className="adp-filelist-scroll" role="listbox" aria-label={t("explorer.fileListLabel")}>
        <div className="adp-filelist-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = props.items[row.index];
            const tile = fileTile(item.name, item.kind);
            const Icon = tile.icon;
            return (
              <button
                key={item.path}
                type="button"
                role="option"
                data-index={row.index}
                aria-selected={props.selectedPath === item.path}
                className={`adp-file-row${props.selectedPath === item.path ? " adp-file-row--selected" : ""}${item.hidden ? " adp-file-row--hidden" : ""}`}
                style={{ transform: `translateY(${row.start}px)`, height: ROW_HEIGHT }}
                onClick={() => props.onSelect(item)}
                onDoubleClick={() => props.onOpen(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    props.onOpen(item);
                    return;
                  }
                  const move = (targetIndex: number) => {
                    const target = props.items[targetIndex];
                    if (!target) return;
                    event.preventDefault();
                    pendingFocusIndexRef.current = targetIndex;
                    virtualizer.scrollToIndex(targetIndex, { align: "auto" });
                    props.onSelect(target);
                  };
                  if (event.key === "ArrowDown") move(row.index + 1);
                  else if (event.key === "ArrowUp") move(row.index - 1);
                  else if (event.key === "Home") move(0);
                  else if (event.key === "End") move(props.items.length - 1);
                }}
              >
                <span className="adp-col-name adp-file-name-cell">
                  <span className={`adp-file-tile adp-file-tile--${tile.tone}`}>
                    <Icon size={13} aria-hidden="true" />
                  </span>
                  <span className="adp-file-name">{item.name}</span>
                  {item.online_only ? (
                    <span className="adp-file-badge" title={t("explorer.onlineOnly")} aria-label={t("explorer.onlineOnly")}>
                      <Cloud size={12} aria-hidden="true" />
                    </span>
                  ) : null}
                  {item.is_link ? (
                    <span className="adp-file-badge" title={t("explorer.isLink")} aria-label={t("explorer.isLink")}>
                      <Link2 size={11} aria-hidden="true" />
                    </span>
                  ) : null}
                </span>
                <span className="adp-col-date">{formatDate(item.modified_unix, i18n.language)}</span>
                <span className="adp-col-type">{typeLabel(item)}</span>
                <span className="adp-col-size">{item.kind === "folder" ? "" : formatSize(item.size, i18n.language)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}