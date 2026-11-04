import { useEffect } from "react";
import { isTauriRuntime } from "../services/settings";
import { setTitlebarDragRect, type CaptionRect } from "../services/windowChrome";

/** Empty space after the final tab/+ control, clipped to the visible strip. */
export function titlebarCaptionRect(
  bounds: { left: number; top: number; right: number; bottom: number },
  childRightEdges: readonly number[],
  scale: number,
): CaptionRect | null {
  const left = Math.max(bounds.left, ...childRightEdges);
  const top = bounds.top + 2; // Keep the top resize edge available to Windows.
  if (bounds.right <= left || bounds.bottom <= top || !(scale > 0) || !Number.isFinite(scale)) return null;
  return [left * scale, top * scale, (bounds.right - left) * scale, (bounds.bottom - top) * scale];
}

/** Native hit testing avoids the web-to-native round trip during mouse-down. */
export function useTitlebarDragRegion(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const header = document.querySelector<HTMLElement>(".adp-titlebar");
    if (!header) return;
    let frame = 0;
    const report = () => {
      frame = 0;
      const bar = header.querySelector<HTMLElement>(".adp-tabbar, .adp-titlebar-title");
      const rect = bar ? titlebarCaptionRect(
        bar.getBoundingClientRect(),
        Array.from(bar.children, (child) => child.getBoundingClientRect().right),
        window.devicePixelRatio || 1,
      ) : null;
      void setTitlebarDragRect(rect).catch(() => undefined);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(header);
    const mutations = new MutationObserver(schedule);
    mutations.observe(header, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      void setTitlebarDragRect(null).catch(() => undefined);
    };
  }, []);
}
