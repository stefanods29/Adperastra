import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n";
import SafeMarkupFrame from "../components/SafeMarkupFrame";
import { safeMarkupHtml } from "./step07fFixtures";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("SafeMarkupFrame", () => {
  it("mounts an empty sandbox with no scripts or remote images", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SafeMarkupFrame
          html={safeMarkupHtml}
          resources={[]}
          title={String("Preview")}
        />,
      );
    });
    const frame = container.querySelector("iframe");
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame?.getAttribute("srcdoc")).not.toContain("https://");
    expect(frame?.getAttribute("srcdoc")).not.toContain("<script");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
});
