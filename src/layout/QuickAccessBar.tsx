import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useAccessibilityOptional } from "../accessibility/AccessibilityContext";
import { commandLabelKey, isCommandEnabled, isCommandPresented, type Command } from "../commands/registry";
import {
  entryExecutable,
  QUICK_ACCESS_BAR_ID,
  type CommandLayoutRegistry,
  type ToolbarCustomSettings,
} from "../services/commandLayout";
import { ToolbarLayoutContext, tooltipPlacement } from "./toolbarLayout";

export interface QuickAccessBarProps<C> {
  settings: ToolbarCustomSettings;
  registry: CommandLayoutRegistry;
  commands: readonly Command<C>[];
  ctx: C;
}

/** The Quick Access bar (Step 10b D2): at most 20 registered commands.
 * Unknown ids show as unavailable and never run; hidden commands stay in
 * the command palette, only this bar is customized. */
export default function QuickAccessBar<C>({ settings, registry, commands, ctx }: QuickAccessBarProps<C>) {
  const { t } = useTranslation();
  const simpleMode = useAccessibilityOptional()?.settings.simple_mode ?? false;
  const layout = useContext(ToolbarLayoutContext);
  const byId = new Map(commands.map((command) => [command.id, command]));
  const commandIds = new Set(byId.keys());
  const entries = registry.resolve(QUICK_ACCESS_BAR_ID, settings).slice(0, 20);

  return (
    <div
      className="adp-quick-access"
      role="toolbar"
      aria-label={t("toolbarCustom.quick")}
      data-tooltip-placement={tooltipPlacement(layout)}
    >
      {entries.map((entry) => {
        if (entry.kind === "separator") {
          return <span key={entry.id} className="adp-quick-access-sep" aria-hidden="true" />;
        }
        const command = entry.kind === "command" ? byId.get(entry.id) : undefined;
        const known = entryExecutable(entry, commandIds, new Set());
        if (!command || !known) {
          return (
            <button key={entry.id} type="button" className="adp-quick-access-btn" disabled aria-label={t("toolbarCustom.missing")}>
              {t("toolbarCustom.missing")}
            </button>
          );
        }
        if (!isCommandPresented(command, ctx, simpleMode)) return null;
        const Icon = command.icon;
        const label = t(commandLabelKey(command, ctx));
        return (
          <button
            key={entry.id}
            type="button"
            className="adp-quick-access-btn"
            aria-label={label}
            title={label}
            disabled={!isCommandEnabled(command, ctx)}
            onClick={() => {
              if (isCommandEnabled(command, ctx)) command.run(ctx);
            }}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
