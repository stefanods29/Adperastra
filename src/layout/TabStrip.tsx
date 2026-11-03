/** The tabs and the "+" menu in every position (Step 05c): a row at the top
 * or the bottom, or a column on either side. Step 09b's tab groups extend
 * this one component. */
import {
  CircleHelp,
  Home,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import DropdownMenu from "../components/DropdownMenu";
import IconButton from "../components/IconButton";
import { handlers } from "../handlers";
import type { TabBarPosition } from "../services/settings";
import { tabKeyTarget } from "../services/tabKeys";
import type { TabState } from "../services/tabs";

export interface TabStripProps {
  tabs: readonly TabState[];
  activeId: string;
  side: TabBarPosition;
  collapsed: boolean;
  /** A tab's name, from App's `tabLabel`. */
  label: (tab: TabState) => string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: (kind: "help" | "settings" | "gallery") => void;
  onToggleCollapsed: () => void;
  /** Tabs with unsaved changes show a dot (Step 06a). */
  dirtyIds?: ReadonlySet<string>;
}

export default function TabStrip({
  tabs,
  activeId,
  side,
  collapsed,
  label,
  onActivate,
  onClose,
  onNewTab,
  onToggleCollapsed,
  dirtyIds,
}: TabStripProps) {
  const { t } = useTranslation();
  const vertical = side === "left" || side === "right";
  const hasFileTabs = tabs.some((tab) => tab.kind === "file");
  const iconsOnly = vertical && collapsed;

  const toggleIcon =
    side === "right"
      ? collapsed
        ? PanelRightOpen
        : PanelRightClose
      : collapsed
        ? PanelLeftOpen
        : PanelLeftClose;

  const tabNodes = tabs.map((tab, tabIndex) => {
    const handler = tab.kind === "file" && tab.handler ? handlers.get(tab.handler) : undefined;
    const Icon =
      tab.kind === "explorer"
        ? Home
        : tab.kind === "help"
          ? CircleHelp
          : tab.kind === "settings"
            ? SettingsIcon
            : tab.kind === "file"
              ? (handler?.icon ?? LayoutGrid)
              : LayoutGrid;
    const iconOnly = iconsOnly || (!vertical && tab.kind === "explorer" && hasFileTabs);
    const classes = ["adp-tab", tab.id === activeId ? "adp-tab--active" : "", iconOnly ? "adp-tab--icon-only" : ""]
      .filter(Boolean)
      .join(" ");
    // A tab in a collapsed column shows its name on hover; file tabs keep
    // their path, as in the row.
    const title = tab.kind === "file" ? tab.path : iconsOnly ? label(tab) : undefined;
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={tab.id === activeId}
        aria-label={label(tab)}
        aria-description={dirtyIds?.has(tab.id) ? t("editor.unsaved") : undefined}
        title={title}
        tabIndex={tab.id === activeId ? 0 : -1}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const target = tabKeyTarget(event.key, tabIndex, tabs.length);
          if (target === null) return;
          event.preventDefault();
          onActivate(tabs[target].id);
          (
            event.currentTarget.parentElement?.querySelectorAll("[role='tab']")[target] as HTMLElement | undefined
          )?.focus();
        }}
        className={classes}
        draggable={false}
        onClick={() => onActivate(tab.id)}
        onAuxClick={(event) => {
          if (event.button === 1) onClose(tab.id);
        }}
      >
        <Icon
          size={14}
          aria-hidden="true"
          style={handler ? { color: `var(--adp-accent-${handler.accent})` } : undefined}
        />
        {iconOnly ? null : <span className="adp-tab-label">{label(tab)}</span>}
        {tab.kind !== "explorer" && dirtyIds?.has(tab.id) ? (
          <span className="adp-tab-dirty" aria-hidden="true" />
        ) : null}
        {tab.kind !== "explorer" && !iconsOnly ? (
          // A mouse target only: a tab may not contain another control.
          // The keyboard closes the current tab with Ctrl+W.
          <span
            className="adp-tab-close"
            aria-hidden="true"
            title={t("tabs.close")}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <X size={12} aria-hidden="true" />
          </span>
        ) : null}
      </div>
    );
  });

  const newTab = (
    <DropdownMenu
      ariaLabel={t("tabs.newTab")}
      icon={Plus}
      items={[
        { id: "help", label: t("help.title") },
        { id: "settings", label: t("settings.title") },
        { id: "gallery", label: t("tabs.components") },
      ]}
      onSelect={(id) => onNewTab(id as "help" | "settings" | "gallery")}
    />
  );

  if (vertical) {
    return (
      <div
        className={`adp-tabrail adp-tabrail--${side}${collapsed ? " adp-tabrail--collapsed" : ""}`}
        role="tablist"
        aria-orientation="vertical"
      >
        <IconButton
          icon={toggleIcon}
          labelKey={collapsed ? "tabs.expand" : "tabs.collapse"}
          className="adp-tabrail-toggle"
          onClick={onToggleCollapsed}
        />
        {tabNodes}
        {newTab}
      </div>
    );
  }

  return (
    <div className={`adp-tabbar${side === "bottom" ? " adp-tabbar--bottom" : ""}`} role="tablist">
      {tabNodes}
      {newTab}
    </div>
  );
}
