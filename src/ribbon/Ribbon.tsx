import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import KeyTip from "../components/KeyTip";
import { commandLabelKey, isCommandEnabled, isCommandVisible, type Command } from "../commands/registry";
import type { HandlerAccent } from "../handlers/types";
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
 * tips; Alt+letter picks a tab or runs a control. */
export default function Ribbon<C>({ def, ctx, commands, accent, active }: RibbonProps<C>) {
  const { t } = useTranslation();
  const showKeyTips = useContext(KeyTipsContext);
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

  const renderControl = (control: RibbonControl) => {
    if (control.type === "custom") {
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
        {control.showLabel === false ? null : <span>{label}</span>}
        {control.keyTip ? <KeyTip letter={control.keyTip} visible={showKeyTips && active} /> : null}
      </button>
    );
  };

  return (
    <div className="adp-ribbon" style={{ ["--adp-ribbon-accent" as string]: `var(--adp-accent-${accent})` }}>
      {def.tabs.length > 1 ? (
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
      ) : null}
      <div className="adp-ribbon-body" role="toolbar" aria-label={t(tab.labelKey)}>
        {tab.groups.map((group, index) => (
          <div key={group.id} className="adp-ribbon-group" role="group" aria-label={t(group.labelKey)}>
            {index > 0 ? <span className="adp-ribbon-sep" aria-hidden="true" /> : null}
            {group.controls.map(renderControl)}
          </div>
        ))}
      </div>
    </div>
  );
}
