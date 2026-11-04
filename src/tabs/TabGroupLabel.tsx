import { useTranslation } from "react-i18next";
import type { TabGroup } from "../services/tabGroups";
import type { TabDropTargetHandlers } from "../transfer/useTabDropTarget";

/** A tab group's label in the one TabStrip (Step 09b T5, E8/D3-D4).
 * A real button with its own focus, separate from tab positions:
 * keyboard tab navigation keeps using the actual tabs. The color is
 * a dot and a 3px underline, never the only label. No native calls. */

export interface TabGroupLabelProps {
  group: TabGroup;
  memberCount: number;
  active: boolean;
  onToggle: () => void;
  onMenu: (anchor: DOMRect) => void;
  /** File-drop target handlers and state (Step 09c T4). */
  dropHandlers?: TabDropTargetHandlers;
  dropHover?: boolean;
}

export default function TabGroupLabel({
  group,
  memberCount,
  active,
  onToggle,
  onMenu,
  dropHandlers,
  dropHover = false,
}: TabGroupLabelProps) {
  const { t } = useTranslation();
  const classes = [
    "adp-tab-group-label",
    `adp-tab-group-label--${group.color}`,
    active ? "adp-tab-group-label--active" : "",
    dropHover ? "adp-tab--drop-hover" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-group-id={group.id}
      {...dropHandlers}
      aria-expanded={!group.collapsed}
      aria-label={`${group.name}, ${t("groups.count", { count: memberCount })}`}
      title={dropHover ? t("transfer.dropHere") : group.name}
      onClick={onToggle}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.currentTarget.getBoundingClientRect());
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          onMenu(event.currentTarget.getBoundingClientRect());
        }
      }}
    >
      <span className="adp-tab-group-dot" aria-hidden="true" />
      <span className="adp-tab-group-name">{group.name}</span>
      <span className="adp-tab-group-count">
        {t("groups.count", { count: memberCount })}
      </span>
    </button>
  );
}
