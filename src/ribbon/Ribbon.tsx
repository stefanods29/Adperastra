import { Ellipsis, Layers } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DropdownMenu from "../components/DropdownMenu";
import KeyTip from "../components/KeyTip";
import { commandLabelKey, isCommandEnabled, isCommandVisible, type Command } from "../commands/registry";
import type { HandlerAccent } from "../handlers/types";
import Flyout from "../layout/Flyout";
import { ToolbarLayoutContext, ribbonLabelVisible } from "../layout/toolbarLayout";
import { formatShortcut } from "../services/shortcuts";
import { KeyTipsContext } from "./keyTips";
import type { RibbonControl, RibbonDef } from "./types";

export interface RibbonProps<C> {
  def: RibbonDef;
  ctx: C;
  commands: readonly Command<C>[];
  accent: HandlerAccent;
  /** Only the visible tab's ribbon answers Alt+letter key tips. */
  active: boolean;
}

/** One ribbon (Step 04b): a tab row (only when there is more than one tab)
 * and one row of grouped controls, built from commands. Alt shows key
 * tips; Alt+letter picks a tab or runs a control. Step 05c draws it on any
 * side and in any style. */
export default function Ribbon<C>({ def, ctx, commands, accent, active }: RibbonProps<C>) {
  const { t } = useTranslation();
  const showKeyTips = useContext(KeyTipsContext);
  // Where and how the ribbon is drawn (Step 05c); today's look without a provider.
  const toolbar = useContext(ToolbarLayoutContext);
  const vertical = toolbar.orientation === "vertical";
  const iconsOnly = toolbar.mode === "iconsOnly";
  const compact = toolbar.mode === "compact";
  const [tabId, setTabId] = useState(def.tabs[0]?.id ?? "");
  const tab = def.tabs.find((entry) => entry.id === tabId) ?? def.tabs[0];
  const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  const live = useRef({ ctx, tab, byId, def });
  live.current = { ctx, tab, byId, def };

  // Alt+letter: a tab's key tip selects it; a control's key tip runs it.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
      const letter = event.key.toUpperCase();
      const current = live.current;
      const targetTab = current.def.tabs.find((entry) => entry.keyTip === letter);
      if (targetTab && current.def.tabs.length > 1) {
        event.preventDefault();
        setTabId(targetTab.id);
        return;
      }
      for (const group of current.tab?.groups ?? []) {
        for (const control of group.controls) {
          if (control.type === "custom" || control.keyTip !== letter) continue;
          const command = current.byId.get(control.command);
          if (!command) continue;
          event.preventDefault();
          if (isCommandEnabled(command, current.ctx)) command.run(current.ctx);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!tab) return null;

  // In a column with icons only, lists (a zoom box, an encoding list) move
  // into one More options panel at the end.
  const movesCustom = vertical && iconsOnly;

  const renderControl = (control: RibbonControl) => {
    if (control.type === "custom") {
      if (movesCustom) return null;
      return (
        <span key={control.id} className="adp-ribbon-custom">
          {control.render()}
        </span>
      );
    }
    const command = byId.get(control.command);
    if (!command || !isCommandVisible(command, ctx)) return null;
    const Icon = command.icon;
    const label = t(commandLabelKey(command, ctx));
    const pressed = control.type === "toggle" ? Boolean(command.checkedWhen?.(ctx)) : undefined;
    const tooltip = command.shortcut ? `${label} (${formatShortcut(command.shortcut, t)})` : label;
    return (
      <button
        key={control.command}
        type="button"
        className={pressed ? "adp-ribbon-btn adp-ribbon-btn--pressed" : "adp-ribbon-btn"}
        aria-label={label}
        aria-pressed={pressed}
        title={tooltip}
        disabled={!isCommandEnabled(command, ctx)}
        onClick={() => {
          if (isCommandEnabled(command, ctx)) command.run(ctx);
        }}
      >
        <Icon size={16} aria-hidden="true" />
        {ribbonLabelVisible(toolbar, control.showLabel) ? <span>{label}</span> : null}
        {control.keyTip ? <KeyTip letter={control.keyTip} visible={showKeyTips && active} /> : null}
      </button>
    );
  };

  // A group whose controls are all hidden (Parts for a small file) is left out.
  const isShown = (control: RibbonControl) => {
    if (control.type === "custom") return true;
    const command = byId.get(control.command);
    return command !== undefined && isCommandVisible(command, ctx);
  };

  // In the icons-only column a group of lists alone has nothing to draw.
  const groupShown = (group: (typeof tab.groups)[number]) => {
    const shown = group.controls.filter(isShown);
    if (shown.length === 0) return false;
    if (movesCustom && shown.every((control) => control.type === "custom")) return false;
    return true;
  };

  const customControls = movesCustom
    ? tab.groups.flatMap((group) => group.controls.filter((control) => control.type === "custom"))
    : [];

  const classes = ["adp-ribbon"];
  if (vertical) classes.push("adp-ribbon--vertical");
  if (compact) classes.push("adp-ribbon--compact");
  if (iconsOnly) classes.push("adp-ribbon--icons");
  const multiTab = def.tabs.length >= 2;

  return (
    <div className={classes.join(" ")} style={{ ["--adp-ribbon-accent" as string]: `var(--adp-accent-${accent})` }}>
      {multiTab ? (
        vertical ? (
          <div className="adp-ribbon-tabpick">
            <DropdownMenu
              ariaLabel={t("ribbon.tabs")}
              label={iconsOnly ? undefined : t(tab.labelKey)}
              icon={iconsOnly ? Layers : undefined}
              items={def.tabs.map((entry) => ({ id: entry.id, label: t(entry.labelKey) }))}
              onSelect={(id) => setTabId(id)}
            />
          </div>
        ) : (
          <div className="adp-ribbon-tabs" role="tablist">
            {def.tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === tab.id}
                className={entry.id === tab.id ? "adp-ribbon-tab adp-ribbon-tab--active" : "adp-ribbon-tab"}
                onClick={() => setTabId(entry.id)}
              >
                {t(entry.labelKey)}
                <KeyTip letter={entry.keyTip} visible={showKeyTips && active} />
              </button>
            ))}
          </div>
        )
      ) : null}
      <div
        className="adp-ribbon-body"
        role="toolbar"
        aria-label={t(tab.labelKey)}
        aria-orientation={vertical ? "vertical" : undefined}
      >
        {tab.groups.filter(groupShown).map((group, index) => (
          <div key={group.id} className="adp-ribbon-group" role="group" aria-label={t(group.labelKey)}>
            {index > 0 ? <span className="adp-ribbon-sep" aria-hidden="true" /> : null}
            {group.controls.map(renderControl)}
          </div>
        ))}
        {customControls.length > 0 ? (
          <Flyout
            icon={Ellipsis}
            label={t("common.moreOptions")}
            opensTo={toolbar.side === "left" ? "right" : "left"}
          >
            {customControls.map((control) => (
              <span key={control.id} className="adp-ribbon-custom">
                {control.type === "custom" ? control.render() : null}
              </span>
            ))}
          </Flyout>
        ) : null}
      </div>
    </div>
  );
}
