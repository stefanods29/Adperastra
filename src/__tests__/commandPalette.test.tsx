import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Search } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { CommandRegistry, type CommandContext } from "../commands/registry";
import { CommandPalette } from "../palette/CommandPalette";
import { commandPaletteProvider } from "../palette/paletteEntries";
import { PaletteRegistry } from "../palette/PaletteRegistry";
import type { PaletteEntry, PaletteHost } from "../palette/types";
import { usePaletteCatalog } from "../palette/usePaletteCatalog";
import { useCommandShortcuts } from "../ribbon/shortcuts";

vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: (options: { count: number }) => ({
  getTotalSize: () => options.count * 40, getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 40, key: index })), scrollToIndex: vi.fn(),
}) }));
let root: Root | null = null, container: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = null; container = null; });
async function mount(node: React.ReactNode) {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root?.render(node));
}
const context: CommandContext = {
  location: "folder", currentPath: "C:\\A", canGoBack: true, canGoForward: false, selectedPath: null, selectedKind: null, currentPinned: false,
  selection: { paths: [], count: 0, files: 0, folders: 0 }, allFavorites: false, selectionInCurrentFolder: false, canUndo: false, canRedo: false,
  view: { showHidden: false, showExtensions: true, itemCheckboxes: false, detailsPane: false, groupBy: "none", sortKey: "name", sortDirection: "ascending", viewMode: "details", hiddenViewModes: [] },
};
const makeHost = (): PaletteHost => ({ commandContext: () => context, dispatchCommand: vi.fn(), openFolder: vi.fn(async () => undefined), openFile: vi.fn(async () => undefined), activateTab: vi.fn(), openSavedGroup: vi.fn(async () => undefined), openSettings: vi.fn(), openHelp: vi.fn() });
const entry = (enabled = true): PaletteEntry => ({ id: "command:open", kind: "command", english_label: "Open", keywords: [], enabled, target_id: "open" });
async function enter() { await act(async () => container!.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); }
describe("command palette", () => {
  it("disabled Enter does nothing", async () => {
    const registry = new PaletteRegistry(), dispatch = vi.fn(async () => undefined), used = vi.fn();
    registry.registerProvider("test", { snapshot: async () => [entry(false)], dispatch });
    await mount(<CommandPalette registry={registry} host={makeHost()} locale="en" recentIds={["command:open"]} onUsed={used} onClose={vi.fn()} onOpenHelp={vi.fn()} />);
    await enter(); expect(dispatch).not.toHaveBeenCalled(); expect(used).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="option"]')!.getAttribute("aria-disabled")).toBe("true");
  });
  it("enablement rechecked", async () => {
    const commands = new CommandRegistry(), host = makeHost();
    let enabled = true;
    commands.register({ id: "open", labelKey: "commands.open", icon: Search, risk: "read-only", helpSlug: "opening-files", enabledWhen: () => enabled, run: vi.fn() });
    const registry = new PaletteRegistry(); registry.registerProvider("commands", commandPaletteProvider(commands, host, () => "Open"));
    const used = vi.fn();
    await mount(<CommandPalette registry={registry} host={host} locale="en" recentIds={["command:open"]} onUsed={used} onClose={vi.fn()} onOpenHelp={vi.fn()} />);
    enabled = false; await enter(); expect(host.dispatchCommand).not.toHaveBeenCalled(); expect(used).not.toHaveBeenCalled();
  });
  it("MRU only after dispatch", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const registry = new PaletteRegistry(), used = vi.fn();
    registry.registerProvider("test", { snapshot: async () => [entry()], dispatch: () => pending });
    await mount(<CommandPalette registry={registry} host={makeHost()} locale="en" recentIds={["command:open"]} onUsed={used} onClose={vi.fn()} onOpenHelp={vi.fn()} />);
    await enter(); expect(used).not.toHaveBeenCalled();
    await act(async () => finish()); expect(used).toHaveBeenCalledWith("command:open");
  });
  it("failed dispatch never enters MRU", async () => {
    const registry = new PaletteRegistry(), used = vi.fn();
    registry.registerProvider("test", { snapshot: async () => [entry()], dispatch: async () => { throw new Error("palette.unavailable"); } });
    await mount(<CommandPalette registry={registry} host={makeHost()} locale="en" recentIds={["command:open"]} onUsed={used} onClose={vi.fn()} onOpenHelp={vi.fn()} />);
    await enter(); expect(used).not.toHaveBeenCalled(); expect(container!.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("Esc focus", async () => {
    const registry = new PaletteRegistry();
    function Parent() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open</button>{open ? <CommandPalette registry={registry} host={makeHost()} locale="en" recentIds={[]} onUsed={vi.fn()} onClose={() => setOpen(false)} onOpenHelp={vi.fn()} /> : null}</>;
    }
    await mount(<Parent />);
    const button = container!.querySelector("button")!; button.focus();
    await act(async () => button.click());
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container!.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(button);
  });
  it("Ctrl K once", async () => {
    const registry = new PaletteRegistry(), opened = vi.fn();
    function Parent() {
      const [open, setOpen] = useState(false);
      useCommandShortcuts([{ id: "app.commandPalette", labelKey: "palette.title", icon: Search, risk: "read-only", shortcut: "Ctrl+K", helpSlug: "command-palette", enabledWhen: () => true, run: () => { opened(); setOpen(true); } }], context, true);
      return open ? <CommandPalette registry={registry} host={makeHost()} locale="en" recentIds={[]} onUsed={vi.fn()} onClose={() => setOpen(false)} onOpenHelp={vi.fn()} /> : null;
    }
    await mount(<Parent />);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true, bubbles: true })));
    expect(opened).toHaveBeenCalledTimes(1); expect(container!.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it("stale async generation discarded", async () => {
    let first!: (entries: PaletteEntry[]) => void;
    const a = new PaletteRegistry(), b = new PaletteRegistry();
    a.registerProvider("a", { snapshot: () => new Promise((resolve) => { first = resolve; }), dispatch: async () => undefined });
    b.registerProvider("b", { snapshot: async () => [{ ...entry(), id: "command:new" }], dispatch: async () => undefined });
    function Catalog({ registry }: { registry: PaletteRegistry }) { const value = usePaletteCatalog(registry, "en"); return <div>{value.entries.map((item) => item.id).join(",")}</div>; }
    await mount(<Catalog registry={a} />);
    await act(async () => root!.render(<Catalog registry={b} />));
    await act(async () => first([entry()]));
    expect(container!.textContent).toBe("command:new");
  });
});
