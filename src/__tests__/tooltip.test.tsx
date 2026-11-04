import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tooltip from "../components/Tooltip";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // Only the tooltip's own delay is fake; React's work stays on real timers.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

const LABEL = "Copy";

async function openBeside(placement: "right" | "left") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <Tooltip label={LABEL} placement={placement}>
        <button type="button">{LABEL}</button>
      </Tooltip>,
    );
  });
  const wrap = container.querySelector(".adp-tooltip-wrap");
  expect(wrap).not.toBeNull();
  await act(async () => {
    wrap!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  return container.querySelector("[role='tooltip']");
}

describe("tooltips", () => {
  it("tooltips can open beside the button", async () => {
    const right = await openBeside("right");
    expect(right).not.toBeNull();
    expect(right!.classList.contains("adp-tooltip--right")).toBe(true);
    if (root) await act(async () => root?.unmount());
    container?.remove();
    const left = await openBeside("left");
    expect(left).not.toBeNull();
    expect(left!.classList.contains("adp-tooltip--left")).toBe(true);
  });
});
