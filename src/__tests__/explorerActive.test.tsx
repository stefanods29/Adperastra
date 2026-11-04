import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { KeyboardRouter } from "../keyboard/KeyboardRouter";
import type { KeyboardHost, KeyboardMap, ShortcutBinding } from "../keyboard/types";
import { isCommandEnabled, type Command } from "../commands/registry";
import ExplorerHome, { type ExplorerPaletteBridge } from "../views/ExplorerHome";

/** Step 04a: the Explorer stays mounted behind file tabs. While hidden it
 * must ignore window shortcuts, or Delete in another tab would act on the
 * Explorer's selection. Alt+Shift+P (Details pane) shows the gate.
 *
 * Step 10b moved shortcut matching into the one window router; the Explorer
 * now publishes scoped shortcuts through its palette bridge, and a hidden
 * Explorer publishes no scopes. This test drives that seam the same way the
 * App's coordinator does. */
describe("Explorer behind another tab", () => {
  const bindings: ShortcutBinding[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      command_id: "explorer.toggleDetailsPane",
      scope: "explorer",
      strokes: [{ ctrl: false, alt: true, shift: true, meta: false, mode: "key", key: "p" }],
      enabled: true,
    },
  ];
  const map: KeyboardMap = { id: "builtin:windows", name: "Windows", bindings, version: 1 };
  const pressDetailsShortcut = () =>
    new KeyboardEvent("keydown", { key: "P", altKey: true, shiftKey: true, bubbles: true, cancelable: true });

  function hostFor(current: () => ExplorerPaletteBridge | null): KeyboardHost {
    return {
      activeScopes: () => [...(current()?.shortcutScopes?.() ?? []), "global"],
      isTypingTarget: () => false,
      command: (id) => current()?.registry.get(id) as Command<unknown> | undefined,
      isEnabled: (id) => {
        const bridge = current();
        const command = bridge?.registry.get(id);
        return command ? isCommandEnabled(command, bridge!.commandContext()) : false;
      },
      dispatch: (id) => current()?.dispatchCommand(id),
      showDisabled: () => undefined,
      navigate: () => undefined,
      focusFilter: () => undefined,
      copyToFolder: async () => undefined,
      moveToFolder: async () => undefined,
    };
  }

  it("ignores shortcuts while hidden and handles them again when shown", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onViewChange = vi.fn();
    let bridge: ExplorerPaletteBridge | null = null;
    const router = new KeyboardRouter(hostFor(() => bridge));
    router.setMap(map);

    await act(async () => {
      root.render(
        <ExplorerHome
          active={false}
          onOpenHelp={() => undefined}
          onViewChange={onViewChange}
          onPaletteBridge={(_owner, next) => {
            bridge = next;
          }}
          paletteOwnerId="explorer"
        />,
      );
    });
    await act(async () => {
      router.handle(pressDetailsShortcut());
    });
    expect(onViewChange).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <ExplorerHome
          active={true}
          onOpenHelp={() => undefined}
          onViewChange={onViewChange}
          onPaletteBridge={(_owner, next) => {
            bridge = next;
          }}
          paletteOwnerId="explorer"
        />,
      );
    });
    await act(async () => {
      router.handle(pressDetailsShortcut());
    });
    expect(onViewChange).toHaveBeenCalledTimes(1);

    router.dispose();
    await act(async () => root.unmount());
    container.remove();
  });
});
