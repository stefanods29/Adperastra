/** The tabs and the "+" menu in every position (Step 05c): a row at the top
 * or the bottom, or a column on either side. Folder, pinned and split tabs
 * extend this one component (Steps 09a, 09b, 09i). */
import {
  CircleHelp,
  Columns2,
  Folder,
  Home,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import DropdownMenu from "../components/DropdownMenu";
import IconButton from "../components/IconButton";
import { handlers } from "../handlers";
import { isTauriRuntime, type TabBarPosition } from "../services/settings";
import { isSplitTab, splitLeavesOf } from "../services/splitViews";
import { tabKeyTarget } from "../services/tabKeys";
import type { TabGroup } from "../services/tabGroups";
import type { TabState } from "../services/tabs";
import TabGroupLabel from "../tabs/TabGroupLabel";
import { readDropPayload, type DropDataTransfer } from "../transfer/tabDropRouting";
import { useTabDropTarget, type TabDropTargetHandlers } from "../transfer/useTabDropTarget";

export interface TabStripProps {
  tabs: readonly TabState[];
  activeId: string;
  side: TabBarPosition;
  collapsed: boolean;
  /** A tab's name, from App's `tabLabel`. */
  label: (tab: TabState) => string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: (kind: "help" | "settings" | "gallery" | "folder" | "home") => void;
  onToggleCollapsed: () => void;
  /** Tabs with unsaved changes show a dot (Step 06a). */
  dirtyIds?: ReadonlySet<string>;
  /** Right-click / keyboard menu for one tab (Step 09a T6). */
  onTabMenu?: (tab: TabState, anchor: { x: number; y: number }) => void;
  /** Delay before a file drag over a tab activates it (Step 09c D2). */
  hoverMs?: number;
  /** File drops on the strip itself or on one tab (Step 09c T4). */
  onDropFilesOnBar?: (paths: readonly string[]) => Promise<unknown>;
  onDropFilesOnTab?: (tabId: string, paths: readonly string[]) => Promise<unknown>;
  /** Live tab groups (Step 09b T5): labels, members and collapse. */
  groups?: readonly TabGroup[];
  onGroupToggle?: (group: TabGroup) => void;
  onGroupMenu?: (group: TabGroup, anchor: DOMRect) => void;
  /** File drops on a group label open in the group (Step 09c addToGroup). */
  onDropFilesOnGroup?: (groupId: string, paths: readonly string[]) => Promise<unknown>;
  /** The plus menu's Saved groups entry (Step 09b). */
  onOpenSavedGroups?: () => void;
}

/** One legal hook host: React hooks cannot run inside `tabs.map`. The
 * existing tab markup stays the child of this target (Step 09c T4). */
function HoverDrop({
  targetId,
  hoverMs,
  onActivate,
  onDropFiles,
  children,
}: {
  targetId: string;
  hoverMs: number;
  onActivate: () => void;
  onDropFiles: (paths: readonly string[]) => Promise<unknown>;
  children: (handlers: TabDropTargetHandlers, hover: boolean) => ReactNode;
}) {
  const drop = useTabDropTarget({
    target_id: targetId,
    tab_id: targetId,
    hover_ms: hoverMs,
    active: true,
    onActivate,
    onDropFiles: async (paths) => {
      await onDropFiles(paths);
    },
  });
  return <>{children(drop, drop.hover)}</>;
}

/** One legal hook host for a group label's file-drop target; the label
 * itself stays a plain button (Step 09b D3, 09c T4). */
function GroupDrop({
  groupId,
  hoverMs,
  onDropFiles,
  children,
}: {
  groupId: string;
  hoverMs: number;
  onDropFiles: (paths: readonly string[]) => Promise<unknown>;
  children: (handlers: TabDropTargetHandlers, hover: boolean) => ReactNode;
}) {
  const drop = useTabDropTarget({
    target_id: `group:${groupId}`,
    tab_id: groupId,
    hover_ms: hoverMs,
    active: true,
    onActivate: () => undefined,
    onDropFiles: async (paths) => {
      await onDropFiles(paths);
    },
  });
  return <>{children(drop, drop.hover)}</>;
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
  onTabMenu,
  hoverMs = 600,
  onDropFilesOnBar,
  onDropFilesOnTab,
  groups,
  onGroupToggle,
  onGroupMenu,
  onDropFilesOnGroup,
  onOpenSavedGroups,
}: TabStripProps) {
  const { t } = useTranslation();
  const vertical = side === "left" || side === "right";
  const hasFileTabs = tabs.some(
    (tab) => tab.kind === "file" || (isSplitTab(tab) && splitLeavesOf(tab).some((leaf) => leaf.kind === "file")),
  );
  const iconsOnly = vertical && collapsed;

  // External drags reach the app through Tauri, not HTML drag events
  // (Step 09c T4): route a drop over the strip by the element under the
  // pointer, so it never falls back to the Explorer's current folder.
  const dropCallbacks = useRef({ onDropFilesOnBar, onDropFilesOnTab, onDropFilesOnGroup });
  dropCallbacks.current = { onDropFilesOnBar, onDropFilesOnTab, onDropFilesOnGroup };
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
          const scale = window.devicePixelRatio || 1;
          const hit = document.elementFromPoint(
            event.payload.position.x / scale,
            event.payload.position.y / scale,
          );
          if (!hit || !hit.closest("[data-tab-bar]")) return;
          const paths = event.payload.paths;
          const groupId = hit.closest("[data-group-id]")?.getAttribute("data-group-id");
          if (groupId) {
            void dropCallbacks.current.onDropFilesOnGroup?.(groupId, paths);
            return;
          }
          const tabId = hit.closest("[data-tab-target]")?.getAttribute("data-tab-target");
          if (tabId) {
            void dropCallbacks.current.onDropFilesOnTab?.(tabId, paths);
            return;
          }
          void dropCallbacks.current.onDropFilesOnBar?.(paths);
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // D3: a collapsed group hides every member except the active one; the
  // tab views stay mounted in the main area and only their strip entry
  // disappears. A label marks the group's first position and is never a
  // tab position of its own.
  const hidden = new Set<string>();
  for (const group of groups ?? []) {
    if (!group.collapsed) continue;
    for (const tabId of group.tab_ids) if (tabId !== activeId) hidden.add(tabId);
  }
  const groupOfTab = new Map<string, TabGroup>();
  for (const group of groups ?? []) {
    for (const tabId of group.tab_ids) groupOfTab.set(tabId, group);
  }
  const visibleTabs = tabs.filter((tab) => !hidden.has(tab.id));

  const toggleIcon =
    side === "right"
      ? collapsed
        ? PanelRightOpen
        : PanelRightClose
      : collapsed
        ? PanelLeftOpen
        : PanelLeftClose;

  const tabNodes = tabs.map((tab) => {
    const handler = tab.kind === "file" && tab.handler ? handlers.get(tab.handler) : undefined;
    const Icon =
      tab.kind === "explorer"
        ? Home
        : tab.kind === "help"
          ? CircleHelp
          : tab.kind === "settings"
            ? SettingsIcon
            : tab.kind === "folder"
                ? tab.folder?.path === "home" ? Home : Folder
              : tab.kind === "split"
                ? Columns2
                : tab.kind === "file"
                  ? (handler?.icon ?? LayoutGrid)
                  : LayoutGrid;
    const iconOnly = iconsOnly || (!vertical && tab.kind === "explorer" && hasFileTabs);
    const classes = [
      "adp-tab",
      tab.id === activeId ? "adp-tab--active" : "",
      iconOnly ? "adp-tab--icon-only" : "",
      tab.pinned ? "adp-tab--pinned" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // A tab in a collapsed column shows its name on hover; file and folder
    // tabs keep their path, and a split names both sides (Step 09i).
    const title =
      tab.kind === "file" || tab.kind === "folder"
        ? tab.path
        : tab.kind === "split"
          ? (tab.title ?? label(tab))
          : iconsOnly
            ? label(tab)
            : undefined;
    return (
      <HoverDrop
        key={tab.id}
        targetId={tab.id}
        hoverMs={hoverMs}
        onActivate={() => onActivate(tab.id)}
        onDropFiles={(paths) => onDropFilesOnTab?.(tab.id, paths) ?? Promise.resolve()}
      >
        {(dropHandlers, dropHover) => (
      <div
        role="tab"
        aria-selected={tab.id === activeId}
        aria-label={label(tab)}
        aria-description={dirtyIds?.has(tab.id) ? t("editor.unsaved") : undefined}
        title={title}
        tabIndex={tab.id === activeId ? 0 : -1}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const visibleIndex = visibleTabs.findIndex((entry) => entry.id === tab.id);
          const target = tabKeyTarget(event.key, visibleIndex, visibleTabs.length);
          if (target === null) return;
          event.preventDefault();
          onActivate(visibleTabs[target].id);
          (
            event.currentTarget.parentElement?.querySelectorAll("[role='tab']")[target] as HTMLElement | undefined
          )?.focus();
        }}
        {...dropHandlers}
        data-tab-target={tab.id}
        className={`${classes}${dropHover ? " adp-tab--drop-hover" : ""}`}
        draggable={false}
        onClick={() => onActivate(tab.id)}
        onContextMenu={(event) => {
          if (!onTabMenu) return;
          event.preventDefault();
          onTabMenu(tab, { x: event.clientX, y: event.clientY });
        }}
        onAuxClick={(event) => {
          if (event.button === 1) onClose(tab.id);
        }}
      >
        <Icon
          size={14}
          aria-hidden="true"
          style={handler ? { color: `var(--adp-accent-${handler.accent})` } : undefined}
        />
        {tab.pinned ? <Pin size={10} aria-hidden="true" className="adp-tab-pin" /> : null}
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
        )}
      </HoverDrop>
    );
  });

  // A group label sits at the group's first tab position, even when that
  // tab is hidden by collapse, so a fully collapsed group keeps a way to
  // expand. Ungrouped tabs keep their order.
  const labelled = new Set<string>();
  const orderedNodes: ReactNode[] = [];
  tabs.forEach((tab, tabIndex) => {
    const group = groupOfTab.get(tab.id);
    if (group && !labelled.has(group.id)) {
      labelled.add(group.id);
      orderedNodes.push(
        <GroupDrop
          key={`group-${group.id}`}
          groupId={group.id}
          hoverMs={hoverMs}
          onDropFiles={(paths) => onDropFilesOnGroup?.(group.id, paths) ?? Promise.resolve()}
        >
          {(dropHandlers, dropHover) => (
            <TabGroupLabel
              group={group}
              memberCount={group.tab_ids.length}
              active={group.tab_ids.includes(activeId)}
              onToggle={() => onGroupToggle?.(group)}
              onMenu={(anchor) => onGroupMenu?.(group, anchor)}
              dropHandlers={dropHandlers}
              dropHover={dropHover}
            />
          )}
        </GroupDrop>,
      );
    }
    if (hidden.has(tab.id)) return;
    orderedNodes.push(tabNodes[tabIndex]);
  });

  const newTab = (
    <div className="adp-tab-new-actions" style={{ display: "flex", flex: "none", flexDirection: vertical ? "column" : "row" }}>
    <IconButton icon={Plus} labelKey="tabs.newTab" onClick={() => onNewTab("home")} />
    <DropdownMenu
      ariaLabel={t("tabs.options")}
      items={[
        { id: "folder", label: t("tabs.newFolder") },
        { id: "help", label: t("help.title") },
        { id: "settings", label: t("settings.title") },
        { id: "gallery", label: t("tabs.components") },
        ...(onOpenSavedGroups ? [{ id: "saved_groups", label: t("groups.saved") }] : []),
      ]}
      onSelect={(id) => {
        if (id === "saved_groups") onOpenSavedGroups?.();
        else onNewTab(id as "help" | "settings" | "gallery" | "folder");
      }}
    />
    </div>
  );

  if (vertical) {
    return (
      <div
        className={`adp-tabrail adp-tabrail--${side}${collapsed ? " adp-tabrail--collapsed" : ""}`}
        role="tablist"
        aria-orientation="vertical"
        data-tab-bar="true"
        onDragOver={(event) => {
          if (readDropPayload(event.dataTransfer as unknown as DropDataTransfer).kind !== "files") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          const payload = readDropPayload(event.dataTransfer as unknown as DropDataTransfer);
          if (payload.kind !== "files") return;
          event.preventDefault();
          event.stopPropagation();
          void onDropFilesOnBar?.(payload.paths);
        }}
      >
        <IconButton
          icon={toggleIcon}
          labelKey={collapsed ? "tabs.expand" : "tabs.collapse"}
          className="adp-tabrail-toggle"
          onClick={onToggleCollapsed}
        />
        {orderedNodes}
        {newTab}
      </div>
    );
  }

  return (
    <div
      className={`adp-tabbar${side === "bottom" ? " adp-tabbar--bottom" : ""}`}
      data-tauri-drag-region={side === "top" ? "" : undefined}
      role="tablist"
      data-tab-bar="true"
      onDragOver={(event) => {
        if (readDropPayload(event.dataTransfer as unknown as DropDataTransfer).kind !== "files") return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const payload = readDropPayload(event.dataTransfer as unknown as DropDataTransfer);
        if (payload.kind !== "files") return;
        event.preventDefault();
        event.stopPropagation();
        void onDropFilesOnBar?.(payload.paths);
      }}
    >
      {orderedNodes}
      {newTab}
    </div>
  );
}
