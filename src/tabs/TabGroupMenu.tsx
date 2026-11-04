import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { GROUP_COLORS, type GroupColor, type TabGroup } from "../services/tabGroups";

/** The group label's popup (Step 09b T5): existing menu roles, roving
 * focus, Esc closes and the caller restores the label's focus. Every
 * action is a callback; this component changes no state itself. */

export interface TabGroupMenuProps {
  group: TabGroup;
  anchor: DOMRect;
  onClose: () => void;
  onRename: () => void;
  onColor: (color: GroupColor) => void;
  onToggleCollapse: () => void;
  onUngroup: () => void;
  onCloseGroup: () => void;
  onSave: () => void;
  onSaveAndClose: () => void;
}

export default function TabGroupMenu({
  group,
  anchor,
  onClose,
  onRename,
  onColor,
  onToggleCollapse,
  onUngroup,
  onCloseGroup,
  onSave,
  onSaveAndClose,
}: TabGroupMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>("[data-menu-item]:not([disabled])")
      ?.focus({ preventScroll: true });
  }, []);

  const items = (): HTMLElement[] => [
    ...(ref.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not([disabled])") ?? []),
  ];

  const run = (action: () => void) => {
    action();
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      list[current === -1 ? 0 : (current + 1) % list.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      list[current === -1 ? list.length - 1 : (current - 1 + list.length) % list.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  const left = typeof window === "undefined" ? anchor.left : Math.max(4, Math.min(anchor.left, window.innerWidth - 240));
  const top = typeof window === "undefined" ? anchor.bottom + 4 : Math.max(4, Math.min(anchor.bottom + 4, window.innerHeight - 320));

  return (
    <div
      ref={ref}
      className="adp-tab-group-menu"
      role="menu"
      aria-label={group.name}
      style={{ left, top }}
      onKeyDown={onKeyDown}
    >
      <button type="button" role="menuitem" data-menu-item className="adp-tab-group-menu-item" onClick={() => run(onRename)}>
        {t("groups.rename")}
      </button>
      <div className="adp-tab-group-colors" role="group" aria-label={t("groups.color")}>
        {GROUP_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="menuitemradio"
            data-menu-item
            aria-checked={group.color === color}
            aria-label={t(`groups.${color}`)}
            title={t(`groups.${color}`)}
            className={`adp-tab-group-color adp-tab-group-color--${color}`}
            onClick={() => run(() => onColor(color))}
          >
            <span className="adp-tab-group-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
      <button type="button" role="menuitem" data-menu-item className="adp-tab-group-menu-item" onClick={() => run(onToggleCollapse)}>
        {t(group.collapsed ? "groups.expand" : "groups.collapse")}
      </button>
      <button type="button" role="menuitem" data-menu-item className="adp-tab-group-menu-item" onClick={() => run(onUngroup)}>
        {t("groups.ungroup")}
      </button>
      <button type="button" role="menuitem" data-menu-item className="adp-tab-group-menu-item" onClick={() => run(onSave)}>
        {t("groups.save")}
      </button>
      <button type="button" role="menuitem" data-menu-item className="adp-tab-group-menu-item" onClick={() => run(onSaveAndClose)}>
        {t("groups.saveClose")}
      </button>
      <button type="button" role="menuitem" data-menu-item className="adp-tab-group-menu-item" onClick={() => run(onCloseGroup)}>
        {t("groups.close")}
      </button>
    </div>
  );
}
