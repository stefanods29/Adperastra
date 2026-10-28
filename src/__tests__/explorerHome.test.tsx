import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import "../i18n";
import ExplorerHome from "../views/ExplorerHome";

describe("ExplorerHome", () => {
  it("renders the Home page content (quick access + recent/favorites)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ExplorerHome onOpenHelp={() => undefined} />);
    });
    // Regression: the Home blocks once vanished when the folder-content
    // block was extracted, leaving a blank Explorer.
    expect(container.textContent).toContain("Quick access");
    expect(container.textContent).toContain("Recent");
    expect(container.textContent).toContain("Favorites");
    expect(container.textContent).toContain("This PC");
    await act(async () => root.unmount());
    container.remove();
  });
});