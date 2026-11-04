import { useTranslation } from "react-i18next";
import { useAccessibilityOptional } from "../accessibility/AccessibilityContext";
import DropdownMenu from "../components/DropdownMenu";
import { commandLabelKey, isCommandEnabled, isCommandPresented, type Command } from "../commands/registry";

export interface ClassicMenuGroup {
  id: string;
  /** Translation key of the menu name (File, Edit, View, Tools, Help). */
  labelKey: string;
  command_ids: readonly string[];
}

export interface ClassicMenuBarProps<C> {
  groups: readonly ClassicMenuGroup[];
  commands: readonly Command<C>[];
  ctx: C;
}

/** Classic menu mode (Step 10b D3): File/Edit/View/Tools/Help menus over
 * the same command registry — no second command implementation. The
 * coordinator supplies the groups from the existing menu data. */
export default function ClassicMenuBar<C>({ groups, commands, ctx }: ClassicMenuBarProps<C>) {
  const { t } = useTranslation();
  const simpleMode = useAccessibilityOptional()?.settings.simple_mode ?? false;
  const byId = new Map(commands.map((command) => [command.id, command]));

  return (
    <div className="adp-classic-menu" role="menubar" aria-label={t("toolbarCustom.classic")}>
      {groups.map((group) => {
        const items = group.command_ids
          .map((id) => byId.get(id))
          .filter((command): command is Command<C> => command !== undefined && isCommandPresented(command, ctx, simpleMode))
          .map((command) => ({
            id: command.id,
            label: t(commandLabelKey(command, ctx)),
            disabled: !isCommandEnabled(command, ctx),
          }));
        if (items.length === 0) return null;
        return (
          <DropdownMenu
            key={group.id}
            ariaLabel={t(group.labelKey)}
            label={t(group.labelKey)}
            items={items}
            onSelect={(id) => {
              const command = byId.get(id);
              if (command && isCommandEnabled(command, ctx)) command.run(ctx);
            }}
          />
        );
      })}
    </div>
  );
}
