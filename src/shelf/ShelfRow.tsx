import { Check, Cloud, File, FileWarning, Lock } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import FileThumbnail from "../components/FileThumbnail";
import { displayPath, parentPathOf } from "../services/explorer";
import type { ShelfItem } from "../services/shelf";

/** One 72 px shelf reference row. It owns only row interaction state;
 * the panel owns the catalog, selection and reviewed actions. */
export const SHELF_ROW_HEIGHT = 72;

function itemPath(item: ShelfItem): string | null {
  return item.source.kind === "disk" ? item.source.path : null;
}

function itemOrigin(item: ShelfItem): string {
  if (item.source.kind === "virtual") return displayPath(item.source.container_path);
  if (item.source.kind === "draft") return item.display_name;
  const path = item.source.path.replace(/\//g, "\\");
  return displayPath(parentPathOf(path) ?? path);
}

function stateLabelKey(item: ShelfItem): string | null {
  if (item.state === "missing") return "shelf.missing";
  if (item.state === "changed") return "shelf.changed";
  if (item.state === "unavailable") return "shelf.unavailable";
  return null;
}

export interface ShelfRowProps {
  item: ShelfItem;
  index: number;
  start: number;
  selected: boolean;
  focused: boolean;
  active: boolean;
  onFocus: () => void;
  onToggle: (id: string, additive: boolean, range: boolean) => void;
  onOpen: (id: string) => void;
  onContext: (index: number, x: number, y: number) => void;
  onDragOut: (id: string) => void;
}

export default function ShelfRow({
  item,
  index,
  start,
  selected,
  focused,
  active,
  onFocus,
  onToggle,
  onOpen,
  onContext,
  onDragOut,
}: ShelfRowProps) {
  const { t } = useTranslation();
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragSent = useRef(false);
  const path = itemPath(item);
  const stateKey = stateLabelKey(item);
  const StateIcon =
    item.state === "missing" || item.state === "changed"
      ? FileWarning
      : item.state === "unavailable"
        ? Cloud
        : File;

  return (
    <div
      className={[
        "adp-shelf-row",
        selected ? "adp-shelf-row--selected" : "",
        focused ? "adp-shelf-row--focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-shelf-row={index}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: SHELF_ROW_HEIGHT,
        transform: `translateY(${start}px)`,
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus();
        dragStart.current = { x: event.clientX, y: event.clientY };
        dragSent.current = false;
      }}
      onMouseMove={(event) => {
        const from = dragStart.current;
        if (!from || dragSent.current) return;
        if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < 4) return;
        dragSent.current = true;
        onDragOut(item.id);
      }}
      onMouseUp={() => {
        dragStart.current = null;
      }}
      onMouseLeave={() => {
        dragStart.current = null;
      }}
      onClick={(event) => {
        if (dragSent.current) {
          dragSent.current = false;
          return;
        }
        onToggle(item.id, event.ctrlKey, event.shiftKey);
      }}
      onDoubleClick={() => onOpen(item.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContext(index, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="adp-shelf-check"
        role="checkbox"
        aria-checked={selected}
        aria-label={item.display_name}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(item.id, true, false);
        }}
      >
        {selected ? <Check size={12} aria-hidden="true" /> : null}
      </button>
      <span className="adp-shelf-thumb" aria-hidden="true">
        {path && item.state === "available" ? (
          <FileThumbnail
            path={path}
            edge={64}
            active={active && item.state === "available"}
            fallback={<StateIcon size={32} aria-hidden="true" />}
          />
        ) : item.runtime_sensitive ? (
          <Lock size={28} aria-hidden="true" />
        ) : (
          <StateIcon size={28} aria-hidden="true" />
        )}
      </span>
      <span className="adp-shelf-text">
        <span className="adp-shelf-name" title={path ?? item.display_name}>
          {item.display_name}
        </span>
        <span className="adp-shelf-origin" title={itemOrigin(item)}>
          {itemOrigin(item)}
        </span>
        <span className="adp-shelf-state">
          {stateKey ? t(stateKey) : null}
          {item.runtime_sensitive ? ` · ${t("shelf.sensitive")}` : null}
        </span>
      </span>
      {item.runtime_sensitive ? (
        <Lock size={14} aria-hidden="true" className="adp-shelf-sensitive" />
      ) : null}
    </div>
  );
}
