/** A toolbar docked on the side the layout chooses (Step 05c). The bar and
 * the content always keep their two child positions, so changing the side
 * never remounts what is inside. */
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { createLayoutCommands, type LayoutCommandContext } from "../commands/layoutCommands";
import { TOOLBAR_MENU, resolveMenu } from "../commands/menus";
import { isCommandEnabled } from "../commands/registry";
import Menu from "../components/Menu";
import { KeyTipsContext } from "../ribbon/keyTips";
import { useLayout } from "./LayoutContext";
import { ToolbarLayoutContext, toolbarLayoutFor } from "./toolbarLayout";

export interface ToolbarDockProps {
  /** The toolbar that moves: the command bar or a tab's ribbon. */
  toolbar: ReactNode;
  children: ReactNode;
  /** Extra classes for the content area. */
  contentClassName?: string;
}

/** How long the auto-hide line waits after the pointer leaves. */
const HIDE_DELAY_MS = 400;

export default function ToolbarDock({ toolbar, children, contentClassName }: ToolbarDockProps) {
  const { t } = useTranslation();
  const { layout, onLayoutChange } = useLayout();
  const side = layout.toolbar_position;
  const autoHide = layout.toolbar_mode === "autoHide";
  const toolbarLayout = useMemo(
    () => toolbarLayoutFor(side, layout.toolbar_mode),
    [side, layout.toolbar_mode],
  );
  const keyTips = useContext(KeyTipsContext);
  const [hover, setHover] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  const revealed = !autoHide || hover || focusInside || keyTips || menuAt !== null;

  const clearHideTimer = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  // A tab that closes while the pointer is away leaves no timer behind.
  useEffect(() => clearHideTimer, []);

  const onMouseEnter = () => {
    clearHideTimer();
    setHover(true);
  };

  const onMouseLeave = () => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setHover(false);
    }, HIDE_DELAY_MS);
  };

  const onFocus = () => setFocusInside(true);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && barRef.current?.contains(next)) return;
    setFocusInside(false);
  };

  // Text fields inside a toolbar keep their own menu (P-05).
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest("input, select, textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };

  const commands = useMemo(() => createLayoutCommands({ setLayout: onLayoutChange }), [onLayoutChange]);
  const lookup = useMemo(() => (id: string) => commands.find((command) => command.id === id), [commands]);
  const context: LayoutCommandContext = { layout };

  const classes = ["adp-dock", `adp-dock--${side}`];
  if (autoHide) classes.push("adp-dock--autohide");

  return (
    <div className={classes.join(" ")}>
      <div
        ref={barRef}
        className={`adp-dock-bar${autoHide && revealed ? " adp-dock-bar--revealed" : ""}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onContextMenu={onContextMenu}
      >
        <ToolbarLayoutContext.Provider value={toolbarLayout}>{toolbar}</ToolbarLayoutContext.Provider>
      </div>
      <div className={`adp-dock-content${contentClassName ? ` ${contentClassName}` : ""}`}>{children}</div>
      {menuAt ? (
        <Menu
          entries={resolveMenu(TOOLBAR_MENU, context, lookup)}
          ctx={context}
          lookup={lookup}
          anchor={{ kind: "point", x: menuAt.x, y: menuAt.y }}
          ariaLabel={t("layout.menuLabel")}
          onRun={(command) => {
            if (isCommandEnabled(command, context)) command.run(context);
          }}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </div>
  );
}
