import { Check, ChevronRight } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { MenuEntry } from "../commands/menus";
import { commandLabelKey, isCommandEnabled, type Command, type CommandContext } from "../commands/registry";
import { formatShortcut } from "../services/shortcuts";

/** Where a menu opens: at a point (right-click), below a button
 * (dropdowns), or beside a menu item (submenus). */
export type MenuAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "below" | "side"; left: number; top: number; right: number; bottom: number };

export type MenuCloseReason = "run" | "escape" | "outside" | "tab" | "back";

export interface MenuProps {
  /** Already resolved with `resolveMenu`. */
  entries: MenuEntry[];
  ctx: CommandContext;
  lookup: (id: string) => Command | undefined;
  anchor: MenuAnchor;
  onRun: (command: Command) => void;
  onClose: (reason: MenuCloseReason) => void;
  ariaLabel: string;
  /** Keyboard-opened menus start on their first item. */
  focusFirst?: boolean;
  /** Called after the first paint, for the Instant-tier measurement. */
  onShown?: () => void;
  nested?: boolean;
}

interface Focusable {
  entry: MenuEntry;
  commandId: string | null;
  label: string;
}

const MARGIN = 4;

function place(anchor: MenuAnchor, width: number, height: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;
  if (anchor.kind === "point") {
    left = anchor.x + width > vw - MARGIN ? anchor.x - width : anchor.x;
    top = anchor.y + height > vh - MARGIN ? Math.min(anchor.y - height, vh - height - MARGIN) : anchor.y;
  } else if (anchor.kind === "below") {
    left = anchor.left + width > vw - MARGIN ? anchor.right - width : anchor.left;
    top = anchor.bottom + 4 + height > vh - MARGIN ? anchor.top - height - 4 : anchor.bottom + 4;
  } else {
    left = anchor.right - 2 + width > vw - MARGIN ? anchor.left - width + 2 : anchor.right - 2;
    top = anchor.top - 4 + height > vh - MARGIN ? vh - height - MARGIN : anchor.top - 4;
  }
  return { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) };
}

/** One renderer for every menu built from commands (contract 9):
 * right-click menus, command bar dropdowns, and the overflow menu. Our
 * own items render synchronously, so a menu is on screen in the same
 * frame as the click. */
export default function Menu(props: MenuProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const hoverTimer = useRef<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(props.focusFirst ? 0 : -1);
  const [sub, setSub] = useState<{ index: number; anchor: MenuAnchor; focusFirst: boolean } | null>(null);
  const { ctx, lookup, onClose, onShown, nested } = props;

  const focusables: Focusable[] = [];
  for (const entry of props.entries) {
    if (entry.type === "command") {
      const command = lookup(entry.id);
      if (command) focusables.push({ entry, commandId: entry.id, label: t(commandLabelKey(command, ctx)) });
    } else if (entry.type === "iconRow") {
      for (const id of entry.ids) {
        const command = lookup(id);
        if (command) focusables.push({ entry, commandId: id, label: t(commandLabelKey(command, ctx)) });
      }
    } else if (entry.type === "submenu") {
      focusables.push({ entry, commandId: null, label: t(entry.labelKey) });
    }
  }

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition(place(props.anchor, rect.width, rect.height));
  }, [props.anchor]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => onShown?.());
    return () => cancelAnimationFrame(frame);
    // Only once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (nested) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      // Clicks inside a menu, or on the button that opened it (it toggles).
      if (target.closest(".adp-ctxmenu") || target.closest("[aria-haspopup='menu'][aria-expanded='true']")) return;
      onClose("outside");
    };
    const onLost = () => onClose("outside");
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onLost);
    window.addEventListener("resize", onLost);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onLost);
      window.removeEventListener("resize", onLost);
    };
  }, [nested, onClose]);

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const openSubmenu = (index: number, focusFirst: boolean) => {
    const element = itemRefs.current[index];
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setSub({ index, focusFirst, anchor: { kind: "side", left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } });
  };

  const activate = (index: number) => {
    const item = focusables[index];
    if (!item) return;
    if (item.entry.type === "submenu") {
      openSubmenu(index, true);
      return;
    }
    const command = item.commandId ? lookup(item.commandId) : undefined;
    if (!command || !isCommandEnabled(command, ctx)) return;
    onClose("run");
    props.onRun(command);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== ref.current) return;
    const count = focusables.length;
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (value + 1) % Math.max(1, count));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (value <= 0 ? count - 1 : value - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(count - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(active);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (focusables[active]?.entry.type === "submenu") openSubmenu(active, true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (nested) onClose("back");
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose(nested ? "back" : "escape");
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose("tab");
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const letter = event.key.toLocaleLowerCase();
      for (let step = 1; step <= count; step += 1) {
        const index = (active + step + count) % count;
        if (focusables[index].label.toLocaleLowerCase().startsWith(letter)) {
          setActive(index);
          break;
        }
      }
    }
  };

  const onHover = (index: number) => {
    setActive(index);
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    const isSubmenu = focusables[index]?.entry.type === "submenu";
    hoverTimer.current = window.setTimeout(() => {
      if (isSubmenu) openSubmenu(index, false);
      else setSub(null);
    }, 200);
  };

  const closeSub = (reason: MenuCloseReason) => {
    if (reason === "run" || reason === "outside" || reason === "tab") {
      onClose(reason);
      return;
    }
    setSub(null);
    ref.current?.focus({ preventScroll: true });
  };

  let focusIndex = -1;
  const itemId = (index: number) => `${menuId}-item-${index}`;

  const renderCommand = (id: string, index: number, iconOnly: boolean) => {
    const command = lookup(id);
    if (!command) return null;
    const enabled = isCommandEnabled(command, ctx);
    const label = t(commandLabelKey(command, ctx));
    const shortcut = command.shortcut ? formatShortcut(command.shortcut, t) : "";
    // Icon buttons have no visible label, so their tooltip says it all.
    const hint = command.pending ? t("commands.comingLater", { label }) : shortcut ? `${label} (${shortcut})` : label;
    const checked = command.checkedWhen ? command.checkedWhen(ctx) : undefined;
    const role = command.checkKind === "toggle" ? "menuitemcheckbox" : command.checkKind === "radio" ? "menuitemradio" : "menuitem";
    const Icon = command.icon;
    const className = `${iconOnly ? "adp-ctxmenu-iconbtn" : "adp-ctxmenu-item"}${index === active ? " adp-ctxmenu-item--active" : ""}`;
    return (
      <div
        key={`${id}-${index}`}
        id={itemId(index)}
        ref={(element) => {
          itemRefs.current[index] = element;
        }}
        role={role}
        aria-checked={checked}
        aria-disabled={!enabled}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? hint : undefined}
        className={className}
        onMouseEnter={() => onHover(index)}
        onClick={() => activate(index)}
      >
        {iconOnly ? (
          <Icon size={16} aria-hidden="true" />
        ) : (
          <>
            <span className="adp-ctxmenu-icon" aria-hidden="true">
              {command.checkKind ? (checked ? <Check size={14} className="adp-ctxmenu-check" /> : null) : <Icon size={16} />}
            </span>
            <span className="adp-ctxmenu-label">{label}</span>
            {shortcut ? <span className="adp-ctxmenu-shortcut">{shortcut}</span> : null}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className="adp-ctxmenu"
      role="menu"
      aria-label={props.ariaLabel}
      tabIndex={-1}
      aria-activedescendant={active >= 0 ? itemId(active) : undefined}
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {props.entries.map((entry, entryIndex) => {
        if (entry.type === "separator") {
          return <div key={`sep-${entryIndex}`} role="separator" className="adp-ctxmenu-separator" />;
        }
        if (entry.type === "iconRow") {
          return (
            <div key={`row-${entryIndex}`} role="group" className="adp-ctxmenu-iconrow">
              {entry.ids.map((id) => {
                focusIndex += 1;
                return renderCommand(id, focusIndex, true);
              })}
            </div>
          );
        }
        focusIndex += 1;
        if (entry.type === "command") return renderCommand(entry.id, focusIndex, false);
        const index = focusIndex;
        const SubIcon = entry.icon;
        return (
          <div
            key={`sub-${entry.id}`}
            id={itemId(index)}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={sub?.index === index}
            className={`adp-ctxmenu-item${index === active ? " adp-ctxmenu-item--active" : ""}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => openSubmenu(index, false)}
          >
            <span className="adp-ctxmenu-icon" aria-hidden="true">
              {SubIcon ? <SubIcon size={16} /> : null}
            </span>
            <span className="adp-ctxmenu-label">{t(entry.labelKey)}</span>
            <ChevronRight size={14} aria-hidden="true" className="adp-ctxmenu-shortcut" />
          </div>
        );
      })}
      {sub && focusables[sub.index]?.entry.type === "submenu" ? (
        <Menu
          nested
          entries={(focusables[sub.index].entry as Extract<MenuEntry, { type: "submenu" }>).entries}
          ctx={ctx}
          lookup={lookup}
          anchor={sub.anchor}
          focusFirst={sub.focusFirst}
          onRun={props.onRun}
          onClose={closeSub}
          ariaLabel={focusables[sub.index].label}
        />
      ) : null}
    </div>
  );
}
