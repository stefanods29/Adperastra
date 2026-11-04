import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRubberBand } from "../views/explorer/views/useRubberBand";

let root: Root | null = null, container: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = null; container = null; vi.unstubAllGlobals(); });
function Surface({ change }: { change: (ids: string[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { overlayRect, ...handlers } = useRubberBand({ rootRef: ref, enabled: true, selection: ["b"], onSelectionChange: change,
    layoutRects: () => [{ id: "a", x: 0, y: 0, width: 20, height: 20 }, { id: "b", x: 40, y: 40, width: 20, height: 20 }] });
  return <div ref={ref} {...handlers} data-band={!!overlayRect} tabIndex={0} />;
}
async function setup() {
  const change = vi.fn(); const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7)); vi.stubGlobal("cancelAnimationFrame", cancel);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root?.render(<Surface change={change} />));
  const surface = container.firstElementChild as HTMLElement;
  surface.setPointerCapture = vi.fn(); surface.hasPointerCapture = () => true; surface.releasePointerCapture = vi.fn();
  Object.defineProperties(surface, { clientWidth: { value: 200 }, clientHeight: { value: 200 } });
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
  return { surface, change, cancel };
}
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } }); return event;
}
describe("rubber band lifetime", () => {
  it("Esc restores", async () => {
    const { surface, change } = await setup();
    await act(async () => { surface.dispatchEvent(pointer("pointerdown", 0, 0)); surface.dispatchEvent(pointer("pointermove", 22, 22)); });
    expect(change).toHaveBeenLastCalledWith(["a"]);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
    expect(change).toHaveBeenLastCalledWith(["b"]); expect(surface.dataset.band).toBe("false");
  });
  it("blur stops RAF", async () => {
    const { surface, cancel } = await setup();
    await act(async () => surface.dispatchEvent(pointer("pointerdown", 0, 0)));
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(cancel).toHaveBeenCalledWith(7); expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it("pointer cancel restores captured selection", async () => {
    const { surface, change } = await setup();
    await act(async () => { surface.dispatchEvent(pointer("pointerdown", 0, 0)); surface.dispatchEvent(pointer("pointermove", 22, 22)); surface.dispatchEvent(pointer("pointercancel", 22, 22)); });
    expect(change).toHaveBeenLastCalledWith(["b"]);
  });
});
