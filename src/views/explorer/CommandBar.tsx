import { ChevronDown, ChevronRight, CircleAlert, Ellipsis } from "lucide-react";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import Menu, { type MenuAnchor } from "../../components/Menu";
import Tooltip from "../../components/Tooltip";
import { useAccessibilityOptional } from "../../accessibility/AccessibilityContext";
import { resolveMenu, type BarEntry, type MenuEntry } from "../../commands/menus";
import { commandLabelKey, isCommandEnabled, isCommandPresented, type Command, type CommandContext } from "../../commands/registry";
import { resolveShortcutText, useShortcutResolutionHost } from "../../keyboard/shortcutDisplay";
import { ToolbarLayoutContext, barLabelVisible, tooltipPlacement } from "../../layout/toolbarLayout";
import type { CommandLayoutEntry } from "../../services/commandLayout";
import { formatShortcut } from "../../services/shortcuts";

export interface CommandBarProps {
  entries: BarEntry[];
  ctx: CommandContext;
  lookup: (id: string) => Command | undefined;
  onRun: (command: Command) => void;
  onOpenHelp: () => void;
  /** The saved `explorer.command` layout. Omitted keeps the definition order
   * exactly (the defaults); when present it supplies the order and hiding of
   * each fixed command section, while menus, overflow and the spacer keep
   * their places. */
  layout?: readonly CommandLayoutEntry[];
}

/** Apply the saved `explorer.command` layout to the bar's command slots.
 * Menus, separators, overflow and the spacer are fixed anchors, so commands
 * stay in the section they were defined in; inside a section the saved order
 * and hiding apply, and an unknown id stays so the bar can draw it as
 * unavailable. No command is ever drawn twice. */
function withCommandLayout(entries: readonly BarEntry[], layout: readonly CommandLayoutEntry[]): BarEntry[] {
  const showLabel = new Map<string, boolean | undefined>();
  const slotRun = new Map<number, number>();
  const runs: string[][] = [];
  let run: string[] | null = null;
  entries.forEach((entry, index) => {
    if (entry.type !== "command") {
      run = null;
      return;
    }
    const current = run ?? [];
    if (run === null) {
      run = current;
      runs.push(current);
    }
    current.push(entry.id);
    slotRun.set(index, runs.length - 1);
    showLabel.set(entry.id, entry.showLabel);
  });
  const home = new Map<string, number>();
  runs.forEach((ids, runIndex) => {
    for (const id of ids) home.set(id, runIndex);
  });
  const assignments: BarEntry[][] = runs.map(() => []);
  const seen = new Set<string>();
  for (const entry of layout) {
    if (!entry.visible || entry.kind !== "command") continue;
    const key = `command:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A command added by hand (not in the definition) joins the first
    // section; there is no default place for it.
    const command: BarEntry = { type: "command", id: entry.id, showLabel: showLabel.get(entry.id) };
    assignments[home.get(entry.id) ?? 0]?.push(command);
  }
  const result: BarEntry[] = [];
  let emitted = -1;
  entries.forEach((entry, index) => {
    if (entry.type === "command") {
      const runIndex = slotRun.get(index) ?? 0;
      if (runIndex !== emitted) {
        emitted = runIndex;
        result.push(...assignments[runIndex]);
      }
      return;
    }
    emitted = -1;
    result.push(entry);
  });
  // An emptied section can leave two separators side by side or a separator
  // at an edge; the bar never draws those.
  const cleaned: BarEntry[] = [];
  for (const entry of result) {
    if (entry.type === "separator" && (cleaned.length === 0 || cleaned[cleaned.length - 1].type === "separator")) {
      continue;
    }
    cleaned.push(entry);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].type === "separator") cleaned.pop();
  return cleaned;
}

interface OpenMenu {
  key: string;
  entries: MenuEntry[];
  anchor: MenuAnchor;
  label: string;
  focusFirst: boolean;
}

/** The Explorer command bar (Figma order) built from command data. When
 * the window is narrow, entries from the right end of the main group
 * move into the "See more" menu. */
export default function CommandBar(props: CommandBarProps) {
  const { t, i18n } = useTranslation();
  const simpleMode = useAccessibilityOptional()?.settings.simple_mode ?? false;
  const shortcutHost = useShortcutResolutionHost();
  const barRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const [hiddenFrom, setHiddenFrom] = useState(Number.POSITIVE_INFINITY);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const { ctx, lookup, onRun } = props;
  // Where and how the bar is drawn (Step 05c); today's look without a provider.
  const toolbar = useContext(ToolbarLayoutContext);
  const vertical = toolbar.orientation === "vertical";
  const entries = useMemo(
    () => (props.layout ? withCommandLayout(props.entries, props.layout) : props.entries),
    [props.entries, props.layout],
  );

  const overflowIndex = entries.findIndex((entry) => entry.type === "overflow");
  const collapsible = overflowIndex === -1 ? entries.length : overflowIndex;

  // Re-measure every entry when the language, the side, the style or the
  // saved layout changes (labels change width, a column measures heights).
  useLayoutEffect(() => {
    setHiddenFrom(Number.POSITIVE_INFINITY);
    widths.current = [];
  }, [i18n.language, toolbar.orientation, toolbar.mode, props.layout]);

  const fit = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const inColumn = toolbar.orientation === "vertical";
    if (widths.current.length === 0) {
      widths.current = itemRefs.current.map((element) => {
        if (!element) return 0;
        const rect = element.getBoundingClientRect();
        return (inColumn ? rect.height : rect.width) + 4;
      });
    }
    const fixed = widths.current.slice(collapsible).reduce((sum, width) => sum + width, 0) + 80;
    let used = fixed;
    let next = Number.POSITIVE_INFINITY;
    const available = inColumn ? bar.clientHeight : bar.clientWidth;
    for (let index = 0; index < collapsible; index += 1) {
      used += widths.current[index] ?? 0;
      if (used > available) {
        next = index;
        break;
      }
    }
    setHiddenFrom((current) => (current === next ? current : next));
  }, [collapsible, toolbar.orientation]);

  useLayoutEffect(() => {
    if (hiddenFrom === Number.POSITIVE_INFINITY && widths.current.length === 0) fit();
  });

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(bar);
    return () => observer.disconnect();
  }, [fit]);

  const closeMenu = useCallback(() => setMenu(null), []);

  // A bar on a side opens its menus beside the button; `place` flips them
  // left near the right edge.
  const anchorFor = (element: HTMLElement): MenuAnchor => {
    const rect = element.getBoundingClientRect();
    return {
      kind: vertical ? "side" : "below",
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  };

  const toggleMenu = (key: string, element: HTMLElement, entries: MenuEntry[], label: string, focusFirst: boolean) => {
    if (menu?.key === key) {
      setMenu(null);
      return;
    }
    setMenu({ key, entries: resolveMenu(entries, ctx, lookup, simpleMode), anchor: anchorFor(element), label, focusFirst });
  };

  const overflowed: MenuEntry[] = [];
  entries.slice(0, collapsible).forEach((entry, index) => {
    if (index < hiddenFrom) return;
    if (entry.type === "command") overflowed.push({ type: "command", id: entry.id });
    else if (entry.type === "menu") overflowed.push({ type: "submenu", id: entry.id, labelKey: entry.labelKey, icon: entry.icon, entries: entry.entries });
    else if (entry.type === "separator") overflowed.push({ type: "separator" });
  });

  const barClasses = ["adp-commandbar"];
  if (vertical) barClasses.push("adp-commandbar--vertical");
  if (toolbar.mode === "compact") barClasses.push("adp-commandbar--compact");
  if (toolbar.mode === "iconsOnly") barClasses.push("adp-commandbar--icons");
  const placement = tooltipPlacement(toolbar);

  return (
    <div
      ref={barRef}
      className={barClasses.join(" ")}
      role="toolbar"
      aria-label={t("explorer.commandBar")}
      aria-orientation={vertical ? "vertical" : undefined}
    >
      {entries.map((entry, index) => {
        const hidden = index < collapsible && index >= hiddenFrom;
        const setRef = (element: HTMLElement | null) => {
          itemRefs.current[index] = element;
        };
        const style = hidden ? { display: "none" } : undefined;
        if (entry.type === "separator") {
          return <span key={`sep-${index}`} ref={setRef} style={style} className="adp-cmd-sep" aria-hidden="true" />;
        }
        if (entry.type === "spacer") {
          return <span key={`spacer-${index}`} ref={setRef} className="adp-cmd-spacer" />;
        }
        if (entry.type === "menu") {
          const label = t(entry.labelKey);
          const Icon = entry.icon;
          const key = `menu-${entry.id}`;
          const showLabel = barLabelVisible(toolbar, "menu");
          return (
            <span key={key} ref={setRef} style={style} className="adp-cmd-wrap">
              <Tooltip label={label} placement={placement}>
                <button
                  type="button"
                  className="adp-cmd-text"
                  aria-label={label}
                  aria-haspopup="menu"
                  aria-expanded={menu?.key === key}
                  onClick={(event) => toggleMenu(key, event.currentTarget, entry.entries, label, event.detail === 0)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {showLabel ? <span>{label}</span> : null}
                  {vertical ? (
                    showLabel ? <ChevronRight size={11} aria-hidden="true" /> : null
                  ) : (
                    <ChevronDown size={11} aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
            </span>
          );
        }
        if (entry.type === "overflow") {
          const label = t("commands.more");
          const key = "overflow";
          const showLabel = barLabelVisible(toolbar, "overflow");
          const entries: MenuEntry[] = overflowed.length > 0 ? [...overflowed, { type: "separator" }, ...entry.entries] : entry.entries;
          return (
            <span key={key} ref={setRef} className="adp-cmd-wrap">
              <Tooltip label={label} placement={placement}>
                <button
                  type="button"
                  className={showLabel ? "adp-cmd-text" : "adp-cmd-icon"}
                  aria-label={label}
                  aria-haspopup="menu"
                  aria-expanded={menu?.key === key}
                  onClick={(event) => toggleMenu(key, event.currentTarget, entries, label, event.detail === 0)}
                >
                  <Ellipsis size={16} aria-hidden="true" />
                  {showLabel ? <span>{label}</span> : null}
                </button>
              </Tooltip>
            </span>
          );
        }
        const command = lookup(entry.id);
        // A saved layout can name a command this build no longer registers.
        // It stays visible as unavailable until the user removes it.
        if (!command) {
          const missing = t("toolbarCustom.missing");
          const showLabel = entry.showLabel
            ? barLabelVisible(toolbar, "labeledCommand")
            : barLabelVisible(toolbar, "command");
          return (
            <span key={`missing-${entry.id}-${index}`} ref={setRef} style={style} className="adp-cmd-wrap">
              <Tooltip label={missing} placement={placement}>
                <button
                  type="button"
                  className={showLabel ? "adp-cmd-text" : "adp-cmd-icon"}
                  aria-label={missing}
                  disabled
                >
                  <CircleAlert size={16} aria-hidden="true" />
                  {showLabel ? <span>{missing}</span> : null}
                </button>
              </Tooltip>
            </span>
          );
        }
        // Commands can hide themselves (for example "Extract all" outside archives).
        if (!isCommandPresented(command, ctx, simpleMode)) return null;
        const label = t(commandLabelKey(command, ctx));
        const enabled = isCommandEnabled(command, ctx);
        const tooltip = command.pending ? t("commands.comingLater", { label }) : label;
        const shortcutText = resolveShortcutText(shortcutHost, command.id, command.shortcut);
        const Icon = command.icon;
        const pressed = command.checkKind === "toggle" ? Boolean(command.checkedWhen?.(ctx)) : undefined;
        const text = entry.showLabel ? t("commands.details") : label;
        const showLabel = entry.showLabel
          ? barLabelVisible(toolbar, "labeledCommand")
          : barLabelVisible(toolbar, "command");
        return (
          <span key={entry.id} ref={setRef} style={style} className="adp-cmd-wrap">
            <Tooltip label={tooltip} shortcut={shortcutText ? formatShortcut(shortcutText, t) : undefined} placement={placement}>
              <button
                type="button"
                className={`${showLabel ? "adp-cmd-text" : "adp-cmd-icon"}${pressed ? " adp-cmd--pressed" : ""}`}
                aria-label={label}
                aria-pressed={pressed}
                aria-disabled={!enabled}
                onClick={() => {
                  if (enabled) onRun(command);
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {showLabel ? <span>{text}</span> : null}
              </button>
            </Tooltip>
          </span>
        );
      })}
      <HelpButton onOpenHelp={props.onOpenHelp} />
      {menu ? (
        <Menu
          entries={menu.entries}
          ctx={ctx}
          lookup={lookup}
          anchor={menu.anchor}
          focusFirst={menu.focusFirst}
          ariaLabel={menu.label}
          onRun={onRun}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
