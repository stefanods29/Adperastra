import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import ExplorerHome from "../views/ExplorerHome";

/** Step 04a: the Explorer stays mounted behind file tabs. While hidden it
 * must ignore window shortcuts, or Delete in another tab would act on the
 * Explorer's selection. Alt+Shift+P (Details pane) shows the gate. */
describe("Explorer behind another tab", () => {
  const pressDetailsShortcut = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "P", altKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  it("ignores shortcuts while hidden and handles them again when shown", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onViewChange = vi.fn();
    await act(async () => {
      root.render(<ExplorerHome active={false} onOpenHelp={() => undefined} onViewChange={onViewChange} />);
    });
    await act(async () => pressDetailsShortcut());
    expect(onViewChange).not.toHaveBeenCalled();
    await act(async () => {
      root.render(<ExplorerHome active={true} onOpenHelp={() => undefined} onViewChange={onViewChange} />);
    });
    await act(async () => pressDetailsShortcut());
    expect(onViewChange).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    container.remove();
  });
});
