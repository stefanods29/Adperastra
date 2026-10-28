import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { createExplorerCommands } from "../commands/explorerCommands";
import type { CommandContext } from "../commands/registry";
import AddressBar from "../views/explorer/AddressBar";

describe("AddressBar", () => {
  it("Ctrl+L switches the breadcrumb into path editing", async () => {
    const actions = {
      back: vi.fn(), forward: vi.fn(), up: vi.fn(), refresh: vi.fn(),
      openSelected: vi.fn(), goToPath: vi.fn(), togglePin: vi.fn(),
    };
    const commands = createExplorerCommands(actions);
    const byId = Object.fromEntries(commands.map((c) => [c.id, c]));
    const ctx: CommandContext = {
      location: "folder", currentPath: "C:\\Users", canGoBack: false, canGoForward: false,
      selectedPath: null, selectedKind: null, currentPinned: false,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AddressBar
          backCommand={byId["explorer.back"]}
          forwardCommand={byId["explorer.forward"]}
          upCommand={byId["explorer.up"]}
          refreshCommand={byId["explorer.refresh"]}
          commandCtx={ctx}
          onRun={(command, arg) => command.run(ctx, arg)}
          onNavigatePath={() => undefined}
          segments={[{ label: "C:\\", path: "C:\\" }, { label: "Users", path: "C:\\Users" }]}
          rootSiblings={[]}
          editablePath={"C:\\Users"}
          placeLabel="Users"
          historyEntries={[]}
          onHistory={() => undefined}
          search=""
          onSearch={() => undefined}
        />,
      );
    });
    expect(container.querySelector("input.adp-address-input")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true, bubbles: true }));
    });
    const input = container.querySelector<HTMLInputElement>("input.adp-address-input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("C:\\Users");
    await act(async () => root.unmount());
    container.remove();
  });
});