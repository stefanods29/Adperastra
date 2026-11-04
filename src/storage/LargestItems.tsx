import { ChevronDown, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SortDirection } from "../services/explorer";
import { formatSize } from "../services/format";
import type { StorageNode } from "../services/storage";
import { storageDisplayPath } from "../services/storage";

/** Largest-items list (Step 11c T3): 32 px rows, pages supplied by the
 * bounded native page command. Unknown allocated space sorts last in both
 * directions; a zero or unknown value is never treated as zero bytes. */

export type LargestSortKey = "logical" | "allocated" | "count";

export function sortLargestNodes(
  nodes: readonly StorageNode[],
  key: LargestSortKey,
  direction: SortDirection,
): StorageNode[] {
  const numeric = (node: StorageNode): number | null => {
    if (key === "logical") return node.logical_bytes;
    if (key === "count") return node.item_count;
    return typeof node.allocated_bytes === "number" ? node.allocated_bytes : null;
  };
  return [...nodes].sort((left, right) => {
    const a = numeric(left);
    const b = numeric(right);
    if (a === null && b === null) return left.path.toLowerCase() < right.path.toLowerCase() ? -1 : 1;
    if (a === null) return 1;
    if (b === null) return -1;
    const diff = direction === "ascending" ? a - b : b - a;
    if (diff !== 0) return diff;
    return left.path.toLowerCase() < right.path.toLowerCase() ? -1 : 1;
  });
}

export interface LargestItemsProps {
  nodes: readonly StorageNode[];
  totalCount: number;
  label: string;
  nextCursor?: string | null;
  loading?: boolean;
  selected: ReadonlySet<string>;
  onSelect: (node: StorageNode) => void;
  onOpen: (node: StorageNode) => void;
  onDrill: (node: StorageNode) => void;
  onLoadMore: () => void;
  sortKey: LargestSortKey;
  sortDirection: SortDirection;
  onSort: (key: LargestSortKey) => void;
}

export default function LargestItems(props: LargestItemsProps) {
  const { t, i18n } = useTranslation();
  const sorted = sortLargestNodes(props.nodes, props.sortKey, props.sortDirection);

  const header = (key: LargestSortKey, labelKey: string) => (
    <button
      type="button"
      className="adp-storage-column-header"
      aria-label={t("explorer.sortBy", { name: t(labelKey) })}
      onClick={() => props.onSort(key)}
    >
      <span>{t(labelKey)}</span>
      {props.sortKey === key ? (
        <span aria-hidden="true">{props.sortDirection === "ascending" ? "↑" : "↓"}</span>
      ) : null}
    </button>
  );

  return (
    <section className="adp-storage-largest" aria-label={props.label}>
      <div className="adp-storage-section-header">
        <h2 className="adp-storage-heading">{props.label}</h2>
        <span className="adp-storage-count">{props.totalCount}</span>
      </div>
      <div className="adp-storage-table-head" role="group" aria-label={t("storage.largest")}>
        <span>{t("explorer.columnName")}</span>
        {header("logical", "storage.logical")}
        {header("allocated", "storage.allocated")}
        {header("count", "storage.items")}
        <span aria-hidden="true" />
      </div>
      <ul className="adp-storage-largest-list" aria-label={props.label}>
        {sorted.map((node) => {
          const selected = props.selected.has(node.path);
          const allocated =
            typeof node.allocated_bytes === "number"
              ? formatSize(node.allocated_bytes, i18n.language)
              : t("storage.unknownValue");
          return (
            <li
              key={node.id}
              className={`adp-storage-row${selected ? " adp-storage-row--selected" : ""}`}
            >
              <button
                type="button"
                className="adp-storage-row-main"
                aria-pressed={selected}
                onDoubleClick={() => props.onOpen(node)}
                onClick={() => props.onSelect(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onOpen(node);
                }}
              >
                <span className="adp-storage-name" title={storageDisplayPath(node.path)}>
                  {node.name}
                </span>
                <span className="adp-storage-bytes">
                  {formatSize(node.logical_bytes, i18n.language)}
                </span>
                <span className="adp-storage-bytes">{allocated}</span>
                <span className="adp-storage-items">{node.item_count}</span>
              </button>
              {node.kind === "folder" ? (
                <button
                  type="button"
                  className="adp-icon-btn"
                  aria-label={t("common.open")}
                  title={t("common.open")}
                  onClick={() => props.onDrill(node)}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {props.nextCursor ? (
        <button
          type="button"
          className="adp-storage-load-more"
          disabled={props.loading}
          onClick={props.onLoadMore}
        >
          <ChevronDown size={14} aria-hidden="true" />
          {t("storage.loadMore")}
        </button>
      ) : null}
    </section>
  );
}


