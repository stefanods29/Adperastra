import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ExplorerItem } from "../../../services/explorer";
import { displayPath } from "../../../services/explorer";
import { folderViewKey } from "../../../services/folderViews";
import { COLUMN_WIDTH_DEFAULT, clampColumnWidth } from "../../../services/settings";
import ColumnPane from "./ColumnPane";
import ColumnPreview from "./ColumnPreview";
import {
  PREVIEW_MIN_WIDTH,
  columnChain,
  columnItems,
  columnLeftTarget,
  columnName,
  isFolderLike,
  singleSelected,
  type ColumnViewOptions,
} from "./columnTrail";
import { useColumnListings } from "./useColumnListings";
import type { ItemViewProps } from "./useItemInteractions";

export interface ColumnViewProps extends ItemViewProps {
  /** What the Explorer gives the column view (Step 05b). */
  options: ColumnViewOptions;
}

/** Column view (Step 05b D2): the folders above the open folder, then it,
 * then the selected folder or the preview of the selected file. */
export default function ColumnView({ options, ...props }: ColumnViewProps) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);

  const chain = useMemo(() => columnChain(options.root, options.folder), [options.root, options.folder]);
  const parents = chain.slice(0, -1);
  const activeFolder = chain[chain.length - 1];

  const selected = singleSelected(props.selection, props.items);
  const selectedKey = selected !== null ? folderViewKey(selected.path) : null;
  const repeatsColumn = selectedKey !== null && chain.some((path) => folderViewKey(path) === selectedKey);
  const child = selected !== null && isFolderLike(selected) && !repeatsColumn ? displayPath(selected.path) : null;
  const preview = selected !== null && !isFolderLike(selected) && options.showPreview ? selected : null;

  const sort = useMemo(
    () => ({ key: props.sortKey, direction: props.sortDirection }),
    [props.sortKey, props.sortDirection],
  );
  const getListing = useColumnListings(parents, child, activeFolder, sort, options.refreshKey);

  // All columns share one width; the divider drags it (D13).
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? options.width;
  useEffect(() => {
    setDragWidth(null);
  }, [options.width]);

  const removeListeners = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      removeListeners.current?.();
    },
    [],
  );

  const startResize = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    removeListeners.current?.();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: MouseEvent) => {
      setDragWidth(clampColumnWidth(startWidth + (moveEvent.clientX - startX)));
    };
    const onUp = (upEvent: MouseEvent) => {
      removeListeners.current?.();
      const finalWidth = clampColumnWidth(startWidth + (upEvent.clientX - startX));
      if (finalWidth === options.width) setDragWidth(null);
      else options.onWidthChange(finalWidth);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    removeListeners.current = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      removeListeners.current = null;
    };
  };

  const resetWidth = () => options.onWidthChange(COLUMN_WIDTH_DEFAULT);

  const onNavigateKey = (direction: "left" | "right") => {
    if (direction === "right") {
      if (child === null) return;
      const listing = getListing(child);
      let firstPath: string | null = null;
      if (listing?.status === "ready") {
        const first = columnItems(listing.items, options.showHidden, options.groupBy, props.typeLabel, new Date())[0];
        firstPath = first ? first.path : null;
      }
      options.onNavigate(child, firstPath, null);
      return;
    }
    const target = columnLeftTarget(chain, activeFolder);
    if (target !== null) options.onNavigate(target.folder, target.select, null);
  };

  const activeKey = folderViewKey(activeFolder);
  const childScrollKey = child !== null ? folderViewKey(child) : null;
  const previewPath = preview !== null ? preview.path : null;

  // The last column (or the preview) is always in view (D16).
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft = strip.scrollWidth;
  }, [activeKey, childScrollKey, previewPath]);

  // The open folder's column takes the focus after a navigation (D16).
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const current = document.activeElement;
    const inside = current !== null && strip.contains(current);
    if (current === null || current === document.body || inside) {
      strip.querySelector<HTMLElement>(".adp-colview-column--active .adp-colview-list")?.focus();
    }
  }, [activeKey]);

  const resizer = (key: string) => (
    <div
      key={key}
      className="adp-colview-resizer"
      aria-hidden="true"
      onMouseDown={startResize}
      onDoubleClick={resetWidth}
    />
  );

  return (
    <div className="adp-colview" ref={stripRef} role="group" aria-label={t("commands.viewColumns")}>
      {chain.flatMap((path, index) => {
        const k = folderViewKey(path);
        const isLast = index === chain.length - 1;
        const next = index + 1 < chain.length ? chain[index + 1] : null;
        return [
          <ColumnPane
            key={k}
            role={isLast ? "active" : "parent"}
            folder={path}
            name={columnName(path)}
            width={width}
            listing={getListing(path)}
            pathItem={next}
            view={props}
            note={isLast ? options.note : null}
            loading={isLast ? options.loading : false}
            showHidden={options.showHidden}
            groupBy={options.groupBy}
            onNavigateKey={onNavigateKey}
            onSelectItem={(item: ExplorerItem, menuPoint) => options.onNavigate(path, item.path, menuPoint)}
            onOpenColumn={() => options.onNavigate(path, next, null)}
            onDragItem={options.onDragItem}
          />,
          resizer(`r-${k}`),
        ];
      })}
      {child !== null ? (
        <>
          <ColumnPane
            key={folderViewKey(child)}
            role="child"
            folder={child}
            name={columnName(child)}
            width={width}
            listing={getListing(child)}
            pathItem={null}
            view={props}
            note={null}
            loading={false}
            showHidden={options.showHidden}
            groupBy={options.groupBy}
            onNavigateKey={onNavigateKey}
            onSelectItem={(item: ExplorerItem, menuPoint) => options.onNavigate(child, item.path, menuPoint)}
            onOpenColumn={() => options.onNavigate(child, null, null)}
            onDragItem={options.onDragItem}
          />
          {resizer(`r-${folderViewKey(child)}`)}
        </>
      ) : null}
      {preview !== null ? (
        <ColumnPreview
          key={preview.path}
          item={preview}
          width={Math.max(width, PREVIEW_MIN_WIDTH)}
          showExtensions={props.showExtensions}
          typeLabel={props.typeLabel}
          onOpen={props.onOpen}
        />
      ) : null}
    </div>
  );
}
